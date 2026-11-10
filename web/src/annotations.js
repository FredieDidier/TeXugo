// "Anotações do PDF": highlights, strike-outs and notes made in Preview,
// Acrobat or any PDF reader — in the document's own PDF or in a copy a
// coauthor sent back — listed in the "Anotações" tab of the bottom panel,
// each tied to its line in the .tex (SyncTeX of the current build; by the
// text when there is no SyncTeX).
import pdfjsLib from './pdfjs-setup.js';
import { call, fileUrl, native } from './api.js';
import { h, clear, icon, basename, relPath, toast, modal } from './dom.js';
import { quadBoxes, textUnder } from './annotext.js';

const KINDS = { Highlight: 'Destaque', Underline: 'Sublinhado', StrikeOut: 'Tachado', Squiggly: 'Ondulado', Text: 'Nota', FreeText: 'Texto', Square: 'Caixa', Circle: 'Círculo', Ink: 'Desenho', Caret: 'Inserção' };

// The text line nearest a point, for notes that sit beside the text.
function lineNear(items, x, y) {
  let best = null;
  for (const it of items) {
    if (!it.str.trim()) continue;
    const d = Math.abs(it.transform[5] - y) * 3 + Math.max(0, it.transform[4] - x - 40);
    if (!best || d < best.d) best = { d, y: it.transform[5], x: it.transform[4] };
  }
  if (!best) return { text: '', x, y };
  const line = items.filter((it) => Math.abs(it.transform[5] - best.y) < 2);
  return { text: line.map((it) => it.str).join(' '), x: Math.min(...line.map((it) => it.transform[4])) + 8, y: best.y + 3 };
}

export async function readAnnotations(pdfPath) {
  const pdf = await pdfjsLib.getDocument({ url: fileUrl(pdfPath), isEvalSupported: false }).promise;
  const out = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const anns = (await page.getAnnotations({ intent: 'display' })).filter((a) => KINDS[a.subtype]);
      if (!anns.length) continue;
      const items = (await page.getTextContent()).items;
      const H = page.view[3] - page.view[1];
      for (const a of anns) {
        const boxes = quadBoxes(a);
        const [x1, y1, x2, y2] = boxes[0] || [0, 0, 0, 0];
        const note = ['Text', 'FreeText', 'Caret'].includes(a.subtype);
        const marked = note ? '' : textUnder(items, boxes);
        const near = lineNear(items, x1, (y1 + y2) / 2);
        // A note sits in the margin: sync from the text line beside it.
        const px = note ? near.x : (x1 + x2) / 2;
        const py = note ? near.y : (y1 + y2) / 2;
        const context = marked && marked.split(' ').length >= 4 ? marked : near.text;
        out.push({
          id: `${n}:${a.id}`,
          page: n,
          kind: a.subtype,
          author: (a.titleObj && a.titleObj.str) || a.title || '',
          comment: ((a.contentsObj && a.contentsObj.str) || a.contents || '').trim(),
          marked,
          context,
          // SyncTeX wants top-left PDF points.
          x: px,
          y: H - py,
        });
      }
    }
    return { pages: pdf.numPages, items: out };
  } finally {
    pdf.destroy();
  }
}

export function annotationsDialog(app, S) {
  const t = app.activeTab();
  const doc = t && t.root;
  if (!doc) return toast('Abra um arquivo do documento.', 'warn');
  const own = doc.replace(/\.tex$/, '.pdf');
  const m = modal({
    title: [icon('edit'), ` Anotações do PDF: ${basename(doc)}`],
    body: h('div', {}, h('p', { style: { marginTop: 0 } }, 'Destaques, tachados e notas feitos no Preview, no Acrobat ou em qualquer leitor de PDF aparecem na aba Anotações, cada um ligado à linha do .tex.'), h('p', { class: 'faint', style: { fontSize: '12px' } }, 'Para o PDF que um coautor devolveu anotado, ele deve ter anotado a mesma versão que está compilada aqui; senão as linhas podem não bater.')),
    footer: [
      h('button', { class: 'btn', onclick: () => (m.close(), load(app, S, doc, own, false)) }, `Do ${basename(own)}`),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            const p = native && native.pickPdf ? await native.pickPdf() : null;
            if (!p) return;
            m.close();
            try {
              const copy = await call('annotImport', { doc, file: p });
              load(app, S, doc, copy, true, basename(p));
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        icon('down'),
        'De um PDF anotado que recebi…',
      ),
    ],
  });
}

