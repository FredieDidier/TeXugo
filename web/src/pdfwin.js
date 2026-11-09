// A window that shows a single PDF, for a second monitor. It reloads after
// every build of its document, follows "show in PDF" from the main window,
// and a double click sends the main window to the source line.
import { call, connect, on, fileUrl } from './api.js';
import { h, clear, icon, basename, debounce, toast } from './dom.js';
import { PdfTab } from './pdfview.js';
import { applyTheme } from './settings.js';

export async function bootPdfWindow(pdf, root) {
  let hello = { settings: {} };
  try {
    hello = await call('hello');
  } catch {}
  applyTheme(hello.settings.theme);
  document.title = `${basename(pdf)} — TeXugo`;
  const appEl = document.getElementById('app');
  appEl.classList.add('pdfwin');
  const tools = h('div', { class: 'pdf-tools pdfwin-tools' });
  const stack = h('div', { class: 'pdf-stack' });
  appEl.append(tools, stack);
  const send = (msg) => call('broadcast', { msg }).catch(() => {});

  const v = new PdfTab(pdf, {
    onInverse: async (a) => {
      try {
        const r = await call('syncInverse', a);
        if (r.ok) send({ type: 'open-request', root, file: r.file, line: r.line });
        else toast('Não achei a linha correspondente.', 'warn');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    onState: () => renderTools(),
  });
  stack.append(v.el);
  v.el.classList.toggle('invert', !!hello.settings.invertPdf && document.documentElement.dataset.theme === 'dark');

  function renderTools() {
    const page = h('input', { value: v.page, onkeydown: (e) => e.key === 'Enter' && (v.page = Number(e.target.value) || 1) });
    clear(
      tools,
      h('span', { class: 'pdfwin-name' }, icon('pdf'), basename(pdf)),
      h('button', { class: 'icon-btn', title: 'Página anterior', onclick: () => (v.page = v.page - 1) }, icon('chevUp')),
      h('button', { class: 'icon-btn', title: 'Próxima página', onclick: () => (v.page = v.page + 1) }, icon('chevDown')),
      h('span', { class: 'pageinfo' }, page, `/ ${v.pages || '–'}`),
      h('span', { class: 'sep' }),
      h('button', { class: 'icon-btn', title: 'Diminuir', onclick: () => v.zoom(1 / 1.15) }, icon('zoomOut')),
      h('span', { class: 'zoom' }, Math.round((v.viewer.currentScale || 1) * 100) + '%'),
      h('button', { class: 'icon-btn', title: 'Aumentar', onclick: () => v.zoom(1.15) }, icon('zoomIn')),
      h('button', { class: 'icon-btn' + (v.scale === 'page-width' ? ' on' : ''), title: 'Largura da página', onclick: () => v.setScale('page-width') }, icon('fitWidth')),
      h('button', { class: 'icon-btn' + (v.scale === 'page-fit' ? ' on' : ''), title: 'Página inteira', onclick: () => v.setScale('page-fit') }, icon('fitPage')),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn sm', title: 'Tela cheia, um slide por vez', onclick: () => v.present() }, icon('slides'), 'Apresentar'),
      h('button', { class: 'btn sm', title: 'Fecha esta janela e devolve o PDF à janela principal', onclick: () => window.close() }, icon('columns'), 'Voltar à janela principal'),
    );
  }

  const reload = () => v.load(fileUrl(pdf)).catch(() => {});
  const reloadSoon = debounce(reload, 500);
  await reload();
  renderTools();
  connect(`&pdfwin=${encodeURIComponent(pdf)}&root=${encodeURIComponent(root)}`);
  on('ws:open', () => send({ type: 'pdfwin:open', pdf, root }));
  on('pdfwin:ping', () => send({ type: 'pdfwin:open', pdf, root }));
  on('build:done', (e) => (e.docs || []).some((d) => d.pdf === pdf) && reload());
  on('fs:change', (e) => e.files.includes(pdf) && reloadSoon());
  on('sync-show', (e) => e.pdf === pdf && v.showSync(e.hit));
}
