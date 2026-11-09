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
