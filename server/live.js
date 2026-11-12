// Live preview: the PDF follows the text on screen while the user types,
// without saving anything.
//
// A live run compiles the editor buffers, not the files on disk. Unsaved
// buffers are written to an overlay folder (.texugo/live/<id>/src) that
// mirrors their paths relative to the document's folder, and TEXINPUTS puts
// that folder before the default path, so \input{sections/body} reads the
// overlay copy when there is one and the file on disk otherwise. The engine
// runs once, in the document's folder, with -output-directory pointing to
// .texugo/live/<id>/out, so the real .aux/.pdf/.synctex.gz are never touched.
//
// One pass is enough for a preview: TeX Live looks in the output directory
// before the search path, so the run reads its own .aux from the previous
// live pass, or the real .aux of the last full build when that one is newer
// (we delete stale copies first). The .bbl comes from the last full build:
// BibTeX/Biber do not run live, so a new \cite shows [?] until the next
// compile. Same for labels added in this pass (they appear one pass later).
//
// A finished run is copied to .texugo/live/<id>/show/<stem>.pdf (and its
// .synctex.gz) only when it is good enough to show, so a half-typed command
// never replaces a good preview with a broken page.
import { outputs } from './outdirs.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { docInfo } from './project.js';
import { parseLog } from './logparse.js';
import { toolEnv, sha1, isInside } from './util.js';
import { killTree } from './platform.js';

// Files a full build leaves next to the document that a live pass reads back.
const AUX_EXT = ['.aux', '.toc', '.lof', '.lot', '.loa', '.out', '.nav', '.snm', '.vrb', '.thm', '.bcf'];
const STALL_MS = 60000;

export function liveDirs(projectRoot, doc) {
  const base = path.join(projectRoot, '.texugo', 'live', sha1(doc).slice(0, 10));
  return { base, src: path.join(base, 'src'), out: path.join(base, 'out'), show: path.join(base, 'show'), good: path.join(base, 'good') };
}

// Overlay path of `file` for a document, or null when the file does not sit
// under the document's folder (TeX could not find it through TEXINPUTS).
export function overlayPath(dirs, doc, file) {
  const docDir = path.dirname(doc);
  if (!isInside(docDir, file)) return null;
  return path.join(dirs.src, path.relative(docDir, file));
}

// Inverse of overlayPath: a path inside src back to the real file.
export function realPath(dirs, doc, file) {
  if (!file || !isInside(dirs.src, file)) return file;
  return path.join(path.dirname(doc), path.relative(dirs.src, file));
}

// Does a live run's log allow showing its PDF? Errors are acceptable only
// when the last full build already had errors (the document "compiles with
// errors" and the user lives with that); otherwise any error means the text
// is mid-edit and the previous preview stays.
export function showable({ pdfExists, errors, tolerate }) {
  if (!pdfExists) return false;
  return errors.length === 0 || !!tolerate;
}

