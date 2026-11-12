// Markdown preview in the GitHub style: GFM tables, task lists, code,
// images from the project folder, and relative links that open in the app.
import { marked } from 'marked';
import { fileUrl, call } from './api.js';
import { dirname, joinPath } from './dom.js';
import { sanitizeHtml } from './sanitize.js';

marked.setOptions({ gfm: true, breaks: false });

function resolve(baseDir, href) {
  if (/^(https?:|mailto:|#|data:)/.test(href)) return null;
  return joinPath(baseDir, decodeURIComponent(href));
}

export function renderMarkdown(el, text, filePath, app) {
  const baseDir = dirname(filePath);
  // Front matter (--- yaml ---) shows as a small table, like GitHub.
  let front = '';
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    text = text.slice(fm[0].length);
    const rows = fm[1]
      .split('\n')
      .map((l) => l.match(/^([\w-]+):\s*(.*)$/))
      .filter(Boolean)
      .map((m) => `<tr><th>${esc(m[1])}</th><td>${esc(m[2])}</td></tr>`)
      .join('');
    if (rows) front = `<table class="front-matter">${rows}</table>`;
  }
  el.innerHTML = front + sanitizeHtml(marked.parse(text));
  el.querySelectorAll('img').forEach((img) => {
    const p = resolve(baseDir, img.getAttribute('src') || '');
    if (p) img.src = fileUrl(p);
  });
  el.querySelectorAll('a[href]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href.startsWith('#')) {
        const t = el.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
        if (t) t.scrollIntoView({ behavior: 'smooth' });
      } else if (/^https?:/.test(href)) call('openUrl', { url: href.replace(/^http:/, 'https:') }).catch(() => {});
      else {
        const p = resolve(baseDir, href.split('#')[0]);
        if (p) app.openFile(p);
      }
    });
  });
  // GitHub-like heading anchors.
  el.querySelectorAll('h1,h2,h3,h4').forEach((hd) => {
    if (!hd.id) hd.id = hd.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
  });
}

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
