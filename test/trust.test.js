// I8: projects that bring a latexmkrc or a .claude/ folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { riskyItems, underTrusted, setTrustCheck, claudeSourceFlags } from '../server/trust.js';
import { rcInfo } from '../server/outdirs.js';

test('risky items: .claude settings and latexmkrc in the root or a document folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-trust-'));
  assert.deepEqual(riskyItems(root), []);
  fs.mkdirSync(path.join(root, '.claude'));
  assert.deepEqual(riskyItems(root), [], 'an empty .claude/ runs nothing');
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}');
  fs.mkdirSync(path.join(root, 'latex'));
  fs.writeFileSync(path.join(root, 'latex', '.latexmkrc'), '$pdf_mode = 1;');
  assert.deepEqual(riskyItems(root, [path.join(root, 'latex')]), ['.claude/ (settings.json)', path.join('latex', '.latexmkrc')]);
});

test('trusted roots cover their subfolders only', () => {
  assert.ok(underTrusted(['/a/b'], '/a/b'));
  assert.ok(underTrusted(['/a/b'], '/a/b/latex'));
  assert.ok(!underTrusted(['/a/b'], '/a/bc'));
  assert.ok(!underTrusted([], '/a/b'));
});

test('untrusted project: claude -p only with the user settings; latexmk not asked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-trust-'));
  fs.writeFileSync(path.join(root, 'latexmkrc'), '$out_dir = "bu" . "ild";\n');
  try {
    setTrustCheck((d) => underTrusted([], d));
    assert.deepEqual(claudeSourceFlags(root), ['--setting-sources', 'user']);
    assert.equal(rcInfo(root).outDir, null, 'the Perl in the rc must not run');
    setTrustCheck((d) => underTrusted([root], d));
    assert.deepEqual(claudeSourceFlags(root), []);
    assert.equal(rcInfo(root).outDir, path.join(root, 'build'));
  } finally {
    setTrustCheck(() => true);
  }
});
