// "Importar do Zotero": search the user's Zotero library, tick items, add
// them to the project's .bib (duplicates by DOI are recognized), or merge a
// .bib exported from any reference manager.
import { call, native } from './api.js';
import { h, clear, icon, basename, relPath, toast, modal, prompt } from './dom.js';
import { symbols } from './editor.js';

const shortAuthors = (r) => {
  const n = (r.authors || []).map((a) => a.family);
  return n.length > 3 ? n[0] + ' et al.' : n.join(', ');
};

export async function zoteroDialog(app, S) {
  const bibs = [...new Set(symbols.bibKeys.map((b) => b.file))];
  const t = app.activeTab();
  if (!bibs.length && t && t.root) bibs.push(t.root.replace(/[^/]*$/, 'references.bib'));
  if (!bibs.length) return toast('Abra um arquivo do documento primeiro.', 'warn');
  const bibSel = h('select', {}, bibs.map((b) => h('option', { value: b }, relPath(S.project.root, b))));
  const q = h('input', { placeholder: 'Buscar na sua biblioteca: autor, título, ano…', style: { width: '100%' } });
  const list = h('div', { class: 'ref-results' }, h('p', { class: 'faint' }, 'Lendo a sua biblioteca do Zotero…'));
  const chosen = new Map();
  const addBtn = h('button', { class: 'btn primary', disabled: true }, icon('plus'), 'Adicionar ao .bib');
  const have = new Set(symbols.bibKeys.map((b) => (b.doi || '').toLowerCase()).filter(Boolean));
  let items = [];

  const render = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((r) => words.every((w) => [r.title, shortAuthors(r), r.year, r.venue].join(' ').toLowerCase().includes(w))).slice(0, 200);
    clear(
      list,
      shown.length
        ? shown.map((r) => {
            const inBib = !!(r.doi && have.has(r.doi.toLowerCase()));
            const box = h('input', { type: 'checkbox', checked: chosen.has(r.zkey), disabled: inBib, onchange: (e) => (e.target.checked ? chosen.set(r.zkey, r) : chosen.delete(r.zkey), update()) });
            return h(
              'label',
              { class: 'ref-item zot-item' + (inBib ? ' muted' : '') },
              box,
              h('div', { class: 'ref-meta' }, h('div', { class: 'ref-title' }, r.title || '(sem título)'), h('div', { class: 'faint' }, [shortAuthors(r), r.year, r.venue].filter(Boolean).join(' · '), inBib ? ' · já está no .bib' : '')),
            );
          })
        : h('p', { class: 'faint' }, items.length ? 'Nada com essa busca.' : 'A biblioteca está vazia.'),
    );
  };
  const update = () => {
    addBtn.disabled = !chosen.size;
    clear(addBtn, icon('plus'), chosen.size ? `Adicionar ${chosen.size} ao .bib` : 'Adicionar ao .bib');
  };
  q.addEventListener('input', render);

  addBtn.onclick = async () => {
    const tab = app.tabByPath && app.tabByPath(bibSel.value);
    if (tab && tab.dirty) return toast(`Salve ${basename(bibSel.value)} antes.`, 'warn');
    try {
      const r = await call('zoteroAdd', { bib: bibSel.value, refs: [...chosen.values()] });
      const added = r.filter((x) => !x.existed).length;
      m.close();
      toast(`${added} adicionada${added === 1 ? '' : 's'} a ${basename(bibSel.value)}${r.length - added ? `; ${r.length - added} já estava${r.length - added === 1 ? '' : 'm'} lá` : ''}. Chaves: ${r.map((x) => x.key).join(', ')}.`, 'ok', 8000);
      app.refreshSymbolsSoon && app.refreshSymbolsSoon();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const importBtn = h(
    'button',
    {
      class: 'btn',
      title: 'Um .bib exportado do Zotero, Better BibTeX, Mendeley, Paperpile…',
      onclick: async () => {
        const source = native && native.pickBib ? await native.pickBib() : await prompt('Importar .bib', { label: 'Caminho do arquivo .bib exportado', ok: 'Importar' });
        if (!source) return;
        try {
          const r = await call('importBib', { bib: bibSel.value, source });
          m.close();
          toast(`${r.added.length} entrada${r.added.length === 1 ? '' : 's'} nova${r.added.length === 1 ? '' : 's'} em ${basename(bibSel.value)}${r.skipped.length ? `; ${r.skipped.length} já estava${r.skipped.length === 1 ? '' : 'm'} lá (mesma chave, DOI ou título)` : ''}.`, 'ok', 8000);
          app.refreshSymbolsSoon && app.refreshSymbolsSoon();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    },
    icon('down'),
    'Importar .bib…',
  );

  const m = modal({
    title: [icon('book'), ' Importar do Zotero'],
    wide: true,
    body: h('div', {}, q, h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Para o arquivo'), bibSel), list),
    footer: [importBtn, h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), addBtn],
  });
  setTimeout(() => q.focus(), 0);
  try {
    const lib = await call('zoteroLibrary');
    items = lib.items.sort((a, b) => (shortAuthors(a) || '').localeCompare(shortAuthors(b) || '') || String(a.year).localeCompare(String(b.year)));
    render();
  } catch (err) {
    clear(list, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, err.message)));
  }
}
