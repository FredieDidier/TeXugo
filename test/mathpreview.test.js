import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { findMath, toKatex, macrosFrom } from '../web/src/mathpreview.js';

const at = (text, marker = '|') => {
  const p = text.indexOf(marker);
  return [text.replace(marker, ''), p];
};

test('finds the math around the cursor', () => {
  let [t, p] = at('Text $a + |b$ more $c$.');
  assert.deepEqual(findMath(t, p), { from: 5, to: 12, tex: 'a + b', display: false });
  [t, p] = at('Text $a$ and |plain.');
  assert.equal(findMath(t, p), null);
  [t, p] = at('Cost \\$5 and \\(x|^2\\) here');
  assert.equal(findMath(t, p).tex, 'x^2');
  [t, p] = at('A\n\\[\n  y = \\beta| x\n\\]\nB');
  assert.equal(findMath(t, p).tex.trim(), 'y = \\beta x');
  [t, p] = at('\\begin{align}\n a &= b \\label{eq:1} \\\\\n c &= |d\n\\end{align}');
  const r = findMath(t, p);
  assert.equal(r.env, 'align');
  assert.equal(toKatex(r), '\\begin{aligned}a &= b  \\\\\n c &= d\\end{aligned}');
  [t, p] = at('$$ x| $$ then $y$');
  assert.equal(findMath(t, p).display, true);
  [t, p] = at('% $not math| here$\nText');
  assert.equal(findMath(t, p), null);
  [t, p] = at('\\begin{equation*}\n e = mc^2 |\n\\end{equation*}');
  assert.equal(findMath(t, p).tex.trim(), 'e = mc^2');
});

test('project macros become KaTeX macros', () => {
  const m = macrosFrom('\\newcommand{\\E}{\\mathbb{E}}\n\\newcommand\\abs[1]{\\left|#1\\right|}\n\\DeclareMathOperator*{\\argmax}{arg\\,max}\n\\def\\R{\\mathbb{R}}\n% \\newcommand{\\no}{x}\n\\renewcommand{\\vec}[1]{\\boldsymbol{#1}}');
  assert.deepEqual(m, { '\\E': '\\mathbb{E}', '\\abs': '\\left|#1\\right|', '\\argmax': '\\operatorname*{arg\\,max}', '\\R': '\\mathbb{R}', '\\vec': '\\boldsymbol{#1}' });
  const html = katex.renderToString('\\E[\\abs{x}] = \\argmax_{\\theta \\in \\R} \\vec{v}', { macros: m, throwOnError: true });
  assert.match(html, /katex/);
});
