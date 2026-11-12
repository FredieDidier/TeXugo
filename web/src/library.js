// "Biblioteca de papers": the PDFs the user reads, for every project. Add
// PDFs (picker, drag and drop, or the ones attached in Zotero); their text
// is read here with pdf.js and kept by the server, so one search goes
// through every paper and lands on the page, with the words highlighted.
import pdfjsLib from './pdfjs-setup.js';
import { call, fileUrl, native } from './api.js';
import { h, clear, icon, toast, modal, prompt, confirmBox, OPEN_PDF } from './dom.js';
import { PdfTab } from './pdfview.js';

// Same split as the server: "quoted phrases" stay whole.
export function queryTerms(q) {
  const out = [];
  String(q || '').replace(/"([^"]+)"|(\S+)/g, (_m, p, w) => {
    const t = (p || w).trim();
    if (t) out.push(t);
  });
  return out;
}

// The text of each page, line by line (so the server can join words
// hyphenated across lines), and a guess at title, authors and year.
export async function extractText(path) {
  const pdf = await pdfjsLib.getDocument({ url: fileUrl(path), isEvalSupported: false, cMapUrl: './cmaps/', cMapPacked: true, standardFontDataUrl: './standard_fonts/' }).promise;
  try {
    const pages = [];
    let first = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const items = (await page.getTextContent()).items.filter((it) => it.str !== undefined);
      if (n === 1) first = items;
      let out = '';
      let lastY = null;
      for (const it of items) {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) out += '\n';
        else if (out && !/\s$/.test(out) && it.str && !/^\s/.test(it.str)) out += it.str.length > 1 || /\w/.test(it.str) ? ' ' : '';
        out += it.str;
        if (it.hasEOL) out += '\n';
        lastY = y;
      }
      pages.push(out);
      page.cleanup();
    }
    const guess = {};
    const { info } = await pdf.getMetadata().catch(() => ({ info: {} }));
    const t = String((info && info.Title) || '').trim();
    if (t.length > 8 && !/^(microsoft word|untitled|document|\S+\.(docx?|tex|dvi|pdf)$)/i.test(t)) guess.title = t;
    const a = String((info && info.Author) || '').trim();
    if (a && a.length < 200 && !/^(user|admin|author)$/i.test(a)) guess.authors = a;
    if (!guess.title) {
      // The biggest type on the first page, near the top.
      const big = first.filter((it) => it.str.trim() && it.height > 0);
      const top = Math.max(...big.map((it) => it.height), 0);
      const lines = big.filter((it) => it.height >= top * 0.92).map((it) => it.str.trim());
      const title = lines.join(' ').replace(/\s+/g, ' ').trim();
      if (title.length > 8 && title.length < 250) guess.title = title;
    }
    const y = (pages[0] || '').match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    if (y) guess.year = y[1];
    return { pages, guess };
  } finally {
    pdf.destroy();
  }
}

const label = (p) => p.title || p.file.replace(/\.pdf$/i, '');
const byline = (p) => [p.authors, p.year, p.pages ? `${p.pages} p.` : ''].filter(Boolean).join(' · ');

