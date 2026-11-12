// What raw HTML a Markdown file may carry into the preview: the tags GitHub
// keeps (details, sup, kbd, tables, images with a width...), without
// scripts, event handlers, styles, forms, frames or <base>. A cloned
// repository's README must not be able to run anything or redraw the app;
// the page's CSP stays as a second barrier, not the only one.
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'button', 'select', 'textarea', 'option', 'base', 'link', 'meta', 'title', 'head', 'svg', 'math', 'template', 'noscript', 'audio', 'video', 'source', 'track', 'canvas', 'dialog', 'portal']);
const KEEP = new Set(['a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'tt', 'u', 'ul', 'var', 'wbr']);
const ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'open', 'start', 'reversed', 'type', 'checked', 'disabled', 'lang', 'dir', 'cite', 'datetime', 'class']);
// class only for code highlighting: an app class (a fixed overlay, a modal)
// would let a README redraw the window. No id: it could shadow the app's.
const URL_ATTRS = new Set(['href', 'src', 'cite']);

function safeUrl(v, attr) {
  const s = v.replace(/[\x00-\x20\x7f]/g, '').toLowerCase();
  if (/^data:/.test(s)) return attr === 'src' && /^data:image\/(png|gif|jpe?g|webp);/.test(s);
  return !/^(javascript|vbscript|file|blob):/.test(s);
}

export function sanitizeHtml(html) {
  // A <template> parses without running anything or loading images.
  const t = document.createElement('template');
  t.innerHTML = html;
  const walk = (node) => {
    for (const el of [...node.children]) {
      const tag = el.tagName.toLowerCase();
      if (DROP.has(tag) || (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() !== 'checkbox')) {
        el.remove();
        continue;
      }
      walk(el);
      if (!KEEP.has(tag)) {
        el.replaceWith(...el.childNodes); // unknown tag: keep its text
        continue;
      }
      for (const a of [...el.attributes]) {
        const name = a.name.toLowerCase();
        const bad = !ATTRS.has(name) || (URL_ATTRS.has(name) && !safeUrl(a.value, name)) || (name === 'class' && !/^language-[\w+-]+$/.test(a.value));
        if (bad) el.removeAttribute(a.name);
      }
      if (tag === 'input') el.setAttribute('disabled', '');
    }
  };
  walk(t.content);
  return t.innerHTML;
}
