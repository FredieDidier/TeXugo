import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareBuild } from '../server/compare.js';

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-cmp-'));
  fs.mkdirSync(path.join(root, 'paper', 'sections'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tables'));
  return root;
}
const MAIN = (body) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\input{sections/a}\n\\input{../tables/t1}\n\\end{document}\n`;

test('a received folder without the generated tables: tables count as unchanged', async () => {
  const root = project();
  const doc = path.join(root, 'paper', 'main.tex');
  fs.writeFileSync(doc, MAIN('Hello brave new world.'));
  fs.writeFileSync(path.join(root, 'paper', 'sections', 'a.tex'), 'Section A new text.\n');
  fs.writeFileSync(path.join(root, 'tables', 't1.tex'), 'Table one: 0.12.\n');
  const recv = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-recv-'));
  fs.mkdirSync(path.join(recv, 'sections'), { recursive: true });
  fs.writeFileSync(path.join(recv, 'main.tex'), MAIN('Hello world.'));
  fs.writeFileSync(path.join(recv, 'sections', 'a.tex'), 'Section A new text.\n');
  const r = await compareBuild(doc, { kind: 'path', path: recv });
  assert.ok(fs.existsSync(r.pdf));
  assert.deepEqual(r.changedFiles, ['main.tex']);
  assert.deepEqual(r.fromCurrent, ['../tables/t1.tex']);
  const tex = fs.readFileSync(r.tex, 'utf8');
  assert.match(tex, /\\DIFadd\{brave new \}/);
  assert.doesNotMatch(tex, /\\DIFadd\{Table one/);
});

test('against a Git commit', async () => {
  const root = project();
  const doc = path.join(root, 'paper', 'main.tex');
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
  fs.writeFileSync(doc, MAIN('Hello world.'));
  fs.writeFileSync(path.join(root, 'paper', 'sections', 'a.tex'), 'Section A old text.\n');
  fs.writeFileSync(path.join(root, 'tables', 't1.tex'), 'Table one.\n');
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'v1');
  fs.writeFileSync(path.join(root, 'paper', 'sections', 'a.tex'), 'Section A new text.\n');
  const r = await compareBuild(doc, { kind: 'git', rev: 'HEAD' });
  assert.deepEqual(r.changedFiles, ['sections/a.tex']);
  assert.equal(r.added, 1);
  assert.equal(r.deleted, 1);
  const tex = fs.readFileSync(r.tex, 'utf8');
  assert.match(tex, /\\DIFdel\{old \}/);
  assert.match(tex, /\\DIFadd\{new \}/);
  await assert.rejects(compareBuild(doc, { kind: 'git', rev: 'HEAD; rm -rf /' }), /inválida/);
});

// A .bbl is generated and usually kept out of Git. latexdiff --flatten pastes
// it in place of \bibliography only on the side that has it, so without the
// fix every reference showed up as new text.
const CITING = (word) => `\\documentclass{article}\n\\begin{document}\nA ${word} claim \\cite{k1}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n`;
const BBL = (who) => `\\begin{thebibliography}{1}\n\\bibitem{k1}\n${who}.\n\\newblock A paper.\n\\newblock 2001.\n\\end{thebibliography}\n`;
const BIB = '@article{k1, author = {Somebody, Ann}, title = {A paper}, journal = {J}, year = {2001}}\n';

test('a .bbl the other version lacks is taken as equal: the references are not marked as new', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-cmp-'));
  const doc = path.join(root, 'main.tex');
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
  fs.writeFileSync(doc, CITING('bold'));
  fs.writeFileSync(path.join(root, 'refs.bib'), BIB);
  fs.writeFileSync(path.join(root, '.gitignore'), '*.bbl\n');
  fs.writeFileSync(path.join(root, 'main.bbl'), BBL('Ann Somebody'));
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'v1');
  fs.writeFileSync(doc, CITING('careful'));
  const r = await compareBuild(doc, { kind: 'git', rev: 'HEAD' });
  const tex = fs.readFileSync(r.tex, 'utf8');
  assert.equal(r.added, 1, tex.slice(tex.indexOf('\\begin{document}')));
  assert.equal(r.deleted, 1);
  assert.doesNotMatch(tex, /\\DIFadd\{[^}]*Somebody/);
});

test('a .bbl that comes with the received version is compared, not replaced', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-cmp-'));
  const doc = path.join(root, 'main.tex');
  fs.writeFileSync(doc, CITING('bold'));
  fs.writeFileSync(path.join(root, 'refs.bib'), BIB);
  fs.writeFileSync(path.join(root, 'main.bbl'), BBL('Ann Somebody'));
  const recv = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-recv-'));
  fs.writeFileSync(path.join(recv, 'main.tex'), CITING('bold'));
  fs.writeFileSync(path.join(recv, 'main.bbl'), BBL('Ann Nobody'));
  const r = await compareBuild(doc, { kind: 'path', path: recv });
  const tex = fs.readFileSync(r.tex, 'utf8');
  assert.match(tex, /\\DIFadd\{Somebody/);
  assert.match(tex, /\\DIFdel\{Nobody/);
});
