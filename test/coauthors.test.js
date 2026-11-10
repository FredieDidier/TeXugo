import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { news, markSeen, readVisit, blame, headings, sectionsFor, hunkRanges, newsDiff, showCommit } from '../server/coauthors.js';

const PAPER = (intro, data) => `\\documentclass{article}
\\begin{document}
\\section{Introduction}
${intro}
\\section{Data and \\emph{sample}}\\label{sec:data}
${data}
\\end{document}
`;

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-co-'));
  const g = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' }).toString();
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Ana Souza');
  g('config', 'user.email', 'ana@example.org');
  g('config', 'commit.gpgsign', 'false');
  const as = (name, email, msg) => g('-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-am', msg);
  return { root, g, as };
}

test('headings and the sections a range touches', () => {
  const text = PAPER('Intro text.', 'Data text.');
  const hs = headings(text);
  assert.deepEqual(hs.map((x) => [x.title, x.line]), [['Introduction', 3], ['Data and sample', 5]]);
  assert.deepEqual(sectionsFor(hs, [[4, 4]]).map((s) => s.title), ['Introduction']);
  assert.deepEqual(sectionsFor(hs, [[4, 6]]).map((s) => s.title), ['Introduction', 'Data and sample']);
  assert.deepEqual(sectionsFor(hs, [[1, 1]]).map((s) => s.title), [null]);
});

test('hunk ranges from a -U0 diff', () => {
  const d = 'diff --git a/x.tex b/x.tex\n--- a/x.tex\n+++ b/x.tex\n@@ -4 +4,2 @@\n-a\n+b\n+c\n@@ -9,2 +10,0 @@\n-x\n-y\n';
  assert.deepEqual(hunkRanges(d).get('x.tex'), [[4, 5], [10, 10]]);
});

test('news since the last visit: per coauthor, with sections; yours left out', async () => {
  const { root, g, as } = repo();
  const f = path.join(root, 'paper.tex');
  fs.writeFileSync(f, PAPER('Intro text.', 'Data text.'));
  g('add', '.');
  g('commit', '-q', '-m', 'first');

  // First visit: nothing to show, the mark is set.
  const first = await news(root);
  assert.equal(first.firstVisit, true);
  assert.equal(first.count, 0);
  assert.ok(await readVisit(root));

  fs.writeFileSync(f, PAPER('Intro text, now longer.', 'Data text.'));
  as('Bruno Lima', 'bruno@example.org', 'Rewrites the intro');
  fs.writeFileSync(f, PAPER('Intro text, now longer.', 'Data text with a new sample.'));
  as('Bruno Lima', 'bruno@example.org', 'Sample');
  fs.writeFileSync(path.join(root, 'notes.md'), 'hi\n');
  g('add', '.');
  g('commit', '-q', '-m', 'mine'); // Ana herself

  const n = await news(root);
  assert.equal(n.firstVisit, false);
  assert.equal(n.count, 2);
  assert.equal(n.authors.length, 1);
  const b = n.authors[0];
  assert.equal(b.name, 'Bruno Lima');
  assert.equal(b.commits.length, 2);
  assert.equal(b.files[0].rel, 'paper.tex');
  assert.deepEqual(b.files[0].sections.sort(), ['Data and sample', 'Introduction']);

  // Seen: the panel pins the old base, a fresh look shows nothing.
  const base = n.baseline.hash;
  await markSeen(root);
  assert.equal((await news(root)).count, 0);
  assert.equal((await news(root, { base })).count, 2);
  // By days instead of visits.
  assert.equal((await news(root, { since: 7 })).count, 2);
});

test('blame of the editor buffer: committed lines by author, new lines local', async () => {
  const { root, g, as } = repo();
  const f = path.join(root, 'paper.tex');
  fs.writeFileSync(f, PAPER('Intro text.', 'Data text.'));
  g('add', '.');
  g('commit', '-q', '-m', 'first');
  fs.writeFileSync(f, PAPER('Intro by Bruno.', 'Data text.'));
  as('Bruno Lima', 'bruno@example.org', 'intro');
  const buf = PAPER('Intro by Bruno.', 'Data text, edited and unsaved.');
  const r = await blame(root, { file: f, text: buf });
  assert.equal(r.tracked, true);
  assert.equal(r.lines.length, buf.split('\n').length - 1);
  const who = (i) => r.commits[r.lines[i]];
  assert.equal(who(3).author, 'Bruno Lima');
  assert.equal(who(3).me, false);
  assert.equal(who(2).author, 'Ana Souza');
  assert.equal(who(2).me, true);
  assert.equal(who(5).local, true);

  fs.writeFileSync(path.join(root, 'new.tex'), 'x\n');
  assert.equal((await blame(root, { file: path.join(root, 'new.tex'), text: 'x\n' })).tracked, false);
});

test('file paths come back under the path the project was opened by', async () => {
  const { root, g, as } = repo();
  fs.writeFileSync(path.join(root, 'paper.tex'), PAPER('a', 'b'));
  g('add', '.');
  g('commit', '-q', '-m', 'first');
  await news(root);
  fs.writeFileSync(path.join(root, 'paper.tex'), PAPER('a2', 'b'));
  as('Bruno Lima', 'bruno@example.org', 'x');
  const n = await news(root);
  assert.equal(n.authors[0].files[0].path, path.join(root, 'paper.tex'));
});

test('sections carry their current line, and diffs take project paths', async () => {
  const { root, g, as } = repo();
  const f = path.join(root, 'paper.tex');
  fs.writeFileSync(f, PAPER('a', 'b'));
  g('add', '.');
  g('commit', '-q', '-m', 'first');
  await news(root);
  fs.writeFileSync(f, PAPER('a', 'b changed'));
  as('Bruno Lima', 'bruno@example.org', 'x');
  const n = await news(root);
  assert.equal(n.authors[0].files[0].lines['Data and sample'], 5);
  const d = await newsDiff(root, { from: n.baseline.hash, file: f });
  assert.match(d, /\+b changed/);
  assert.match(await showCommit(root, { rev: n.head, file: f }), /Bruno Lima/);
});
