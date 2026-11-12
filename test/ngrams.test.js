// Item 1: the n-gram download, with a tiny zip served on localhost. The
// first request drops the connection halfway; the next run resumes with
// Range; the unpacked folder becomes the language model; Remove clears it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-ng-'));
process.env.TEXUGO_DATA_DIR = path.join(TMP, 'data');
const { Ngrams } = await import('../server/ngrams.js');
const { serverArgs } = await import('../server/grammar.js');

let hasZip = true;
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' });
} catch {
  hasZip = false;
}

test('n-grams: drop, resume with Range, unpack, model folder, remove', { skip: !hasZip && 'zip not installed' }, async () => {
  const src = path.join(TMP, 'src');
  fs.mkdirSync(path.join(src, 'en', '3grams'), { recursive: true });
  fs.mkdirSync(path.join(src, 'en', '2grams'), { recursive: true });
  // Random bytes so the zip does not shrink to nothing.
  fs.writeFileSync(path.join(src, 'en', '3grams', 'index.tim'), Buffer.from(Array.from({ length: 400000 }, () => Math.floor(Math.random() * 256))));
  fs.writeFileSync(path.join(src, 'en', '2grams', 'index.tim'), 'two');
  const zipFile = path.join(TMP, 'ngrams.zip');
  execFileSync('zip', ['-q', '-r', '-0', zipFile, 'en'], { cwd: src });
  const data = fs.readFileSync(zipFile);
  const ranges = [];
  let dropNext = true;
  const srv = http.createServer((req, res) => {
    const etag = '"v1"';
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-length': data.length, etag, 'accept-ranges': 'bytes' });
      return res.end();
    }
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    const from = m ? Number(m[1]) : 0;
    ranges.push(from);
    res.writeHead(m ? 206 : 200, { 'content-length': data.length - from, etag, ...(m ? { 'content-range': `bytes ${from}-${data.length - 1}/${data.length}` } : {}) });
    if (dropNext) {
      dropNext = false;
      // Half the file, then the connection dies.
      res.write(data.subarray(from, from + Math.floor(data.length / 2)), () => res.destroy());
      return;
    }
    res.end(data.subarray(from));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/ngrams.zip`;
  try {
    const events = [];
    const ng = new Ngrams({ url, broadcast: (e) => events.push(e.state), retries: 0, retryMs: 10 });
    assert.equal(ng.status().state, 'absent');
    // First run: the drop, no retries left -> an error, a partial on disk.
    let st = await ng.start();
    assert.equal(st.state, 'paused', JSON.stringify(st));
    assert.match(st.error || '', /Continuar/);
    assert.ok(st.done > 0 && st.done < data.length);
    const got = st.done;
    // Second run resumes from where it stopped.
    st = await ng.start();
    assert.equal(st.state, 'ready', JSON.stringify(st));
    assert.deepEqual(ranges, [0, got]);
    const lm = ng.languageModelDir();
    assert.equal(lm, ng.root);
    assert.ok(fs.existsSync(path.join(lm, 'en', '3grams', 'index.tim')));
    assert.ok(!fs.existsSync(ng.partial), 'the zip goes once unpacked');
    assert.ok(events.includes('downloading') && events.includes('unpacking'));
    // LanguageTool gets the folder that holds en/.
    assert.deepEqual(serverArgs({ port: 9, lm }).slice(-2), ['--languageModel', lm]);
    assert.ok(!serverArgs({ port: 9 }).includes('--languageModel'));
    await ng.remove();
    assert.equal(ng.status().state, 'absent');
    assert.equal(ng.languageModelDir(), null);
  } finally {
    srv.close();
  }
});

test('n-grams: pause keeps the partial; a new ETag starts over', { skip: !hasZip && 'zip not installed' }, async () => {
  const big = Buffer.alloc(3_000_000, 7);
  let etag = '"a"';
  const srv = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-length': big.length, etag });
      return res.end();
    }
    res.writeHead(200, { 'content-length': big.length, etag });
    // Slow: 100 KB every 20 ms, so pause lands mid-way.
    let at = 0;
    const tick = setInterval(() => {
      if (res.destroyed) return clearInterval(tick);
      res.write(big.subarray(at, at + 100000));
      at += 100000;
      if (at >= big.length) clearInterval(tick), res.end();
    }, 20);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/x.zip`;
  const ng = new Ngrams({ url, root: path.join(TMP, 'pause'), retries: 0 });
  try {
    const run = ng.start();
    await new Promise((r) => setTimeout(r, 150));
    ng.pause();
    let st = await run;
    assert.equal(st.state, 'paused');
    assert.ok(!st.error);
    const kept = fs.statSync(ng.partial).size;
    assert.ok(kept > 0 && kept < big.length);
    // The file changed on the server: the partial is thrown away.
    etag = '"b"';
    const run2 = ng.start();
    await new Promise((r) => setTimeout(r, 30));
    ng.pause();
    await run2;
    assert.ok(fs.statSync(ng.partial).size < kept, 'restarted from zero');
  } finally {
    srv.close();
    await ng.remove();
  }
});