export class LiveManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map(); // doc -> { running, pending, child }
    this.overlays = new Map(); // shown pdf -> { doc, dirs }
  }

  // Requests a live run of `doc` with the given unsaved buffers. A request
  // that arrives while a run is going waits and replaces any older waiting
  // one: only the latest text matters.
  request(projectRoot, doc, buffers, opts = {}) {
    let job = this.jobs.get(doc);
    if (!job) this.jobs.set(doc, (job = { running: false, pending: null, child: null }));
    const req = { projectRoot, doc, buffers: buffers || [], opts };
    if (job.running) {
      job.pending = req;
      return { queued: true };
    }
    this._run(job, req);
    return { started: true };
  }

  stop(doc) {
    const job = this.jobs.get(doc);
    if (!job) return;
    job.pending = null;
    if (job.child) {
      killTree(job.child, 'SIGKILL');
    }
  }

  stopAll() {
    for (const doc of this.jobs.keys()) this.stop(doc);
  }

  // For SyncTeX against a live PDF: which overlay does it use?
  overlayFor(pdf) {
    return this.overlays.get(path.resolve(pdf)) || null;
  }

  async _run(job, req) {
    job.running = true;
    const t0 = Date.now();
    const { projectRoot, doc } = req;
    let result;
    try {
      result = await this._compile(job, req);
    } catch (err) {
      result = { ok: false, shown: false, errors: [{ file: doc, line: null, message: String(err && err.message ? err.message : err) }] };
    }
    job.running = false;
    job.child = null;
    this.emit('event', { type: 'live:done', root: projectRoot, doc, ms: Date.now() - t0, ...result });
    const next = job.pending;
    job.pending = null;
    if (next) this._run(job, next);
  }

  async _compile(job, { projectRoot, doc, buffers, opts }) {
    const dirs = liveDirs(projectRoot, doc);
    const docDir = path.dirname(doc);
    const stem = path.basename(doc, '.tex');
    const info = docInfo(doc);
    // Fresh overlay with exactly the buffers that differ from disk now.
    fs.rmSync(dirs.src, { recursive: true, force: true });
    for (const d of [dirs.src, dirs.out, dirs.show, dirs.good]) fs.mkdirSync(d, { recursive: true });
    let main = path.basename(doc);
    for (const b of buffers) {
      const o = overlayPath(dirs, doc, path.resolve(b.path));
      if (!o) continue;
      fs.mkdirSync(path.dirname(o), { recursive: true });
      fs.writeFileSync(o, b.text);
      if (path.resolve(b.path) === doc) main = o;
    }
    // A full build newer than the live copies wins: drop the stale ones so
    // TeX falls back to the real files next to the document.
    for (const ext of AUX_EXT) {
      const real = path.join(outputs(doc).auxDir, stem + ext);
      const mine = path.join(dirs.out, stem + ext);
      try {
        if (fs.existsSync(mine) && fs.existsSync(real) && fs.statSync(real).mtimeMs > fs.statSync(mine).mtimeMs) fs.rmSync(mine);
      } catch {}
    }
    // After every pass, out/ holds the bookkeeping of a good pass (a bad
    // pass is rolled back below), so snapshot it before running.
    keepAux(dirs.out, dirs.good, stem);
    const outPdf = path.join(dirs.out, stem + '.pdf');
    fs.rmSync(outPdf, { force: true });
    const engine = ['pdflatex', 'xelatex', 'lualatex'].includes(info.engine) ? info.engine : 'pdflatex';
    const args = ['-interaction=nonstopmode', '-file-line-error', '-synctex=1', `-output-directory=${dirs.out}`, `-jobname=${stem}`, main];
    // With a latexmkrc $aux_dir, the full build's .aux files (this
    // document's and its external documents') sit there, not beside the .tex.
    const auxDirs = [...new Set([doc, ...(info.externals || [])].map((d) => outputs(d)).filter((x) => x.moved).map((x) => x.auxDir))];
    const sep = path.delimiter + auxDirs.map((d) => d + path.delimiter).join('') + (process.env.TEXINPUTS || '');
    const code = await this._spawn(job, engine, args, docDir, { TEXINPUTS: dirs.src + sep });
    const logText = readMaybe(path.join(dirs.out, stem + '.log'));
    const parsed = logText ? parseLog(logText, docDir) : { errors: [] };
    const errors = parsed.errors.map((e) => ({ ...e, file: realPath(dirs, doc, e.file) }));
    if (code === -2) errors.unshift({ file: doc, line: null, message: 'prévia parada: a passada demorou demais' });
    const pdfExists = code !== -2 && fs.existsSync(outPdf);
    const shown = showable({ pdfExists, errors, tolerate: opts.tolerate });
    // A pass that stopped halfway leaves a truncated .aux, and the next pass
    // would print ?? everywhere: put back the snapshot (timestamps kept, so
    // a newer full build still wins on the next pass).
    if (!shown) keepAux(dirs.good, dirs.out, stem);
    let pdf = null;
    if (shown) {
      pdf = path.join(dirs.show, stem + '.pdf');
      fs.copyFileSync(outPdf, pdf);
      const sz = path.join(dirs.out, stem + '.synctex.gz');
      if (fs.existsSync(sz)) fs.copyFileSync(sz, path.join(dirs.show, stem + '.synctex.gz'));
      this.overlays.set(pdf, { doc, dirs });
    }
    return { ok: errors.length === 0 && pdfExists, shown, pdf, engine, errors: errors.slice(0, 5), cancelled: code === -1 && !pdfExists };
  }

  _spawn(job, cmd, args, cwd, env) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, env: toolEnv(env), detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
      job.child = child;
      let stalled = false;
      const timer = setTimeout(() => {
        stalled = true;
        killTree(child, 'SIGKILL');
      }, STALL_MS);
      child.on('error', () => (clearTimeout(timer), resolve(-1)));
      child.on('close', (c) => {
        clearTimeout(timer);
        resolve(stalled ? -2 : c == null ? -1 : c);
      });
    });
  }
}

// Makes `to` hold exactly the aux-family files of `from`. A file missing in
// `from` is removed from `to`, so TeX falls back to the full build's copy.
function keepAux(from, to, stem) {
  for (const ext of AUX_EXT) {
    const a = path.join(from, stem + ext);
    const b = path.join(to, stem + ext);
    try {
      if (!fs.existsSync(a)) {
        fs.rmSync(b, { force: true });
        continue;
      }
      fs.copyFileSync(a, b);
      const st = fs.statSync(a);
      fs.utimesSync(b, st.atime, st.mtime);
    } catch {}
  }
}

function readMaybe(f) {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
}
