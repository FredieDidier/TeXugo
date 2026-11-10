import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hunks, pieces } from '../server/textdiff.js';
import * as sent from '../server/sent.js';

const SENT = `\\documentclass{article}
\\begin{document}
\\section{Introduction}
Cafes cluster near universities and
stations in most cities.

We use data from a city census.

\\section{Results}
The effect is large and robust to many checks.

Prices rise by ten percent.
\\end{document}
`;

test('a word diff ignores rewrapping and finds words and paragraphs', () => {
  const b = SENT.replace('universities and\nstations in most', 'universities and stations\nin large').replace('Prices rise', 'A new paragraph.\n\nPrices rise');
  const hs = hunks(SENT, b).map((x) => [SENT.slice(x.aFrom, x.aTo), b.slice(x.bFrom, x.bTo)]);
  assert.deepEqual(hs, [
    ['most', 'large'],
    ['', 'A new paragraph.'],
  ]);
  assert.deepEqual(pieces('in most cities', 'in large cities'), [
    ['eq', 'in '],
    ['del', 'most'],
    ['ins', 'large'],
    ['eq', ' cities'],
  ]);
});

test('the friend’s changes are read against what was sent, not against today', () => {
  // Today: the coauthor's fixes are in (Results rewritten, census sentence edited).
  const today = SENT.replace('The effect is large and robust to many checks.', 'The effect is sizable and survives every robustness check.').replace('We use data from a city census.', 'We use microdata from the 2020 city census.');
  // The friend edited the version that was sent.
  const friend = SENT.replace('in most cities', 'in large cities') // untouched since: applies
    .replace('robust to many checks', 'robust to several checks') // coauthor rewrote it: conflict
    .replace('We use data from', 'We use microdata from') // coauthor made the same fix: done
    .replace('Prices rise by ten percent.', 'Prices rise by 10%.'); // applies
  const items = sent.classify(SENT, friend, today, '/x/paper.tex');
  const by = Object.fromEntries(items.map((s) => [s.theirs.trim(), s.status]));
  assert.equal(by['in large cities'] || by['most cities'] || items.find((s) => /large/.test(s.theirs)).status, 'aplica');
  assert.equal(items.find((s) => /several/.test(s.theirs)).status, 'conflito');
  assert.match(items.find((s) => /several/.test(s.theirs)).mine, /survives every robustness/);
  assert.equal(items.find((s) => /microdata/.test(s.theirs)).status, 'feita');
  assert.equal(items.find((s) => /10%/.test(s.theirs)).status, 'aplica');
  assert.equal(items.length, 4);
});

test('mark a sent version, then read a returned .tex against it, guessing the base', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-sent-'));
  const doc = path.join(root, 'paper.tex');
  fs.writeFileSync(doc, SENT.replace('\\section{Results}', '\\input{results}').replace(/The effect[\s\S]*percent\.\n/, ''));
  fs.writeFileSync(path.join(root, 'results.tex'), '\\section{Results}\nThe effect is large and robust to many checks.\n');
  const m = await sent.mark(root, doc, { to: 'Bruno' });
  assert.equal(m.to, 'Bruno');
  assert.deepEqual(m.files.sort(), ['paper.tex', 'results.tex']);
  assert.equal(sent.list(root).length, 1);
  // Today: the coauthor edits results.tex.
  fs.writeFileSync(path.join(root, 'results.tex'), '\\section{Results}\nThe effect is sizable.\n');
  // The friend sends back only the main file (a lone .tex), edited.
  const back = path.join(root, 'back');
  fs.mkdirSync(back);
  fs.writeFileSync(path.join(back, 'paper.tex'), fs.readFileSync(path.join(root, '.texugo/sent', m.id, 'src/paper.tex'), 'utf8').replace('in most cities', 'in large cities'));
  const fb = await sent.feedback(root, doc, { kind: 'path', path: path.join(back, 'paper.tex') }, { from: 'Carla' });
  assert.equal(fb.base.kind, 'sent');
  assert.equal(fb.base.id, m.id);
  assert.ok(fb.guessed);
  // results.tex was not sent back: it is not read as "deleted".
  assert.equal(fb.items.length, 1);
  assert.equal(fb.items[0].status, 'aplica');
  assert.equal(fb.counts.open, 1);
  const after = sent.decide(root, fb.id, 1, 'aceita');
  assert.equal(after.counts.open, 0);
  assert.equal(sent.list(root)[0].feedback.length, 1);
  // A line of the sent version, found in today's text.
  fs.writeFileSync(doc, '% a new first line\n' + fs.readFileSync(doc, 'utf8'));
  const ml = sent.mapLine(root, m.id, doc, 5, { marked: 'stations in most cities' });
  assert.equal(ml.ok, true);
  assert.equal(ml.line, 6);
  assert.equal(ml.changed, false);
  assert.throws(() => sent.remove(root, '../x'), /inválida/);
});
