import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeKeepingLink } from '../server/util.js';
import { pct } from '../server/rr.js';

test('saving through a symbolic link keeps the link and the shared file gets the text', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-link-'));
  fs.mkdirSync(path.join(d, 'shared'));
  fs.writeFileSync(path.join(d, 'shared', 'library.bib'), '@a{A}\n');
  fs.symlinkSync(path.join(d, 'shared', 'library.bib'), path.join(d, 'refs.bib'));
  writeKeepingLink(path.join(d, 'refs.bib'), '@a{A}\n@b{B}\n');
  assert.ok(fs.lstatSync(path.join(d, 'refs.bib')).isSymbolicLink());
  assert.match(fs.readFileSync(path.join(d, 'shared', 'library.bib'), 'utf8'), /@b\{B\}/);
});

test('saving keeps the file mode', { skip: process.platform === 'win32' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-mode-'));
  const f = path.join(d, 'run.sh');
  fs.writeFileSync(f, 'echo a\n');
  fs.chmodSync(f, 0o755);
  writeKeepingLink(f, 'echo b\n');
  assert.equal(fs.statSync(f).mode & 0o777, 0o755);
});

test('model text in \\todo and \\change cannot comment out the brace', () => {
  assert.equal(pct('up 5% and 3\\% ok%%'), 'up 5\\% and 3\\% ok\\%\\%');
});
