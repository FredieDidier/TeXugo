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
