// I9: what each feature that uses the network says when there is none.
// Every request goes to a local port that was just closed (connection
// refused, as with no route), so the test itself needs no network; the Git
// remote points there too. Each message must be the plain sentence, never "fetch failed"
// or git's own text, and must have its English version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-offline-'));
process.env.TEXUGO_DATA_DIR = path.join(TMP, 'data');
const CLOSED = await new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => {
  const url = new URL(String(u));
  url.protocol = 'http:';
  url.host = `127.0.0.1:${CLOSED}`;
  return realFetch(url, o);
};
test.after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
});

const { isOffline } = await import('../server/util.js');
const { setServerLang } = await import('../server/lang.js');
const git = await import('../server/git.js');
globalThis.document = { documentElement: {}, querySelectorAll: () => [] };
const { tr, setLang } = await import('../web/src/i18n.js');
const english = (pt) => {
  setLang('en');
  const en = tr(pt);
  setLang('pt');
  return en;
};

test('isOffline: the system codes Node puts on a failed fetch', () => {
  const failed = (code) => new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']) assert.ok(isOffline(failed(code)), code);
  assert.ok(isOffline(new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('x'), { code: 'ENETUNREACH' })]) })), 'several addresses tried');
  assert.ok(!isOffline(new Error('HTTP 500')));
  assert.ok(!isOffline(Object.assign(new Error('x'), { name: 'AbortError' })));
});

test('references: lookup and check say there is no connection', async () => {
  const refs = await import('../server/refs.js');
  await assert.rejects(refs.lookup('10.1000/xyz123'), /^Error: Sem conexão com a internet$/);
  const { checkBib } = await import('../server/refcheck.js');
  const bib = path.join(TMP, 'r.bib');
  fs.writeFileSync(bib, '@article{a, title={Bus lanes}, author={Author, A.}, journal={J}, year={2020}, doi={10.1000/xyz123}}\n');
  await assert.rejects(checkBib(bib), /^Error: Sem conexão com a internet$/);
  assert.equal(english('Sem conexão com a internet'), 'No internet connection');
});

test('n-grams download: no connection, not "fetch failed"', async () => {
  const { Ngrams } = await import('../server/ngrams.js');
  const ng = new Ngrams({ root: path.join(TMP, 'ng'), retries: 0, retryMs: 10 });
  await ng.start();
  for (let i = 0; i < 100 && !ng.error; i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(ng.error || '', /^Sem conexão com a internet\./);
  assert.notEqual(english(ng.error), ng.error);
});

test('online grammar server: no connection, and the local one is named', async () => {
  const { Grammar } = await import('../server/grammar.js');
  await assert.rejects(new Grammar().check([{ text: 'This are a test.', lang: 'en-US' }], { server: 'online', level: 'default' }), (err) => {
    assert.match(err.message, /^Sem conexão com a internet: o servidor online do LanguageTool/);
    assert.notEqual(english(err.message), err.message);
    return true;
  });
});

test('update check: an error, never a throw', async () => {
  const { UpdateChecker } = await import('../server/update.js');
  const info = await new UpdateChecker({ current: '0.1.0', fetchImpl: globalThis.fetch }).check({ force: true });
  assert.ok(info.error && !info.newer);
});

test('Git: sync, pull, push and fetch say it plainly, in both languages', async () => {
  const P = path.join(TMP, 'p');
  fs.mkdirSync(P);
  const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.org', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.org' };
  const g = (...a) => execFileSync('git', ['-C', P, ...a], { stdio: 'pipe', env });
  g('init', '-b', 'main');
  fs.writeFileSync(path.join(P, 'a.tex'), 'x\n');
  g('add', '-A');
  g('commit', '-m', 'one');
  g('remote', 'add', 'origin', `http://127.0.0.1:${CLOSED}/paper.git`);
  g('config', 'branch.main.remote', 'origin');
  g('config', 'branch.main.merge', 'refs/heads/main');
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.org', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.org' });
  fs.writeFileSync(path.join(P, 'a.tex'), 'y\n');
  const s = await git.sync(P, 'two');
  assert.equal(s.stderr, 'Sem conexão com 127.0.0.1. O commit está feito aqui e sobe no próximo Sincronizar.');
  assert.ok(s.offline && s.steps.length === 1, 'the commit was made before the pull failed');
  assert.equal((await git.pull(P)).stderr, 'Sem conexão com 127.0.0.1. Nada mudou aqui; tente de novo quando a internet voltar.');
  assert.equal((await git.push(P)).stderr, 'Sem conexão com 127.0.0.1. Os seus commits ficam aqui e sobem no próximo Push ou Sincronizar.');
  setServerLang('en');
  try {
    assert.equal((await git.fetch(P)).stderr, 'No connection to 127.0.0.1. Nothing changed here; try again when the internet is back.');
  } finally {
    setServerLang('pt');
  }
});

test('Git: the host is read from what git says over HTTPS and SSH', () => {
  const what = () => 'X.';
  assert.equal(git.offlineText("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com", what), 'Sem conexão com github.com. X.');
  assert.equal(git.offlineText('ssh: Could not resolve hostname github.com: nodename nor servname provided, or not known\nfatal: Could not read from remote repository.', what), 'Sem conexão com github.com. X.');
  assert.equal(git.offlineText("fatal: unable to access 'https://gitlab.com/a.git/': Failed to connect to gitlab.com port 443 after 3 ms: Couldn't connect to server", what), 'Sem conexão com gitlab.com. X.');
  assert.equal(git.offlineText('remote: Permission to a/b.git denied to someone.\nfatal: unable to access: The requested URL returned error: 403', what), null, 'no access is not no network');
});