export function libraryDialog(app, S, { query = '' } = {}) {
  const q = h('input', { class: 'lib-q', placeholder: 'Buscar no texto de todos os papers (palavras na mesma página; "frase exata")', value: query });
  const status = h('span', { class: 'faint lib-status' });
  const list = h('div', { class: 'lib-list' });
  let papers = [];
  let seq = 0;

  const mark = (x) => h('span', { class: 'lib-snip' }, x.before, h('mark', {}, x.hit), x.after);

  const paperRow = (p, extra) =>
    h(
      'div',
      { class: 'lib-paper' },
      h(
        'div',
        { class: 'lib-head' },
        icon('pdf'),
        h('div', { class: 'lib-meta' }, h('a', { href: '#', class: 'lib-title', onclick: (e) => (e.preventDefault(), openReader(app, S, p, { terms: queryTerms(q.value), onBeside: () => m.close() })) }, label(p)), h('div', { class: 'faint' }, byline(p) || p.file, p.indexed ? '' : ' · lendo o texto…')),
        h('button', { class: 'icon-btn', title: 'Ler', onclick: () => openReader(app, S, p, { terms: queryTerms(q.value), onBeside: () => m.close() }) }, icon('eye')),
        S.project ? h('button', { class: 'icon-btn', title: 'Abrir no painel do PDF, ao lado do texto', onclick: () => (m.close(), openBeside(app, S, p, 1)) }, icon('columns')) : null,
        h('button', { class: 'icon-btn', title: 'Corrigir título, autores e ano', onclick: () => editMeta(p) }, icon('edit')),
        h('button', { class: 'icon-btn', title: 'Tirar da biblioteca', onclick: () => removePaper(p) }, icon('trash')),
      ),
      extra,
    );

  async function render() {
    const my = ++seq;
    const text = q.value.trim();
    if (!text) {
      clear(
        list,
        papers.length
          ? [...papers].sort((a, b) => String(b.added).localeCompare(String(a.added))).map((p) => paperRow(p))
          : h('div', { class: 'lib-empty' }, h('p', {}, 'A biblioteca está vazia.'), h('p', { class: 'faint' }, 'Adicione PDFs (ou arraste-os para cá) ou traga os PDFs anexados no Zotero. O texto de cada um é lido uma vez e entra na busca.')),
      );
      return;
    }
    const res = await call('libSearch', { q: text });
    if (my !== seq) return;
    const terms = queryTerms(text);
    clear(
      list,
      res.length
        ? res.map((r) =>
            paperRow(
              r.paper,
              r.hits.length
                ? h(
                    'div',
                    { class: 'lib-hits' },
                    r.hits.map((x) => h('a', { href: '#', class: 'lib-hit', onclick: (e) => (e.preventDefault(), openReader(app, S, r.paper, { page: x.page, terms, onBeside: () => m.close() })) }, h('span', { class: 'lib-page' }, `p. ${x.page}`), mark(x))),
                    r.pagesHit > r.hits.length ? h('div', { class: 'faint lib-more' }, `e mais ${r.pagesHit - r.hits.length} página${r.pagesHit - r.hits.length === 1 ? '' : 's'}`) : null,
                  )
                : null,
            ),
          )
        : h('p', { class: 'faint' }, 'Nada com essa busca.'),
    );
  }

  async function refresh() {
    papers = await call('libList');
    await render();
    indexPending();
  }

  // Reads the text of papers added but not read yet, one at a time.
  let indexing = false;
  async function indexPending() {
    if (indexing) return;
    indexing = true;
    try {
      for (;;) {
        const todo = papers.filter((p) => !p.indexed && !p.failed);
        if (!todo.length) break;
        const p = todo[0];
        status.textContent = `Lendo o texto: ${label(p)} (faltam ${todo.length})`;
        try {
          const { pages, guess } = await extractText(p.path);
          Object.assign(p, await call('libSetText', { id: p.id, pages, guess }));
          if (!pages.join('').trim()) toast(`${label(p)}: o PDF não tem texto (é imagem escaneada). Ele fica na biblioteca, mas a busca não o alcança.`, 'warn', 9000);
        } catch (err) {
          p.failed = true;
          toast(`Não deu para ler ${p.file}: ${err.message}`, 'error');
        }
        if (!q.value.trim()) render();
      }
    } finally {
      indexing = false;
      status.textContent = papers.length ? `${papers.length} paper${papers.length === 1 ? '' : 's'}` : '';
      if (q.value.trim()) render();
    }
  }

  async function addPaths(files) {
    if (!files || !files.length) return;
    try {
      const r = await call('libAddFiles', { files });
      const had = r.filter((x) => x.existed).length;
      if (had) toast(`${had} já estava${had === 1 ? '' : 'm'} na biblioteca.`, 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
    refresh();
  }

  async function addDropped(fileList) {
    const files = [...fileList].filter((f) => /\.pdf$/i.test(f.name));
    if (!files.length) return toast('Arraste arquivos PDF.', 'warn');
    for (const f of files) {
      if (f.size > 35 * 1024 * 1024) {
        toast(`${f.name} passa de 35 MB; use “Adicionar PDFs…”.`, 'warn');
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      try {
        await call('libAddData', { name: f.name, data: btoa(bin) });
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    refresh();
  }

  async function fromZotero() {
    status.textContent = 'Procurando os PDFs anexados no Zotero…';
    try {
      const items = await call('libZotero');
      const have = new Set(papers.map((p) => p.zkey).filter(Boolean));
      const fresh = items.filter((it) => !have.has(it.zkey));
      status.textContent = '';
      if (!fresh.length) return toast(items.length ? 'Todos os PDFs do Zotero já estão na biblioteca.' : 'Nenhum PDF anexado no Zotero.', 'info');
      if (!(await confirmBox('PDFs do Zotero', `Trazer ${fresh.length} PDF${fresh.length === 1 ? '' : 's'} anexado${fresh.length === 1 ? '' : 's'} no Zotero, com título, autores e ano de lá? Os PDFs são copiados; o Zotero não é alterado.`, { ok: 'Trazer' }))) return;
      await call('libAddZotero', { items: fresh });
      refresh();
    } catch (err) {
      status.textContent = '';
      toast(err.message, 'error');
    }
  }

  async function editMeta(p) {
    const f = (k, l) => h('div', { class: 'field' }, h('label', {}, l), h('input', { value: p[k] || '', 'data-k': k }));
    const body = h('div', {}, f('title', 'Título'), f('authors', 'Autores'), f('year', 'Ano'), f('doi', 'DOI'));
    const save = async () => {
      const meta = {};
      for (const el of body.querySelectorAll('input')) meta[el.dataset.k] = el.value;
      try {
        Object.assign(p, await call('libUpdate', { id: p.id, meta }));
        mm.close();
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const mm = modal({ title: [icon('edit'), ' Dados do paper'], body, footer: [h('button', { class: 'btn', onclick: () => mm.close() }, 'Cancelar'), h('button', { class: 'btn primary', onclick: save }, 'Salvar')] });
    setTimeout(() => body.querySelector('input').focus(), 0);
  }

  async function removePaper(p) {
    if (!(await confirmBox('Tirar da biblioteca', `Tirar “${label(p)}” da biblioteca? A cópia do PDF guardada pelo TeXugo é apagada; o arquivo original não.`, { ok: 'Tirar', danger: true }))) return;
    await call('libRemove', { id: p.id });
    refresh();
  }

  const addBtn = h(
    'button',
    {
      class: 'btn',
      onclick: async () => {
        if (native && native.pickPdfs) return addPaths(await native.pickPdfs());
        const p = await prompt('Adicionar PDF', { label: 'Caminho completo do PDF', ok: 'Adicionar' });
        if (p) addPaths([p]);
      },
    },
    icon('plus'),
    'Adicionar PDFs…',
  );
  const zotBtn = h('button', { class: 'btn', title: 'Os PDFs anexados aos itens do Zotero, com título, autores e ano', onclick: fromZotero }, icon('book'), 'PDFs do Zotero');

  const m = modal({
    title: [icon('papers'), ' Biblioteca de papers'],
    wide: true,
    body: h('div', { class: 'lib' }, q, list),
    footer: [addBtn, zotBtn, status, h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: () => m.close() }, 'Fechar')],
  });
  m.el.classList.add('lib-modal');
  m.el.addEventListener('dragover', (e) => {
    e.preventDefault();
    m.el.classList.add('drop');
  });
  m.el.addEventListener('dragleave', (e) => e.target === m.el && m.el.classList.remove('drop'));
  m.el.addEventListener('drop', (e) => {
    e.preventDefault();
    m.el.classList.remove('drop');
    addDropped(e.dataTransfer.files);
  });
  let timer;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 180);
  });
  setTimeout(() => q.focus(), 0);
  refresh().catch((err) => clear(list, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, err.message))));
}

