// server/git.js against a local bare remote with two clones (PRE-LAUNCH-AUDIT.md
// item 2): status, the automatic message, commit, sync (commit, pull --rebase,
// push), a real conflict versus a failure that is not one, and the history.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as git from '../server/git.js';

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-git-')));
const REMOTE = path.join(TMP, 'remote.git');
const A = path.join(TMP, 'a');
const B = path.join(TMP, 'b');
const ID = ['-c', 'user.name=A. Author', '-c', 'user.email=author@example.org'];
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
const w = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);

before(() => {
  // Identity for the commits git.js makes, without touching the user's config.
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'A. Author';
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'author@example.org';
  sh(TMP, 'init', '--bare', '-b', 'main', REMOTE);
  sh(TMP, 'clone', '-q', REMOTE, A);
  sh(A, 'checkout', '-q', '-b', 'main');
  w(A, 'paper.tex', 'one\ntwo\nthree\n');
  sh(A, 'add', '-A');
  sh(A, ...ID, 'commit', '-q', '-m', 'First draft');
  sh(A, 'push', '-q', '-u', 'origin', 'main');
  sh(TMP, 'clone', '-q', '-b', 'main', REMOTE, B);
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('status: branch, upstream and the changed files', async () => {
  w(A, 'paper.tex', 'one\ntwo changed\nthree\n');
  w(A, 'notes.md', 'new\n');
  const st = await git.status(A);
  assert.equal(st.repo, true);
  assert.equal(st.branch, 'main');
  assert.equal(st.upstream, 'origin/main');
  const byRel = Object.fromEntries(st.files.map((f) => [f.rel, f]));
  assert.equal(byRel['paper.tex'].work, 'M');
  assert.equal(byRel['notes.md'].untracked, true);
  assert.equal((await git.status(TMP)).repo, false);
});

test('diff shows a new file whole', async () => {
  assert.match(await git.diff(A, 'notes.md'), /\+new/);
  assert.match(await git.diff(A, 'paper.tex'), /\+two changed/);
});

test('commit without a message writes one from the files', async () => {
  await git.stage(A, ['paper.tex', 'notes.md']);
  const r = await git.commit(A, '');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.message, /paper\.tex/);
  assert.match(r.message, /notes\.md/);
  const st = await git.status(A);
  assert.equal(st.files.length, 0);
  assert.equal(st.ahead, 1);
});

test('sync sends the commit; the coauthor receives it', async () => {
  const r = await git.sync(A, 'From A');
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.steps, ['pull', 'push']);
  const p = await git.pull(B);
  assert.equal(p.code, 0, p.stderr);
  assert.match(fs.readFileSync(path.join(B, 'paper.tex'), 'utf8'), /two changed/);
});

test('sync rebases over a coauthor change in another line', async () => {
  w(B, 'paper.tex', 'one\ntwo changed\nthree by B\n');
  assert.equal((await git.sync(B, 'From B')).code, 0);
  w(A, 'paper.tex', 'one by A\ntwo changed\nthree\n');
  const r = await git.sync(A, 'From A again');
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.steps, ['commit “From A again”', 'pull', 'push']);
  assert.equal(fs.readFileSync(path.join(A, 'paper.tex'), 'utf8'), 'one by A\ntwo changed\nthree by B\n');
  const log = await git.log(A);
  assert.equal(log[0].subject, 'From A again');
  assert.equal(log.filter((c) => /^Merge/.test(c.subject)).length, 0);
  assert.equal((await git.log(A, 'notes.md')).length, 1);
});

test('a real conflict is called a conflict, and the commit survives', async () => {
  await git.pull(B);
  w(B, 'paper.tex', 'one by B\ntwo changed\nthree by B\n');
  assert.equal((await git.sync(B, 'B line one')).code, 0);
  w(A, 'paper.tex', 'one by A, edited\ntwo changed\nthree by B\n');
  const r = await git.sync(A, 'A line one');
  assert.equal(r.conflict, true);
  assert.notEqual(r.code, 0);
  assert.equal(sh(A, 'log', '-1', '--pretty=%s').trim(), 'A line one');
  const gitDir = sh(A, 'rev-parse', '--absolute-git-dir').trim();
  assert.ok(!fs.existsSync(path.join(gitDir, 'rebase-merge')) && !fs.existsSync(path.join(gitDir, 'rebase-apply')), 'the rebase was aborted');
  sh(A, 'reset', '-q', '--hard', 'origin/main');
});

test('a pull that fails without a conflict is not called one', async () => {
  sh(A, 'remote', 'set-url', 'origin', path.join(TMP, 'missing.git'));
  w(A, 'paper.tex', 'offline edit\n');
  const r = await git.sync(A, 'Offline');
  assert.notEqual(r.code, 0);
  assert.ok(!r.conflict);
  assert.match(r.stderr, /não foi conflito/);
  sh(A, 'remote', 'set-url', 'origin', REMOTE);
});

test('a new file above the limit asks first; force commits it', async () => {
  const big = path.join(B, 'data.bin');
  fs.writeFileSync(big, Buffer.alloc(1));
  fs.truncateSync(big, (git.LARGE_MB + 1) * 1048576);
  const r = await git.commit(B, 'Data', { all: true });
  assert.equal(r.code, 1);
  assert.deepEqual(r.large.map((f) => f.rel), ['data.bin']);
  const f = await git.commit(B, 'Data', { all: true, force: true });
  assert.equal(f.code, 0, f.stderr);
});
