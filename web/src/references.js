// Sidebar view "Referências": every entry of the project's .bib files, with
// search, how often each is cited, one click to cite at the cursor, links
// to the paper, and "Verificar no Crossref" with suggestions to accept.
import { call } from './api.js';
import { h, clear, icon, basename, relPath, toast } from './dom.js';
import { symbols } from './editor.js';
import { focusedTarget } from './ai.js';
import { addReference, cite } from './refs.js';
import { zoteroDialog } from './zotero.js';

const st = { query: '', filter: 'all', open: null, checks: new Map(), checking: false, checkedAt: null };

const STATUS = {
  ok: { cls: 'ok', ico: 'check', text: 'Confere com o Crossref' },
  diffs: { cls: 'warn', ico: 'warn', text: 'O Crossref sugere mudanças' },
  mismatch: { cls: 'err', ico: 'x', text: 'O DOI aponta para outro trabalho' },
  baddoi: { cls: 'err', ico: 'x', text: 'DOI inexistente' },
  notfound: { cls: 'muted', ico: 'info', text: 'Não encontrada no Crossref' },
  error: { cls: 'muted', ico: 'info', text: 'Não verificada' },
  skip: { cls: 'muted', ico: 'info', text: 'Sem título' },
};
const FIELD_PT = { year: 'ano', journal: 'periódico', journaltitle: 'periódico', volume: 'volume', number: 'número', pages: 'páginas', doi: 'DOI' };

const shortAuthors = (a) => {
  const n = String(a || '').split(/\s+and\s+/).filter(Boolean).map((x) => (x.includes(',') ? x.split(',')[0] : x.split(' ').pop()).trim());
  return n.length > 3 ? n[0] + ' et al.' : n.join(', ');
};

function citeKey(app, key) {
  const { view, tab } = focusedTarget(app);
  if (!view || !tab || !/\.(tex|ltx)$/i.test(tab.path)) return toast('Abra um .tex e ponha o cursor onde quer citar.', 'warn');
  const natbib = /\\usepackage(\[[^\]]*\])?\{[^}]*natbib/.test(view.state.doc.sliceString(0, 20000));
  cite(view, key, natbib);
}

async function runCheck(app, S, el) {
  const bibs = [...new Set(symbols.bibKeys.map((b) => b.file))];
  if (!bibs.length) return toast('O projeto não tem .bib.', 'warn');
  st.checking = true;
  renderRefs(app, S, el);
  try {
    for (const bib of bibs) {
      const res = await call('refCheck', { bib });
      for (const r of res) st.checks.set(bib + '\u0000' + r.key, r);
    }
    st.checkedAt = new Date();
    const n = [...st.checks.values()].filter((r) => r.status !== 'ok' && r.status !== 'notfound' && r.status !== 'skip').length;
    if (n) st.filter = 'issues';
    toast(n ? `${n} referência${n === 1 ? '' : 's'} com sugestões do Crossref.` : 'Tudo confere com o Crossref.', n ? 'warn' : 'ok', 5000);
  } catch (err) {
    toast(err.message, 'error', 7000);
  } finally {
    st.checking = false;
    renderRefs(app, S, el);
  }
}