// Opens the paper in the main PDF pane, to read beside the editor.
function openBeside(app, S, p, page) {
  app.openPdf(p.path);
  const tab = S.pdfTabs.find((t) => t.path === p.path);
  if (!tab || page <= 1) return;
  let tries = 0;
  const go = () => (tab.viewer.pages ? (tab.viewer.page = page) : ++tries < 40 && setTimeout(go, 100));
  go();
}

// A reader over the whole window: the paper with the search words
// highlighted, ↑/↓ (or Enter) between matches.
export function openReader(app, S, p, { page = 1, terms = [], onBeside } = {}) {
  const findIn = h('input', { class: 'lib-find', placeholder: 'Buscar neste paper', value: terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' ') });
  const count = h('span', { class: 'faint lib-count' });
  const pageInfo = h('span', { class: 'pageinfo' });
  const tools = h('div', { class: 'pdf-tools lib-tools' });
  const v = new PdfTab(p.path, { find: true, onState: () => renderTools() });
  const box = h('div', { class: 'lib-reader' }, tools, h('div', { class: 'pdf-stack' }, v.el));
  const overlay = h('div', { class: 'overlay lib-reader-overlay' }, box);
  v.el.classList.toggle('invert', !!S.settings.invertPdf && document.documentElement.dataset.theme === 'dark');

  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    v.destroy();
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      e.stopPropagation();
      findIn.focus();
      findIn.select();
    }
  };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => e.target === overlay && close());

  const find = (again, previous) => {
    const t = queryTerms(findIn.value);
    if (!t.length) return (count.textContent = '');
    v.find(t, { again, previous });
  };
  findIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      find(true, e.shiftKey);
    }
  });
  let ft;
  findIn.addEventListener('input', () => {
    clearTimeout(ft);
    ft = setTimeout(() => find(false), 200);
  });
  v.onMatches = ({ current, total }) => (count.textContent = total ? `${current} de ${total}` : findIn.value.trim() ? 'nada' : '');

  function renderTools() {
    clear(pageInfo, h('input', { value: v.page, onkeydown: (e) => e.key === 'Enter' && (v.page = Number(e.target.value) || 1) }), `/ ${v.pages || '–'}`);
  }
  clear(
    tools,
    h('span', { class: 'lib-reader-title', title: [label(p), byline(p)].filter(Boolean).join(' — ') }, icon('pdf'), label(p)),
    h('span', { class: 'sep' }),
    findIn,
    h('button', { class: 'icon-btn', title: 'Anterior (⇧Enter)', onclick: () => find(true, true) }, icon('chevUp')),
    h('button', { class: 'icon-btn', title: 'Próximo (Enter)', onclick: () => find(true, false) }, icon('chevDown')),
    count,
    h('span', { style: { flex: 1 } }),
    pageInfo,
    h('button', { class: 'icon-btn', title: 'Diminuir', onclick: () => v.zoom(1 / 1.15) }, icon('zoomOut')),
    h('button', { class: 'icon-btn', title: 'Aumentar', onclick: () => v.zoom(1.15) }, icon('zoomIn')),
    h('button', { class: 'icon-btn', title: 'Largura da página', onclick: () => v.setScale('page-width') }, icon('fitWidth')),
    S.project ? h('button', { class: 'icon-btn', title: 'Abrir no painel do PDF, ao lado do texto', onclick: () => {
            const n = v.page;
            close();
            onBeside && onBeside();
            openBeside(app, S, p, n);
          },
        }, icon('columns')) : null,
    h('button', { class: 'icon-btn', title: OPEN_PDF, onclick: () => call('openExternal', { path: p.path }).catch((e) => toast(e.message, 'error')) }, icon('external')),
    h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: close }, icon('x')),
  );
  renderTools();
  document.body.append(overlay);
  v.load(fileUrl(p.path))
    .then(() => {
      v.whenReady(() => {
        if (page > 1) v.page = page;
        if (findIn.value.trim()) find(false);
      });
    })
    .catch((err) => (toast(`Não deu para abrir o PDF: ${err.message}`, 'error'), close()));
}
