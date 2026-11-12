// I2: copies of unsaved tabs, kept outside the project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-rec-'));
process.env.TEXUGO_DATA_DIR = path.join(TMP, 'data');
const rec = await import('../server/recovery.js');

test('recovery: copies differ from disk, stay out of the project, go when clean', () => {
  const root = path.join(TMP, 'proj');
  fs.mkdirSync(root);
  const a = path.join(root, 'paper.tex');
  const b = path.join(root, 'intro.tex');
  fs.writeFileSync(a, 'disk A\n');
  fs.writeFileSync(b, 'disk B\n');
  assert.equal(rec.sync(root, [{ path: a, text: 'typed A\n' }, { path: b, text: 'typed B\n' }]), 2);
  assert.deepEqual(fs.readdirSync(root).sort(), ['intro.tex', 'paper.tex'], 'nothing written in the project');
  let list = rec.list(root);
  assert.deepEqual(list.map((c) => [path.basename(c.path), c.text, c.disk]), [['intro.tex', 'typed B\n', 'disk B\n'], ['paper.tex', 'typed A\n', 'disk A\n']]);
  // intro.tex was saved: its copy goes on the next sync.
  rec.sync(root, [{ path: a, text: 'typed A again\n' }]);
  list = rec.list(root);
  assert.deepEqual(list.map((c) => [path.basename(c.path), c.text]), [['paper.tex', 'typed A again\n']]);
  // Saved by another route before the crash: the copy equals the disk and is dropped.
  fs.writeFileSync(a, 'typed A again\n');
  assert.deepEqual(rec.list(root), []);
  // A file deleted on disk is reported as missing.
  rec.sync(root, [{ path: b, text: 'keep me\n' }]);
  fs.rmSync(b);
  assert.equal(rec.list(root)[0].missing, true);
  rec.drop(root, [b]);
  assert.deepEqual(rec.list(root), []);
  // Nothing dirty: the project's recovery folder goes away.
  rec.sync(root, []);
  assert.ok(!fs.existsSync(path.join(TMP, 'data', 'recovery')) || fs.readdirSync(path.join(TMP, 'data', 'recovery')).length === 0);
});