async function apply(app, S, el, bib, fixes) {
  const tab = app.tabByPath && app.tabByPath(bib);
  if (tab && tab.dirty) return toast(`Salve ${basename(bib)} antes (tem alterações não salvas).`, 'warn');
  try {
    const r = await call('refApply', { bib, fixes });
    for (const f of fixes) {
      const c = st.checks.get(bib + '\u0000' + f.key);
      if (!c || !c.diffs) continue;
      c.diffs = c.diffs.filter((d) => !(d.field === f.field));
      if (!c.diffs.length) c.status = 'ok';
    }
    toast(`${r.applied} correç${r.applied === 1 ? 'ão' : 'ões'} gravada${r.applied === 1 ? '' : 's'} em ${basename(bib)}. ⌘Z não desfaz: use o Git ou edite o .bib.`, 'ok', 6000);
    app.refreshSymbolsSoon && app.refreshSymbolsSoon();
    renderRefs(app, S, el);
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function renderRefs(app, S, el) {
  const all = symbols.bibKeys;
  const check = (b) => st.checks.get(b.file + '\u0000' + b.key);
  const isIssue = (b) => {
    const c = check(b);
    return c && ['diffs', 'mismatch', 'baddoi'].includes(c.status);
  };
  const q = st.query.trim().toLowerCase();
  const list = all
    .filter((b) => (st.filter === 'unused' ? !b.uses : st.filter === 'issues' ? isIssue(b) : true))
    .filter((b) => !q || [b.key, b.title, b.author, b.year, b.venue].some((x) => String(x || '').toLowerCase().includes(q)))
    .sort((a, b) => shortAuthors(a.author).localeCompare(shortAuthors(b.author)) || String(a.year).localeCompare(String(b.year)));
  const unused = all.filter((b) => !b.uses).length;
  const issues = all.filter(isIssue).length;
  const doiFixes = new Map(); // bib -> [{key, field, value}]
  for (const b of all) {
    const c = check(b);
    const d = c && c.diffs && c.diffs.find((x) => x.field === 'doi');
    if (d) doiFixes.set(b.file, [...(doiFixes.get(b.file) || []), { key: b.key, field: 'doi', value: d.crossref }]);
  }
  const nDoi = [...doiFixes.values()].reduce((n, l) => n + l.length, 0);

  const search = h('input', { value: st.query, placeholder: 'Buscar por autor, título, ano, chave…', style: { width: '100%' } });
  search.addEventListener('input', () => {
    st.query = search.value;
    renderRefs(app, S, el);
    const s = el.querySelector('.refs-search input');
    if (s) (s.focus(), s.setSelectionRange(s.value.length, s.value.length));
  });
  const chip = (id, label) => h('button', { class: 'refs-chip' + (st.filter === id ? ' on' : ''), onclick: () => ((st.filter = id), renderRefs(app, S, el)) }, label);
  const multi = new Set(all.map((b) => b.file)).size > 1;

  const item = (b) => {
    const c = check(b);
    const s = c && STATUS[c.status];
    const open = st.open === b.file + '\u0000' + b.key;
    const details = open
      ? h(
          'div',
          { class: 'refs-details', onclick: (e) => e.stopPropagation() },
          h('div', { class: 'refs-key' }, b.key, multi ? ` · ${basename(b.file)}` : ''),
          c && c.note ? h('div', { class: 'refs-note ' + (s ? s.cls : '') }, c.note) : null,
          c && c.diffs && c.diffs.length
            ? h(
                'div',
                { class: 'refs-diffs' },
                c.diffs.map((d) =>
                  h(
                    'div',
                    { class: 'refs-diff' },
                    h('span', { class: 'f' }, FIELD_PT[d.field] || d.field),
                    h('span', { class: 'v' }, d.have ? h('s', {}, d.have) : h('i', { class: 'faint' }, 'falta'), ' → ', h('b', {}, d.crossref)),
                    h('button', { class: 'btn sm', onclick: () => apply(app, S, el, b.file, [{ key: b.key, field: d.field, value: d.crossref }]) }, 'Aplicar'),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { class: 'refs-actions' },
            h('button', { class: 'btn sm primary', onclick: () => citeKey(app, b.key) }, 'Citar no cursor'),
            b.doi ? h('a', { class: 'btn sm', href: 'https://doi.org/' + b.doi, target: '_blank', rel: 'noopener' }, 'DOI') : null,
            b.eprint && /^\d{4}\.\d{4,5}/.test(b.eprint) ? h('a', { class: 'btn sm', href: 'https://arxiv.org/abs/' + b.eprint, target: '_blank', rel: 'noopener' }, 'arXiv') : null,
            h('a', { class: 'btn sm', href: 'https://scholar.google.com/scholar?q=' + encodeURIComponent(b.title || b.key), target: '_blank', rel: 'noopener' }, 'Scholar'),
            h('button', { class: 'btn sm', onclick: () => app.openFile(b.file, { line: b.line }) }, 'Ver no .bib'),
          ),
        )
      : null;
    return h(
      'div',
      { class: 'refs-item' + (open ? ' open' : ''), title: b.key, onclick: () => ((st.open = open ? null : b.file + '\u0000' + b.key), renderRefs(app, S, el)), ondblclick: () => citeKey(app, b.key) },
      h(
        'div',
        { class: 'refs-top' },
        h('div', { class: 'refs-title' }, b.title || b.key),
        s ? h('span', { class: 'refs-st ' + s.cls, title: s.text }, icon(s.ico)) : null,
      ),
      h('div', { class: 'refs-meta' }, [shortAuthors(b.author), b.year, b.venue].filter(Boolean).join(' · ')),
      h('div', { class: 'refs-uses' + (b.uses ? '' : ' none') }, b.uses ? `citada ${b.uses}×` : 'não citada'),
      details,
    );
  };

  clear(
    el,
    h(
      'div',
      { class: 'sidebar-head' },
      h('span', { class: 'title' }, `Referências (${all.length})`),
      h('button', { class: 'icon-btn', title: 'Adicionar referência por DOI, arXiv ou título (⌥⌘R)', onclick: () => addReference(app, S) }, icon('plus')),
      h('button', { class: 'icon-btn', title: 'Importar do Zotero ou de um .bib exportado (Mendeley, Paperpile…)', onclick: () => zoteroDialog(app, S) }, icon('down')),
      h('button', { class: 'icon-btn', title: 'Verificar no Crossref: ano, periódico, volume, páginas e DOI', disabled: st.checking, onclick: () => runCheck(app, S, el) }, icon(st.checking ? 'refresh' : 'checkCircle')),
    ),
    h(
      'div',
      { class: 'refs-search', style: { padding: '0 10px 8px' } },
      search,
      h('div', { class: 'refs-chips' }, chip('all', `Todas ${all.length}`), unused ? chip('unused', `Não citadas ${unused}`) : null, st.checks.size ? chip('issues', `Sugestões ${issues}`) : null),
    ),
    st.checking ? h('div', { class: 'refs-banner' }, h('span', { class: 'status-dot building' }), ' Verificando no Crossref… (uns 30 s para 50 referências)') : null,
    nDoi && !st.checking
      ? h(
          'div',
          { class: 'refs-banner' },
          `${nDoi} sem DOI que o Crossref achou.`,
          h('button', { class: 'btn sm primary', onclick: () => Promise.all([...doiFixes].map(([bib, fixes]) => apply(app, S, el, bib, fixes))) }, 'Adicionar todos os DOIs'),
        )
      : null,
    h(
      'div',
      { class: 'sidebar-body refs-list' },
      !all.length
        ? h('div', { class: 'faint', style: { padding: '12px' } }, 'Nenhum .bib no projeto. ', h('a', { href: '#', onclick: (e) => (e.preventDefault(), addReference(app, S)) }, 'Adicionar referência'))
        : list.length
          ? list.map(item)
          : h('div', { class: 'faint', style: { padding: '12px' } }, 'Nada com esse filtro.'),
    ),
    st.checkedAt ? h('div', { class: 'refs-foot faint' }, `Verificado às ${st.checkedAt.toLocaleTimeString().slice(0, 5)}. Clique numa referência para ver e aplicar.`) : h('div', { class: 'refs-foot faint' }, 'Clique para detalhes; duplo clique cita no cursor.'),
  );
}
