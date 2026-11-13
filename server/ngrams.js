// Advanced English checking: LanguageTool's n-gram data, an optional
// download (PRE-LAUNCH-AUDIT.md item 1). With it, LanguageTool catches
// confusions a rule cannot see, such as "their" for "there" or "affect"
// for "effect". The data exists for English, German, French, Spanish and
// Dutch, not for Portuguese, so TeXugo offers the English set only.
//
// Facts checked on 12/11/2026 at languagetool.org/download/ngram-data/:
// ngrams-en-20150817.zip is 8,961,853,713 bytes; unpacked it is
// 15,401,820,145 bytes in en/1grams, en/2grams and en/3grams (Lucene
// indexes); the server answers Range requests and gives an ETag.
//
// States: absent -> downloading -> unpacking -> ready, plus paused (a
// partial download on disk, resumed with Range) and an error message. The
// download goes to <data>/languagetool/ngrams/download.zip.partial so a
// dropped connection or a quit resumes where it stopped instead of starting
// 9 GB over; the unpacked folder only replaces the old one when complete.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dataDir, toolEnv } from './util.js';
import { unzipCommand } from './platform.js';

export const OFFICIAL_URL = 'https://languagetool.org/download/ngram-data/ngrams-en-20150817.zip';
export const OFFICIAL_ZIP = 8961853713;
export const OFFICIAL_UNZIPPED = 15401820145;
const MARGIN = 1e9; // free space kept on top of what the files need

function readJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export class Ngrams {
  constructor({ url = process.env.TEXUGO_NGRAMS_URL || OFFICIAL_URL, root = null, broadcast = () => {}, retries = 3, retryMs = 3000 } = {}) {
    this.url = url;
    this.rootDir = root;
    this.broadcast = broadcast;
    this.retries = retries;
    this.retryMs = retryMs;
    this.job = null; // { state, done, total, ctrl }
    this.error = null;
  }

  get root() {
    return this.rootDir || path.join(dataDir(), 'languagetool', 'ngrams');
  }
  get partial() {
    return path.join(this.root, 'download.zip.partial');
  }
  get meta() {
    return path.join(this.root, 'download.json');
  }

  // The folder to pass to LanguageTool's --languageModel, or null.
  languageModelDir() {
    const r = this.root;
    return fs.existsSync(path.join(r, 'ready.json')) && fs.existsSync(path.join(r, 'en', '3grams')) ? r : null;
  }

  status() {
    const official = this.url === OFFICIAL_URL;
    const base = { url: this.url, zipBytes: official ? OFFICIAL_ZIP : null, unzippedBytes: official ? OFFICIAL_UNZIPPED : null, free: freeBytes(fs.existsSync(this.root) ? this.root : dataDir()), error: this.error };
    if (this.job) return { ...base, state: this.job.state, done: this.job.done, total: this.job.total };
    if (this.languageModelDir()) return { ...base, state: 'ready', bytes: readJson(path.join(this.root, 'ready.json'))?.bytes || null };
    if (fs.existsSync(this.partial)) {
      const m = readJson(this.meta) || {};
      return { ...base, state: 'paused', done: fs.statSync(this.partial).size, total: m.total || null };
    }
    return { ...base, state: 'absent' };
  }

  emit() {
    this.broadcast({ type: 'ngrams', ...this.status() });
  }

  // Starts or resumes. Resolves when the data is ready, paused or failed;
  // progress goes out through broadcast.
  start() {
    if (this.job) return this.job.promise;
    this.error = null;
    const job = { state: 'downloading', done: 0, total: null, ctrl: null, paused: false };
    this.job = job;
    job.promise = this._run(job)
      .finally(() => {
        if (this.job === job) this.job = null;
        this.emit();
      })
      .then(() => this.status());
    return job.promise;
  }

  pause() {
    if (!this.job) return false;
    this.job.paused = true;
    this.job.ctrl?.abort();
    return true;
  }

  async remove() {
    if (this.job) {
      this.pause();
      await this.job?.promise.catch(() => {});
    }
    fs.rmSync(this.root, { recursive: true, force: true });
    this.error = null;
    this.emit();
    return true;
  }

  async _run(job) {
    fs.mkdirSync(this.root, { recursive: true });
    try {
      // What the server has now; a different ETag means a different file,
      // and the partial download must start over.
      const head = await fetch(this.url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
      if (!head.ok) throw new Error(`O servidor dos n-gramas respondeu ${head.status}.`);
      const total = Number(head.headers.get('content-length')) || null;
      const etag = head.headers.get('etag') || '';
      const m = readJson(this.meta);
      if (!m || m.etag !== etag || m.total !== total) fs.rmSync(this.partial, { force: true });
      fs.writeFileSync(this.meta, JSON.stringify({ url: this.url, etag, total }));
      job.total = total;
      job.done = fs.existsSync(this.partial) ? fs.statSync(this.partial).size : 0;
      // Room for the rest of the zip, the unpacked folder and a margin.
      const unzipped = this.url === OFFICIAL_URL ? OFFICIAL_UNZIPPED : (total || 0) * 2;
      const need = (total ? total - job.done : 0) + unzipped + Math.min(MARGIN, total || MARGIN);
      const free = freeBytes(this.root);
      if (free != null && free < need) throw new Error(`Falta espaço em disco: são precisos ${gb(need)} livres e há ${gb(free)}.`);
      this.emit();

      for (let attempt = 0; ; attempt++) {
        try {
          await this._download(job, etag);
          break;
        } catch (err) {
          if (job.paused) return this.status();
          if (attempt >= this.retries) throw new Error('A conexão caiu durante o download. Clique em Continuar para seguir de onde parou.');
          await new Promise((r) => setTimeout(r, this.retryMs));
        }
      }
      if (job.total && fs.statSync(this.partial).size !== job.total) throw new Error('O download terminou com um tamanho diferente do esperado. Remova e baixe de novo.');

      job.state = 'unpacking';
      this.emit();
      await this._unpack();
      return this.status();
    } catch (err) {
      if (job.paused) return this.status();
      this.error = err.message;
      return this.status();
    }
  }

  async _download(job, etag) {
    // A pause that came during the HEAD had nothing to abort yet.
    if (job.paused) throw new Error('paused');
    job.ctrl = new AbortController();
    const done = fs.existsSync(this.partial) ? fs.statSync(this.partial).size : 0;
    if (job.total && done >= job.total) return;
    const headers = done ? { range: `bytes=${done}-`, ...(etag ? { 'if-range': etag } : {}) } : {};
    const r = await fetch(this.url, { headers, signal: job.ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // 200 to a Range request: the server sent the whole file again.
    const append = r.status === 206;
    job.done = append ? done : 0;
    const out = fs.createWriteStream(this.partial, { flags: append ? 'a' : 'w' });
    let last = 0;
    try {
      for await (const chunk of r.body) {
        if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
        job.done += chunk.length;
        const now = Date.now();
        if (now - last > 500) {
          last = now;
          this.emit();
        }
      }
    } finally {
      await new Promise((res) => out.end(res));
    }
  }

  async _unpack() {
    const tmp = path.join(this.root, 'unpack.tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const [cmd, args] = unzipCommand(this.partial, tmp);
    const code = await new Promise((resolve) => {
      const child = spawn(cmd, args, { env: toolEnv(), stdio: 'ignore' });
      child.on('error', () => resolve(-1));
      child.on('close', (c) => resolve(c));
    });
    if (code !== 0 || !fs.existsSync(path.join(tmp, 'en'))) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new Error('Não consegui descompactar os n-gramas. Remova e baixe de novo.');
    }
    const dest = path.join(this.root, 'en');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(path.join(tmp, 'en'), dest);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(this.partial, { force: true });
    fs.rmSync(this.meta, { force: true });
    fs.writeFileSync(path.join(this.root, 'ready.json'), JSON.stringify({ at: Date.now(), bytes: duBytes(dest) }));
  }
}

function duBytes(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? duBytes(p) : fs.statSync(p).size;
  }
  return n;
}

const gb = (b) => `${(b / 1e9).toFixed(1).replace('.', ',')} GB`;
