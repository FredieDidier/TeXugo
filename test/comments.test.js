import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchorAt, locate } from '../server/anchor.js';
import * as comments from '../server/comments.js';

const TEXT = 'Intro.\nCafés cluster near universities.\nMore text here.\nCafés cluster near universities.\nEnd.\n';

test('a passage is found again by its text and its surroundings', () => {
  const second = TEXT.lastIndexOf('Cafés');
  const a = anchorAt(TEXT, second, second + 'Cafés cluster'.length);
  assert.equal(a.line, 4);
  // Lines added above: same passage, new line.
  const moved = 'New line.\nAnother.\n' + TEXT;
  const at = locate(moved, a);
  assert.equal(at.line, 6);
  assert.equal(moved.slice(at.from, at.to), 'Cafés cluster');
  assert.equal(at.exact, true);
  // Rewrapped: still found, not exact.
  const a2 = anchorAt(TEXT, 7, 7 + 'Cafés cluster near universities'.length);
  const wrapped = TEXT.replace('Cafés cluster near universities.\nMore', 'Cafés cluster\n  near universities.\nMore');
  const at2 = locate(wrapped, a2);
  assert.equal(at2.exact, false);
  assert.equal(wrapped.slice(at2.from, at2.to), 'Cafés cluster\n  near universities');
  // Rewritten: gone.
  assert.equal(locate('Nothing like it.', a2), null);
});

test('threads: create, reply, resolve, reanchor, delete; one file each', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-cm-'));
  const f = path.join(root, 'paper.tex');
  fs.writeFileSync(f, TEXT);
  const from = TEXT.indexOf('universities');
  const c = await comments.create(root, { file: f, anchor: anchorAt(TEXT, from, from + 12), text: '  Which universities?  ' });
  assert.equal(c.file, 'paper.tex');
  assert.equal(c.text, 'Which universities?');
  assert.ok(fs.existsSync(path.join(root, '.texugo-comments', c.id + '.json')));
  await comments.reply(root, c.id, 'The ten largest.');
  await comments.resolve(root, c.id, true);
  let l = await comments.list(root);
  assert.equal(l.items.length, 1);
  assert.equal(l.items[0].replies[0].text, 'The ten largest.');
  assert.ok(l.items[0].resolved);
  assert.equal(l.items[0].at.line, 2);
  assert.equal(l.items[0].path, f);
  await comments.reanchor(root, c.id, { quote: 'Intro', before: '', after: '.', line: 1 });
  l = await comments.list(root);
  assert.equal(l.items[0].at.line, 1);
  await assert.rejects(() => comments.reply(root, '../x', 'hi'));
  comments.remove(root, c.id);
  assert.equal(fs.existsSync(path.join(root, '.texugo-comments')), false);
});
