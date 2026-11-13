// I6: a project with more .tex files than the scan limit (here 3,100 generated
// tables) must still find the paper, its sections and its labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listTexFiles, listDocuments, rootsFor, projectSymbols } from '../server/project.js';

test('3,100 generated tables do not hide the paper', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-i6-'));
  const out = path.join(root, 'analysis', 'output');
  fs.mkdirSync(out, { recursive: true });
  for (let i = 0; i < 3100; i++) fs.writeFileSync(path.join(out, `t${String(i).padStart(4, '0')}.tex`), '\\begin{tabular}{c}1\\end{tabular}\n');
  const w = path.join(root, 'writing');
  fs.mkdirSync(path.join(w, 'sections'), { recursive: true });
  fs.writeFileSync(path.join(w, 'paper.tex'), '\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n');
  fs.writeFileSync(path.join(w, 'sections', 'intro.tex'), '\\section{Introduction}\\label{sec:intro}\nText.\n');
  try {
    assert.equal(listTexFiles(root).truncated, true);
    const paper = path.join(w, 'paper.tex');
    // Searched inside JSON, where a Windows \ is written \\.
    const inJson = (v, p) => JSON.stringify(v).includes(JSON.stringify(p).slice(1, -1));
    assert.ok(inJson(listDocuments(root), paper), 'paper.tex not found');
    assert.ok(inJson(rootsFor(root, path.join(w, 'sections', 'intro.tex')), paper), 'intro.tex has no root');
    assert.ok(JSON.stringify(projectSymbols(root)).includes('sec:intro'), 'label sec:intro not found');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