// A PDF annotated on a version marked as sent (Versões enviadas): SyncTeX of
// the PDF as it was sent gives the old line, and the old text finds it in
// today's text.
export async function fromSent(app, S, doc, file, sentId, who) {
  try {
    const copy = await call('annotImport', { doc, file });
    await load(app, S, doc, copy, true, (who ? who + ' · ' : '') + basename(file), sentId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function load(app, S, doc, pdfPath, received, label, sentId = null) {
  const sentPdf = sentId ? await call('sentPdf', { root: S.project.root, id: sentId }).catch(() => null) : null;
  const own = sentPdf || doc.replace(/\.tex$/, '.pdf');
  S.annots = { status: 'loading', doc, label: label || basename(pdfPath) };
  app.bottom.show('anotacoes');
  try {
    const { pages, items } = await readAnnotations(pdfPath);
    let hasSync = false;
    try {
      hasSync = (await call('stat', { paths: [own.replace(/\.pdf$/, '.synctex.gz')] }))[0].mtime != null;
    } catch {}
    let ownPages = pages;
    if (received) {
      try {
        const d = await pdfjsLib.getDocument({ url: fileUrl(own), isEvalSupported: false }).promise;
        ownPages = d.numPages;
        d.destroy();
      } catch {}
    }
    for (const a of items) {
      let r = null;
      // A note sits beside a line: its words find it better than SyncTeX,
      // which gives the end of a paragraph to the file that closes it.
      const note = ['Text', 'FreeText', 'Caret'].includes(a.kind);
      if (note && a.context) r = await call('syncTextInverse', { doc, text: a.context }).catch(() => null);
      if (r && r.ok) r.via = 'text';
      if ((!r || !r.ok) && hasSync) r = await call('syncInverse', { pdf: own, page: a.page, x: a.x, y: a.y }).catch(() => null);
      if ((!r || !r.ok) && a.context) {
        r = await call('syncTextInverse', { doc, text: a.context }).catch(() => null);
        if (r && r.ok) r.via = 'text';
      }
      if (r && r.ok && sentPdf && r.file && r.via !== 'text') {
        // An old line of the sent version: find it in today's text.
        const m = await call('sentMapLine', { root: S.project.root, id: sentId, file: r.file, line: r.line, marked: a.marked }).catch(() => null);
        if (m && m.ok) Object.assign(r, { line: m.line }), Object.assign(a, { changed: !!m.changed, gone: !!m.gone, was: m.was || '' });
      }
      if (r && r.ok) Object.assign(a, { file: r.file, line: r.line, approx: !hasSync || !!r.approx });
    }
    const done = await call('annotState', { doc, pdf: pdfPath }).catch(() => ({}));
    for (const a of items) a.done = !!(done && done[a.id]);
    S.annots = { status: 'done', doc, pdf: pdfPath, label: label || basename(pdfPath), items, pagesDiffer: received && ownPages !== pages, hasSync, sent: !!sentPdf };
    if (!items.length) toast('Nenhuma anotação neste PDF.', 'info');
  } catch (err) {
    S.annots = { status: 'error', doc, error: err.message };
  }
  app.bottom.show('anotacoes', { soft: true });
  app.refreshRevisao && app.refreshRevisao();
}

export function renderAnnotationsPanel(app, S, body) {
  const st = S.annots;
  if (!st) return clear(body, h('div', { class: 'pad muted' }, 'Nenhum PDF anotado lido. ', h('a', { href: '#', onclick: (e) => (e.preventDefault(), annotationsDialog(app, S)) }, 'Ler anotações do PDF'), '.'));
  if (st.status === 'loading') return clear(body, h('div', { class: 'pad' }, h('span', { class: 'status-dot building' }), ` Lendo as anotações de ${st.label}…`));
  if (st.status === 'error') return clear(body, h('div', { class: 'pad' }, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, st.error))));
  const open = st.items.filter((a) => !a.done).length;
  const ask = (a) => {
    app.sidebar.show('claude');
    if (!app.agent) return;
    app.agent.input.value = `${a.author || 'Um coautor'} anotou no PDF (p. ${a.page})${a.marked ? `, sobre o trecho “${a.marked}”` : ''}${a.file ? ` (${relPath(S.project.root, a.file)}:${a.line})` : ''}:\n${KINDS[a.kind]}${a.comment ? `: “${a.comment}”` : a.kind === 'StrikeOut' ? ' (quer apagar este trecho)' : ''}\n\nFaça essa mudança no texto.`;
    app.agent.input.focus();
  };
  clear(
    body,
    h(
      'div',
      { class: 'review-panel' },
      h(
        'div',
        { class: 'review-head' },
        h('b', {}, `Anotações de ${st.label}`),
        h('span', { class: 'faint' }, `${open} de ${st.items.length} em aberto${st.hasSync ? '' : ' · sem SyncTeX: linhas aproximadas pelo texto'}`),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn sm', onclick: () => annotationsDialog(app, S) }, 'Ler outro PDF'),
      ),
      st.sent ? h('div', { class: 'faint', style: { fontSize: '12px', margin: '4px 0' } }, 'Lido contra a versão enviada: cada nota aponta para a linha de hoje do mesmo trecho.') : null,
      st.pagesDiffer ? h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, 'O PDF anotado tem outro número de páginas que o compilado aqui: as linhas podem não bater. Compile a versão que o coautor anotou.')) : null,
      st.items.map((a) =>
        h(
          'div',
          { class: 'review-pt' + (a.done ? ' done' : ''), onclick: () => (a.file ? app.openFile(a.file, { line: a.line }) : toast('Não achei a linha deste trecho.', 'warn')) },
          h('input', {
            type: 'checkbox',
            checked: !!a.done,
            title: 'Resolvido',
            onclick: (e) => e.stopPropagation(),
            onchange: async (e) => {
              a.done = e.target.checked;
              await call('annotMark', { doc: st.doc, pdf: st.pdf, id: a.id, done: a.done }).catch(() => {});
              app.bottom.render();
              app.refreshRevisao && app.refreshRevisao();
            },
          }),
          h('span', { class: 'kind ' + (a.kind === 'StrikeOut' ? 'err' : a.kind === 'Text' || a.kind === 'FreeText' ? 'muted' : 'warn') }, KINDS[a.kind]),
          h('div', { class: 'txt' }, a.marked ? h('span', { class: 'ann-marked' + (a.kind === 'StrikeOut' ? ' strike' : '') }, `“${a.marked}”`) : null, a.comment ? h('span', {}, ' ', a.comment) : a.marked ? null : h('span', { class: 'faint' }, ' (sem texto)'), a.author ? h('div', { class: 'sug' }, a.author) : null, a.changed ? h('div', { class: 'ann-changed', title: a.was ? `Na versão enviada: “${a.was.slice(0, 300)}”` : '' }, a.gone ? 'o trecho foi cortado desde o envio' : 'o trecho mudou desde o envio') : null),
          h('span', { class: 'where', title: a.approx ? 'Linha achada pelo texto (aproximada)' : 'Linha pelo SyncTeX' }, `p. ${a.page}${a.file ? ` · ${relPath(S.project.root, a.file)}:${a.line}${a.approx ? ' ~' : ''}` : ''}`),
          h('button', { class: 'btn sm ghost', title: 'Pedir ao Claude para fazer esta mudança', onclick: (e) => (e.stopPropagation(), ask(a)) }, icon('claude')),
        ),
      ),
    ),
  );
}
