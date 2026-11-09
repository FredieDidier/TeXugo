// AI actions: the prompt carries the task, the style and the guard rails;
// the word diff reproduces both texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPrompt, ACTIONS } from '../server/ai.js';
import { wordDiff } from '../web/src/diff.js';

test('prompt: task, read-only tools, markers, project style wins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-ai-'));
  const file = path.join(root, 'paper.tex');
  let p = buildPrompt({ action: 'humanizar', text: 'We delve.', file, root, lang: 'en', hints: [{ text: 'delve', why: 'AI vocabulary' }] });
  assert.match(p, /<texugo>/);
  assert.match(p, /Do not edit any file/);
  assert.match(p, /applied-micro-paper-writing/);
  assert.match(p, /House style/);
  assert.match(p, /"delve": AI vocabulary/);
  fs.writeFileSync(path.join(root, 'estilo.md'), 'Use British spelling.');
  p = buildPrompt({ action: 'traduzir', text: 'Olá.', file, root, lang: 'pt' });
  assert.match(p, /Use British spelling/);
  assert.doesNotMatch(p, /House style/);
  assert.match(p, /must be in English/);
  assert.equal(Object.keys(ACTIONS).length, 9);
  assert.throws(() => buildPrompt({ action: 'nope', text: 'x', file, root }));
});

test('word diff rebuilds both texts', () => {
  const a = 'This paper delves into the intricate interplay \\citep{x}.';
  const b = 'This paper studies the interplay \\citep{x}.';
  const d = wordDiff(a, b);
  assert.equal(d.filter((p) => p.op !== 'ins').map((p) => p.s).join(''), a);
  assert.equal(d.filter((p) => p.op !== 'del').map((p) => p.s).join(''), b);
  assert.ok(d.some((p) => p.op === 'del' && /delves/.test(p.s)));
});
