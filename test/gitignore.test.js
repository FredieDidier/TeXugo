// The .gitignore block TeXugo adds in a Git project: build files, the .bbl,
// every PDF (documents and figures) and a latexmkrc output folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-gi-'));
process.env.TEXUGO_DATA_DIR = path.join(TMP, 'data');
const { createServer } = await import('../server/index.js');
const srv = await createServer();
after(() => srv.close());
const api = async (method, args) => {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/${method}`, { method: 'POST', headers: { 'x-texugo-token': srv.token, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  return r.json();
};

test('gitignore: .bbl, every PDF and the latexmkrc out_dir', async () => {
  const proj = path.join(TMP, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'slides'));
  fs.mkdirSync(path.join(proj, 'figures'));
  fs.writeFileSync(path.join(proj, 'figures', 'map.pdf'), '%PDF');
  fs.writeFileSync(path.join(proj, 'paper.tex'), '\\documentclass{article}\\begin{document}Hi\\end{document}\n');
  fs.writeFileSync(path.join(proj, 'slides', 'talk.tex'), '\\documentclass{beamer}\\begin{document}Hi\\end{document}\n');
  fs.writeFileSync(path.join(proj, 'slides', 'latexmkrc'), '$out_dir = "build";\n');
  fs.writeFileSync(path.join(proj, '.gitignore'), 'data/\n');
  await api('openProject', { root: proj });
  const lines = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8').split('\n');
  for (const want of ['data/', '*.pdf', '*.bbl', '*.aux', '/slides/build/']) assert.ok(lines.includes(want), want + ' in ' + JSON.stringify(lines));
  // Opening again adds nothing.
  const before = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
  await api('openProject', { root: proj });
  assert.equal(fs.readFileSync(path.join(proj, '.gitignore'), 'utf8'), before);
});
