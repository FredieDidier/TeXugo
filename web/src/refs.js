// "Adicionar referência": paste a DOI, an arXiv id or a title, pick the
// match, append it to the document's .bib and cite it at the cursor.
import { call } from './api.js';
import { h, clear, icon, basename, relPath, toast, modal } from './dom.js';
import { focusedTarget } from './ai.js';
import { symbols } from './editor.js';

const authorsLine = (r) => {
  const n = r.authors.map((a) => a.family);
  return n.length > 3 ? `${n[0]} et al.` : n.join(', ');
};

// Inside \cite...{a,b|} add the key to the list; otherwise insert a citation.
function cite(view, key, natbib) {
  const pos = view.state.selection.main.head;
  const before = view.state.doc.sliceString(Math.max(0, pos - 300), pos);
  const m = before.match(/\\\w*cite\w*\*?(?:\[[^\]]*\])*\{([^}]*)$/);
  let insert;
  if (m) insert = (m[1].trim() && !/,\s*$/.test(m[1]) ? ',' : '') + key;
  else insert = `${natbib ? '\\citet' : '\\cite'}{${key}}`;
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: 'input' });
  view.focus();
}

export async function addReference(app, S) {
  const { view, tab } = focusedTarget(app);
  const doc = tab && tab.root;
  if (!doc && !symbols.bibKeys.length) return toast('Abra um arquivo do documento primeiro.', 'warn');
  let bibs = [...new Set(symbols.bibKeys.map((b) => b.file))];
  let natbib = false;
  if (view) natbib = /\\usepackage(\[[^\]]*\])?\{[^}]*natbib/.test(view.state.doc.sliceString(0, 20000));

  const input = h('input', { placeholder: 'DOI, link do arXiv, ID do arXiv ou título', style: { width: '100%' } });
  const bibSel = h('select', {}, bibs.map((b) => h('option', { value: b }, S.project ? relPath(S.project.root, b) : basename(b))));
  const results = h('div', { class: 'ref-results' });
  const go = h('button', { class: 'btn primary' }, 'Buscar');

  const add = async (ref, andCite) => {
    try {
      const r = await call('refAdd', { bib: bibSel.value, ref });
      m.close();
      if (andCite && view && tab && !tab.binary) cite(view, r.key, natbib);
      toast(r.existed ? `Já estava em ${basename(bibSel.value)} como ${r.key}.` : `${r.key} adicionada a ${basename(bibSel.value)}.`, 'ok');
      if (doc && !own.length && !r.existed) toast(`Lembre de pôr \\bibliography{${basename(bibSel.value).replace(/\.bib$/, '')}} no documento.`, 'warn', 7000);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const search = async () => {
    const q = input.value.trim();
    if (!q) return;
    go.disabled = true;
    clear(results, h('p', { class: 'faint' }, 'Buscando…'));
    try {
      const list = await call('refLookup', { q });
      if (!list.length) return clear(results, h('p', { class: 'faint' }, 'Nada encontrado. Tente o DOI ou mais palavras do título.'));
      clear(
        results,
        list.map((r) =>
          h(
            'div',
            { class: 'ref-item' },
            h(
              'div',
              { class: 'ref-meta' },
              h('div', { class: 'ref-title' }, r.title),
              h('div', { class: 'faint' }, [authorsLine(r), r.year, r.venue || (r.eprint ? `arXiv:${r.eprint}` : '')].filter(Boolean).join(' · ')),
              r.doi ? h('div', { class: 'faint', style: { fontSize: '11px' } }, 'doi:' + r.doi) : null,
            ),
            h('div', { class: 'ref-actions' }, view ? h('button', { class: 'btn primary', onclick: () => add(r, true) }, 'Adicionar e citar') : null, h('button', { class: 'btn', onclick: () => add(r, false) }, 'Só adicionar')),
          ),
        ),
      );
    } catch (err) {
      clear(results, h('p', { style: { color: 'var(--err)' } }, err.message));
    } finally {
      go.disabled = false;
    }
  };
  go.onclick = search;
  input.addEventListener('keydown', (e) => e.key === 'Enter' && search());

  const m = modal({
    title: [icon('plus'), ' Adicionar referência'],
    wide: true,
    body: h(
      'div',
      {},
      h('div', { style: { display: 'flex', gap: '8px' } }, input, go),
      h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Arquivo .bib'), bibSel),
      results,
      h('p', { class: 'faint', style: { fontSize: '12px', marginTop: '10px' } }, 'Busca no Crossref (DOI e título) e no arXiv. Se a referência já estiver no .bib, usa a chave que existe.'),
    ),
  });
  setTimeout(() => input.focus(), 0);
  // The document's own \bibliography files come first; fill in when known.
  const own = doc ? await call('refBibs', { doc }).catch(() => []) : [];
  bibs = [...new Set([...own, ...bibs])];
  if (!bibs.length && doc) bibs = [doc.replace(/[^/]*$/, 'references.bib')];
  clear(bibSel, bibs.map((b) => h('option', { value: b }, S.project ? relPath(S.project.root, b) : basename(b))));
}
