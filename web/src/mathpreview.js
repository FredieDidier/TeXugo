// Equation preview: while the cursor is inside math ($…$, \(…\), \[…\],
// $$…$$, equation, align, gather, multline…), the formula is drawn with
// KaTeX just above it, with the project's own \newcommand and
// \DeclareMathOperator macros. No build needed.
import katex from 'katex';
import { StateField } from '@codemirror/state';
import { showTooltip, EditorView } from '@codemirror/view';
import { blankComments } from '../../server/texmacros.js';
export { macrosFrom } from '../../server/texmacros.js';

export const mathPreview = { on: true, macros: {} };

const ENVS = ['equation', 'align', 'gather', 'multline', 'flalign', 'alignat', 'eqnarray', 'displaymath', 'math', 'dmath'];
const WINDOW = 8000;

// The math region around pos, or null. Pure (tested).
export function findMath(text, pos) {
  const off = Math.max(0, pos - WINDOW);
  const s = blankComments(text.slice(off, Math.min(text.length, pos + WINDOW)));
  const p = pos - off;
  // 1. Environments.
  const envRe = new RegExp(`\\\\(begin|end)\\{(${ENVS.join('|')})(\\*?)\\}`, 'g');
  const stack = [];
  let m;
  while ((m = envRe.exec(s)) && m.index < p) {
    if (m[1] === 'begin') stack.push({ env: m[2] + m[3], start: m.index, body: m.index + m[0].length });
    else if (stack.length && stack[stack.length - 1].env === m[2] + m[3]) stack.pop();
  }
  if (stack.length) {
    const open = stack[0];
    const endRe = new RegExp(`\\\\end\\{${open.env.replace('*', '\\*')}\\}`, 'g');
    endRe.lastIndex = Math.max(p - 1, open.body);
    const e = endRe.exec(s);
    if (e && p <= e.index + e[0].length) return { from: off + open.start, to: off + e.index + e[0].length, tex: s.slice(open.body, e.index), env: open.env.replace('*', ''), display: true };
  }
  // 2. \[ \] and \( \).
  for (const [o, c, display] of [['\\[', '\\]', true], ['\\(', '\\)', false]]) {
    const a = s.lastIndexOf(o, p - 1);
    if (a < 0) continue;
    const closedBefore = s.indexOf(c, a + 2);
    if (closedBefore >= 0 && closedBefore + 2 <= p - 1) continue;
    const b = s.indexOf(c, Math.max(a + 2, p - 2));
    if (b >= 0 && p <= b + 2) return { from: off + a, to: off + b + 2, tex: s.slice(a + 2, b), display };
  }
  // 3. $…$ and $$…$$ inside the paragraph.
  const paraStart = Math.max(s.lastIndexOf('\n\n', p - 1) + 1, 0);
  let paraEnd = s.indexOf('\n\n', p);
  if (paraEnd < 0) paraEnd = s.length;
  const para = s.slice(paraStart, paraEnd);
  const re = /(?<!\\)\$\$?/g;
  const toks = [];
  while ((m = re.exec(para))) toks.push({ i: paraStart + m.index, len: m[0].length });
  for (let i = 0; i + 1 < toks.length; ) {
    const a = toks[i];
    const j = toks.findIndex((t, k) => k > i && t.len === a.len);
    if (j < 0) break;
    const b = toks[j];
    if (p > a.i && p <= b.i + b.len) return { from: off + a.i, to: off + b.i + b.len, tex: s.slice(a.i + a.len, b.i), display: a.len === 2 };
    i = j + 1;
  }
  return null;
}

// What KaTeX gets: labels and numbering commands out, multi-line
// environments turned into their KaTeX equivalents.
export function toKatex(region) {
  let t = region.tex.replace(/\\label\s*\{[^}]*\}/g, '').replace(/\\(nonumber|notag)\b/g, '').trim();
  const env = region.env;
  if (env === 'align' || env === 'flalign' || env === 'alignat') t = `\\begin{aligned}${env === 'alignat' ? t.replace(/^\{\d+\}/, '') : t}\\end{aligned}`;
  else if (env === 'gather' || env === 'multline') t = `\\begin{gathered}${t}\\end{gathered}`;
  else if (env === 'eqnarray') t = `\\begin{array}{rcl}${t}\\end{array}`;
  return t;
}

function render(region) {
  const dom = document.createElement('div');
  dom.className = 'math-tip';
  try {
    dom.innerHTML = katex.renderToString(toKatex(region), { displayMode: true, throwOnError: true, strict: 'ignore', trust: false, macros: { ...mathPreview.macros }, maxExpand: 500 });
  } catch (err) {
    dom.classList.add('error');
    dom.textContent = String(err.message || err).replace(/^KaTeX parse error:\s*/, 'Erro na fórmula: ');
  }
  return dom;
}

function tooltipFor(state) {
  if (!mathPreview.on) return null;
  const sel = state.selection.main;
  const region = findMath(state.doc.toString(), sel.head);
  if (!region || !region.tex.trim() || region.tex.length > 4000) return null;
  if (!sel.empty && (sel.from < region.from || sel.to > region.to)) return null;
  return { pos: region.from, above: true, strictSide: false, arrow: false, create: () => ({ dom: render(region) }) };
}

const field = StateField.define({
  create: (state) => tooltipFor(state),
  update(tip, tr) {
    if (!tr.docChanged && !tr.selection) return tip;
    return tooltipFor(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

export function mathPreviewExtension(path) {
  if (!/\.(tex|ltx|sty|cls)$/i.test(path || '')) return [];
  return [field, EditorView.baseTheme({ '.cm-tooltip:has(> .math-tip)': { border: 'none', background: 'transparent' } })];
}
