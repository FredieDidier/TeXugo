// The local API's guards (PRE-LAUNCH-AUDIT.md D7 and I7): paths that leave
// the project, names with ../, git revisions read as options, oversized
// bodies, and the security headers on every kind of response.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-sec-'));
process.env.TEXUGO_DATA_DIR = path.join(TMP, 'data');
const { createServer } = await import('../server/index.js');
const { linkTargetOk } = await import('../server/util.js');

let srv;
const PROJ = path.join(TMP, 'proj');
const api = async (method, args) => {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/${method}`, { method: 'POST', headers: { 'x-texugo-token': srv.token, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  fs.mkdirSync(path.join(PROJ, '.texugo-comments'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'paper.tex'), '\\documentclass{article}\\begin{document}Hi\\end{document}\n');
  fs.writeFileSync(path.join(PROJ, 'page.html'), '<script>alert(1)</script>');
  fs.writeFileSync(path.join(TMP, 'secret.txt'), 'outside');
  srv = await createServer();
  await api('openProject', { root: PROJ });
});
after(() => srv.close());

test('createProject refuses a name that is a path', async () => {
  const r = await api('createProject', { template: 'carta', parent: PROJ, name: '../escaped', fields: {} });
  assert.equal(r.status, 400);
  assert.ok(!fs.existsSync(path.join(TMP, 'escaped')));
});

test('a comment file cannot point outside the project', async () => {
  const id = '20260101-000000-0a0b0c';
  fs.writeFileSync(path.join(PROJ, '.texugo-comments', id + '.json'), JSON.stringify({ id, file: '../secret.txt', anchor: { quote: 'outside' }, date: '2026-01-01', text: 'x', replies: [] }));
  const r = await api('commentsList', { root: PROJ });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes('secret.txt'));
  fs.rmSync(path.join(PROJ, '.texugo-comments', id + '.json'));
});

test('a link to a hidden folder of the home or outside it is refused; one to a normal folder is not', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need admin on Windows');
  fs.symlinkSync('/etc/hosts', path.join(PROJ, 'hosts'));
  const r = await api('read', { path: path.join(PROJ, 'hosts') });
  assert.equal(r.status, 403);
  assert.equal(linkTargetOk([PROJ], path.join(os.homedir(), '.ssh', 'id_rsa')), false);
  assert.equal(linkTargetOk([PROJ], path.join(os.homedir(), 'Dropbox', 'shared', 'library.bib')), true);
  assert.equal(linkTargetOk([PROJ], path.join(PROJ, 'paper.tex')), true);
});

test('an oversized body is cut off', async () => {
  const big = 'x'.repeat(51 * 1024 * 1024);
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/hello`, { method: 'POST', headers: { 'x-texugo-token': srv.token }, body: big }).catch((e) => ({ status: 'closed', e }));
  assert.ok(r.status === 413 || r.status === 'closed', String(r.status));
});

test('security headers: CSP on the page, sandbox and nosniff on project files', async () => {
  const page = await fetch(`http://127.0.0.1:${srv.port}/`);
  const csp = page.headers.get('content-security-policy') || '';
  for (const d of ["base-uri 'none'", "form-action 'none'", "object-src 'none'", "frame-src 'none'", "script-src 'self'"]) assert.ok(csp.includes(d), d);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const file = await fetch(`http://127.0.0.1:${srv.port}/file?t=${srv.token}&p=${encodeURIComponent(path.join(PROJ, 'page.html'))}`);
  assert.equal(file.headers.get('content-security-policy'), 'sandbox');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
});

test('the WebSocket refuses another origin', async () => {
  const { WebSocket } = await import('ws');
  const open = (origin) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?t=${srv.token}`, { origin });
      ws.on('open', () => (ws.close(), resolve(true)));
      ws.on('error', () => resolve(false));
    });
  assert.equal(await open(`http://127.0.0.1:${srv.port}`), true);
  assert.equal(await open('https://example.org'), false);
});

test('comments are written without e-mail, and old ones can be cleaned', async () => {
  const comments = await import('../server/comments.js');
  const c = await comments.create(PROJ, { file: path.join(PROJ, 'paper.tex'), anchor: { quote: 'Hi' }, text: 'A note' });
  await comments.reply(PROJ, c.id, 'A reply');
  await comments.resolve(PROJ, c.id, true);
  const disk = fs.readFileSync(path.join(PROJ, '.texugo-comments', c.id + '.json'), 'utf8');
  assert.ok(!disk.includes('"email"'), disk);
  const old = { ...JSON.parse(disk), id: '20260101-000000-abcdef', email: 'a@example.org', replies: [{ author: 'B', email: 'b@example.org', date: '2026-01-01', text: 'x' }] };
  fs.writeFileSync(path.join(PROJ, '.texugo-comments', old.id + '.json'), JSON.stringify(old));
  assert.ok(!JSON.stringify((await comments.list(PROJ)).items).includes('example.org'));
  assert.equal(comments.stripEmails(PROJ), 1);
  assert.ok(!fs.readFileSync(path.join(PROJ, '.texugo-comments', old.id + '.json'), 'utf8').includes('example.org'));
  assert.equal(comments.stripEmails(PROJ), 0);
});
