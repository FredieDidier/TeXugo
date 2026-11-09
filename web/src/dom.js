// Tiny DOM helpers: h() builds elements, icon() returns inline SVG icons.
// Every string h() renders goes through tr(), the UI translation.
import { tr } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'title' || k === 'placeholder' || k === 'aria-label') el.setAttribute(k, tr(String(v)));
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(tr(String(c))));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const P = {
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  files: '<path d="M4 4h6l2 2h8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  tex: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 12.5h4M10.5 12.5v5"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 17h8M8 13h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 11.5l2 2 4.5-4.5M8.5 17h7"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3 7V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 19 5.5 10h16L19 19z"/>',
  outline: '<path d="M4 6h16M8 12h12M12 18h8"/><circle cx="4" cy="12" r="0.6"/><circle cx="8" cy="18" r="0.6"/>',
  git: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.2v7.6M18 10.2c0 4-6 3-10.5 6.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
  warn: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  playAll: '<path d="M4 5v14l8-7zM12 5v14l8-7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  newFile: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  newFolder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevLeft: '<path d="m15 6-6 6 6 6"/>',
  chevUp: '<path d="m6 15 6-6 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8 11h6"/>',
  fitWidth: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  fitPage: '<rect x="6" y="3" width="12" height="18" rx="1.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  sync: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  claude: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  invert: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  broom: '<path d="M14 4 10 12M7 13h7l2 7H5z"/><path d="M9 16v4M12 16v4"/>',
  slides: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/>',
  syllabus: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  review: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  letter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  paper: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 12h8M8 16h8"/>',
  papers: '<path d="M8 7V5a2 2 0 0 1 2-2h6l4 4v10a2 2 0 0 1-2 2h-2"/><rect x="4" y="7" width="12" height="14" rx="2"/><path d="M7 12h6M7 16h6"/>',
  blank: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5M15 16l-2 2 2 2"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.file}</svg>`;
  return span.firstChild;
}

export function wordmark() {
  return h('span', { class: 'wordmark' }, 'T', h('span', { class: 'e' }, 'e'), h('span', { class: 'x' }, 'X'), h('span', { class: 'ugo' }, 'ugo'));
}

export function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'tex' || ext === 'sty' || ext === 'cls') return icon('tex');
  if (ext === 'pdf') return icon('pdf');
  if (ext === 'bib') return icon('book');
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'eps'].includes(ext)) return icon('image');
  return icon('file');
}

export function fileKind(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['tex', 'sty', 'cls'].includes(ext)) return 'tex';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'bib') return 'bib';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) return 'image';
  return 'text';
}

export function basename(p) {
  return p.split('/').pop();
}

export function relPath(root, p) {
  return p.startsWith(root + '/') ? p.slice(root.length + 1) : p;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

let toastBox;
export function toast(message, kind = 'info', ms = 4200) {
  if (!toastBox) document.body.append((toastBox = h('div', { class: 'toasts' })));
  const ico = { error: 'error', ok: 'checkCircle', warn: 'warn', info: 'info' }[kind] || 'info';
  const el = h('div', { class: `toast ${kind}` }, icon(ico), h('div', {}, message));
  toastBox.append(el);
  setTimeout(() => el.remove(), ms);
}

// Context/dropdown menu at a point. items: [{label, icon, kb, action, danger}] or 'sep'.
export function menu(x, y, items) {
  closeMenus();
  const m = h(
    'div',
    { class: 'menu' },
    items.filter(Boolean).map((it) =>
      it === 'sep'
        ? h('div', { class: 'sep' })
        : h('div', { class: 'mi' + (it.danger ? ' danger' : ''), title: it.title, onclick: () => (closeMenus(), it.action()) }, it.icon ? icon(it.icon) : h('span', { style: { width: '16px' } }), it.label, it.kb ? h('span', { class: 'kb' }, it.kb) : null),
    ),
  );
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  return m;
}
function onDocDown(e) {
  if (!e.target.closest('.menu')) closeMenus();
}
export function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  document.removeEventListener('mousedown', onDocDown, true);
}

// Modal dialog. Returns { el, close }.
export function modal({ title, body, footer, wide, onClose }) {
  const overlay = h('div', { class: 'overlay' });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose && onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  const el = h('div', { class: 'modal' + (wide ? ' wide' : '') }, title ? h('header', {}, title, h('span', { class: 'grow' }), h('button', { class: 'icon-btn', onclick: close }, icon('x'))) : null, h('div', { class: 'body' }, body), footer ? h('footer', {}, footer) : null);
  overlay.append(el);
  overlay.addEventListener('mousedown', (e) => e.target === overlay && close());
  document.body.append(overlay);
  return { el, close };
}

export function prompt(title, { value = '', placeholder = '', ok = 'OK', label } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { value, placeholder, style: { width: '100%' } });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal({
      title,
      body: h('div', { class: 'field' }, label ? h('label', {}, label) : null, input),
      footer: [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'), h('button', { class: 'btn primary', onclick: () => finish(input.value.trim() || null) }, ok)],
      onClose: () => finish(null),
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && finish(input.value.trim() || null));
    setTimeout(() => {
      input.focus();
      const dot = value.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : value.length);
    }, 0);
  });
}

export function confirmBox(title, text, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal({
      title,
      body: h('div', {}, text),
      footer: [h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancelar'), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true) }, ok)],
      onClose: () => finish(false),
    });
  });
}

// Drag-to-resize gutter. getSize/setSize work in pixels.
export function gutter(dir, { getSize, setSize, invert = false }) {
  const g = h('div', { class: 'gutter' + (dir === 'h' ? ' h' : '') });
  g.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = dir === 'h' ? e.clientY : e.clientX;
    const s0 = getSize();
    g.classList.add('drag');
    document.body.style.cursor = dir === 'h' ? 'row-resize' : 'col-resize';
    const move = (ev) => {
      const d = (dir === 'h' ? ev.clientY : ev.clientX) - start;
      setSize(s0 + (invert ? -d : d));
    };
    const up = () => {
      g.classList.remove('drag');
      document.body.style.cursor = '';
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
  return g;
}
