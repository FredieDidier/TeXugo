// latexindent must run (with TeXugo's File::HomeDir stand-in) and indent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLatex, texInfo } from '../server/doctor.js';

test('latexindent formats with two-space indent', { timeout: 60000 }, async () => {
  const info = await texInfo();
  assert.ok(info.latexindent.ok, info.latexindent.reason);
  const src = '\\documentclass{article}\n\\begin{document}\n\\begin{table}\n\\centering\n\\end{table}\n\\end{document}\n';
  const r = await formatLatex(src, '/tmp/x/main.tex');
  assert.match(r.text, /\n {2}\\centering\n/);
  assert.match(r.text, /\n\\begin\{table\}\n/, 'document body stays flush left');
});
