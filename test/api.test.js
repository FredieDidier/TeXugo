// The local API (PRE-LAUNCH-AUDIT.md item 8): the token, the host guard,
// path guards (outside the project, ../, links), the write conflict and
// saving through a link. security.test.js covers the other guards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-api-')));
process.env.TEXUGO_DATA_DIR = path.join(TMP, 'data');
const { createServer } = await import('../server/index.js');

let srv;
const PROJ = path.join(TMP, 'proj');
const OUT = path.join(TMP, 'outside');
const post = (method, args, headers = {}) =>
  fetch(`http://127.0.0.1:${srv.port}/api/${method}`, { method: 'POST', headers: { 'x-texugo-token': srv.token, 'content-type': 'application/json', ...headers }, body: JSON.stringify(args || {}) });
const api = async (method, args) => {
  const r = await post(method, args);
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  fs.mkdirSync(PROJ, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'paper.tex'), 'Hello\n');
  fs.writeFileSync(path.join(OUT, 'secret.txt'), 'outside');
  fs.writeFileSync(path.join(OUT, 'shared.tex'), 'shared\n');
  fs.symlinkSync(path.join(OUT, 'secret.txt'), path.join(PROJ, 'leak.txt'));
  srv = await createServer();
  await api('openProject', { root: PROJ });
});
after(() => srv.close());

test('no token or a wrong token: 401, on the API and on /file', async () => {
  assert.equal((await post('hello', {}, { 'x-texugo-token': '' })).status, 401);
  assert.equal((await post('hello', {}, { 'x-texugo-token': 'nope' })).status, 401);
  const f = await fetch(`http://127.0.0.1:${srv.port}/file?t=nope&p=${encodeURIComponent(path.join(PROJ, 'paper.tex'))}`);
  assert.equal(f.status, 401);
  assert.equal((await post('hello', {})).status, 200);
});

test('another Host header (DNS rebinding) is refused', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/hello', method: 'POST', headers: { host: 'evil.example:' + srv.port, 'x-texugo-token': srv.token } }, (res) => resolve(res.statusCode));
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(status, 403);
});

test('reading or writing outside the open project is refused', async () => {
  assert.equal((await api('read', { path: path.join(OUT, 'secret.txt') })).status, 403);
  assert.equal((await api('read', { path: path.join(PROJ, '..', 'outside', 'secret.txt') })).status, 403);
  assert.equal((await api('write', { path: path.join(OUT, 'new.txt'), text: 'x' })).status, 403);
  assert.ok(!fs.existsSync(path.join(OUT, 'new.txt')));
});

test('a link inside the project that points outside it cannot be read', async () => {
  // OUT is a temporary folder outside the home: the link guard refuses it.
  const r = await api('read', { path: path.join(PROJ, 'leak.txt') });
  assert.equal(r.status, 403);
});

test('a write against a file changed on disk returns a conflict and keeps the disk', async () => {
  const p = path.join(PROJ, 'paper.tex');
  const first = await api('read', { path: p });
  assert.equal(first.status, 200);
  const mtime = first.body.data.mtime;
  fs.writeFileSync(p, 'Coauthor edit\n');
  fs.utimesSync(p, new Date(), new Date(Date.now() + 5000));
  const r = await api('write', { path: p, text: 'Mine\n', expectMtime: mtime });
  assert.equal(r.body.data.conflict, true);
  assert.equal(fs.readFileSync(p, 'utf8'), 'Coauthor edit\n');
  const fresh = (await api('read', { path: p })).body.data.mtime;
  const ok = await api('write', { path: p, text: 'Mine\n', expectMtime: fresh });
  assert.ok(!ok.body.data.conflict);
  assert.equal(fs.readFileSync(p, 'utf8'), 'Mine\n');
});

test('saving a linked file inside the home keeps the link', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.homedir(), 'texugo-api-link-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const target = path.join(homeDir, 'shared.tex');
  fs.writeFileSync(target, 'shared\n');
  const link = path.join(PROJ, 'shared.tex');
  fs.symlinkSync(target, link);
  const r = await api('write', { path: link, text: 'edited\n' });
  assert.equal(r.status, 200);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(target, 'utf8'), 'edited\n');
});
