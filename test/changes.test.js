import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChanges } from '../web/src/changes.js';

test('change marks: added, changed and deleted lines', () => {
  const a = 'one\ntwo\nthree\nfour\nfive';
  const b = 'one\nTWO\nthree\nnew\nfour';
  const { marks, dels } = lineChanges(a, b);
  assert.equal(marks.get(1), 'mod'); // two -> TWO
  assert.equal(marks.get(3), 'add'); // new
  assert.ok(!marks.has(0) && !marks.has(2) && !marks.has(4));
  assert.ok(dels.has(4)); // "five" removed after the last line
  assert.equal(lineChanges(a, a).marks.size, 0);
});

// I10: the margin marks are computed on every keystroke; a 2,000-line file
// edited near the top and the bottom must stay well under one frame.
test('change marks: fast enough to run while typing (2,000 lines)', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { changesField } = await import('../web/src/changes.js');
  const lines = Array.from({ length: 2000 }, (_, i) => `Line ${i} of the paper, with some words to compare.`);
  let state = EditorState.create({ doc: lines.join('\n'), extensions: [changesField] });
  state = state.update({ changes: { from: state.doc.line(5).from, insert: 'edit near the top ' } }).state;
  state = state.update({ changes: { from: state.doc.line(1990).from, insert: 'edit near the end ' } }).state;
  const runs = 50;
  const t0 = performance.now();
  for (let k = 0; k < runs; k++) state = state.update({ changes: { from: state.doc.line(1000).from, insert: 'x' } }).state;
  const per = (performance.now() - t0) / runs;
  assert.ok(per < 4, `${per.toFixed(2)} ms per keystroke`);
  // Marks stay exact: three changed lines, nothing else.
  const { marks } = (await import('../web/src/changes.js')).lineChanges(lines.join('\n'), state.doc.toString());
  assert.deepEqual([...marks.keys()].sort((a, b) => a - b), [4, 999, 1989]);
});

test('change marks: Myers matches the old rules on mixed runs', async () => {
  const { lineChanges } = await import('../web/src/changes.js');
  // two deleted, one added in their place -> one mod and a deletion notch
  let r = lineChanges('a\nb\nc\nd', 'a\nX\nd');
  assert.equal(r.marks.get(1), 'mod');
  assert.ok(r.dels.has(1));
  // one deleted, two added -> mod then add
  r = lineChanges('a\nb\nd', 'a\nX\nY\nd');
  assert.equal(r.marks.get(1), 'mod');
  assert.equal(r.marks.get(2), 'add');
  assert.equal(r.dels.size, 0);
  // deletion at the very top
  r = lineChanges('z\na\nb', 'a\nb');
  assert.ok(r.dels.has(-1));
});

test('change marks: insert before delete in one run', async () => {
  const { lineChanges } = await import('../web/src/changes.js');
  for (const [a, b] of [['a\nb\nc', 'a\nX\nY\nc'], ['a\nb\nb2\nc', 'a\nX\nc'], ['p\nq', 'r\ns\nt'], ['', 'one\ntwo']]) {
    const r = lineChanges(a, b);
    const y = b.split('\n');
    for (const k of r.marks.keys()) assert.ok(k >= 0 && k < y.length, `${JSON.stringify([a, b])} mark ${k}`);
  }
});
