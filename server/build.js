// Build engine.
//
// A document is compiled with latexmk, which already handles BibTeX/Biber,
// makeindex and the reruns a single document needs. What latexmk does not do
// is compile *other* documents: with xr's \externaldocument{appendix}, the
// paper reads appendix.aux, and appendix.tex usually reads paper.aux back.
// Compiling one file alone then leaves ?? wherever the other file's labels
// are missing or stale.
//
// So a build request is expanded to the whole group of documents linked by
// \externaldocument. They are compiled dependencies first, and then the group
// is iterated: a document is compiled again whenever the labels exported by
// one of its dependencies (fingerprint of their .aux) differ from what it saw
// on its last run. The loop stops when every document has seen the final
// labels of its dependencies, which is the fixed point a human reaches by
// "compiling both files twice".
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { docInfo, projectSymbols, includeClosure } from './project.js';
import { parseLog, auxFingerprint, auxLabels } from './logparse.js';
import { toolEnv, which } from './util.js';
import { rcInfo, outputs } from './outdirs.js';
import { killTree, texInstallHint } from './platform.js';

const MAX_PASSES = 6;
const ENGINE_FLAG = { pdflatex: '-pdf', xelatex: '-pdfxe', lualatex: '-pdflua' };

const stem = (doc) => doc.replace(/\.tex$/, '');

export { rcInfo, outputs };

export class BuildManager extends EventEmitter {
  constructor() {
    super();
    this.running = null; // { id, docs, child, cancelled }
    this.queue = []; // pending requests, coalesced
    this.seq = 0;
    this.lastResults = new Map(); // doc -> result
    this.seenAcross = new Map(); // doc -> dependency labels its last run read
  }

  // Requests a build of `docs` (absolute .tex paths). Returns the build id.
  // Requests that arrive while a build runs are merged into one follow-up.
  request(projectRoot, docs, opts = {}) {
    const id = ++this.seq;
    const req = { id, projectRoot, docs: [...new Set(docs)], opts };
    if (this.running) {
      const pending = this.queue.find((q) => q.projectRoot === projectRoot);
      if (pending) {
        pending.docs = [...new Set([...pending.docs, ...req.docs])];
        pending.opts = { ...pending.opts, ...opts };
        this.emit('event', { type: 'build:queued', id: pending.id, docs: pending.docs });
        return pending.id;
      }
      this.queue.push(req);
      this.emit('event', { type: 'build:queued', id, docs: req.docs });
      return id;
    }
    this._start(req);
    return id;
  }

  cancel() {
    this.queue = [];
    if (this.running) {
      this.running.cancelled = true;
      if (this.running.child) {
        killTree(this.running.child);
      }
    }
  }

  async _start(req) {
    this.running = { ...req, child: null, cancelled: false };
    const t0 = Date.now();
    let summary;
    try {
      summary = await this._build(req);
    } catch (err) {
      summary = { id: req.id, root: req.projectRoot, ok: false, fatal: String(err && err.stack ? err.stack : err), docs: [] };
    }
    summary.duration = Date.now() - t0;
    summary.cancelled = this.running.cancelled;
    this.running = null;
    this.emit('event', { type: 'build:done', ...summary });
    const next = this.queue.shift();
    if (next) this._start(next);
  }

  // Expands requested documents to their \externaldocument group.
  plan(docs) {
    const infos = new Map();
    const visit = (doc) => {
      if (infos.has(doc) || !fs.existsSync(doc)) return;
      const info = docInfo(doc);
      infos.set(doc, info);
      for (const ext of info.externals) visit(ext);
    };
    docs.forEach(visit);
    // Documents that import a requested document also belong to the group
    // when the requested one imports them back (a cycle such as
    // paper <-> appendix). One-way importers are left alone.
    // Order: dependencies before dependants (DFS post-order).
    const order = [];
    const state = new Map();
    const dfs = (doc) => {
      if (state.get(doc)) return;
      state.set(doc, 1);
      for (const ext of infos.get(doc)?.externals || []) if (infos.has(ext)) dfs(ext);
      order.push(doc);
    };
    [...infos.keys()].forEach(dfs);
    return { order, infos };
  }

  async _build(req) {
    const latexmk = await which('latexmk');
    if (!latexmk) {
      throw new Error('latexmk não encontrado. ' + texInstallHint());
    }
    const { order, infos } = this.plan(req.docs);
    const missingExternal = [];
    for (const info of infos.values()) {
      for (const ext of info.externals) if (!fs.existsSync(ext)) missingExternal.push({ doc: info.path, external: ext });
    }
    this.emit('event', {
      type: 'build:start',
      root: req.projectRoot,
      id: req.id,
      requested: req.docs,
      order,
      expanded: order.filter((d) => !req.docs.includes(d)),
    });

    const seen = new Map(); // doc -> fingerprint of each dependency aux it last read
    const runs = new Map(order.map((d) => [d, 0]));
    const exitCodes = new Map();
    let passes = 0;
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      let ranAny = false;
      for (const doc of order) {
        if (this.running.cancelled) break;
        const info = infos.get(doc);
        const deps = info.externals.filter((e) => infos.has(e));
        const fp = deps.map((e) => auxFingerprint(outputs(e).aux)).join('\u0000');
        let reason = null;
        if (pass === 1) reason = req.docs.includes(doc) ? 'pedido' : 'dependência';
        else if (seen.get(doc) !== fp) {
          const changed = deps.find((e, k) => (seen.get(doc) || '').split('\u0000')[k] !== auxFingerprint(outputs(e).aux));
          reason = `rótulos de ${path.basename(changed || deps[0] || doc)} mudaram`;
        }
        if (!reason) continue;
        ranAny = true;
        // Later passes must force a run: latexmk may consider the PDF up to
        // date because none of this document's own sources changed. On the
        // first pass a document with external documents is also forced
        // unless the last build here saw these exact labels and ended clean:
        // when the other .aux was missing on a previous run, latexmk never
        // learned the dependency and would wrongly report "up to date",
        // leaving the old ?? in the PDF.
        const last = this.lastResults.get(doc);
        const trusted = this.seenAcross.get(doc) === fp && last && last.status === 'ok';
        const force = pass > 1 || !!req.opts.force || (deps.length > 0 && !trusted);
        this.emit('event', { type: 'build:doc', id: req.id, doc, pass, reason, engine: info.engine });
        const code = await this._latexmk(req.id, doc, info, { force, clean: req.opts.clean && pass === 1 });
        exitCodes.set(doc, code);
        runs.set(doc, runs.get(doc) + 1);
        // Record what this run read. Taken after the run, the dependency aux
        // files are unchanged by it, so this is exactly its input.
        seen.set(doc, deps.map((e) => auxFingerprint(outputs(e).aux)).join('\u0000'));
        this.seenAcross.set(doc, seen.get(doc));
      }
      if (!ranAny || this.running.cancelled) break;
      passes = pass;
    }

    // Results per document, plus an explanation for every undefined reference
    // whose label exists elsewhere in the project.
    let symbols = null;
    const docsOut = [];
    for (const doc of order) {
      const info = infos.get(doc);
      const where = outputs(doc);
      const log = readMaybe(where.log);
      const parsed = log ? parseLog(log, path.dirname(doc)) : null;
      const pdf = where.pdf;
      const pdfExists = fs.existsSync(pdf);
      if (parsed && parsed.undefinedRefs.length) {
        symbols = symbols || projectSymbols(req.projectRoot);
        for (const r of parsed.undefinedRefs) r.explain = explainRef(r.key, doc, info, infos, symbols, req.projectRoot);
      }
      if (parsed && parsed.undefinedCites.length) {
        symbols = symbols || projectSymbols(req.projectRoot);
        const keys = new Set(symbols.bibKeys.map((b) => b.key));
        for (const c of parsed.undefinedCites) {
          c.explain = keys.has(c.key)
            ? `A chave existe num .bib do projeto, mas não no .bib que ${path.basename(doc)} usa, ou o BibTeX/Biber falhou (veja o .blg).`
            : `Nenhum .bib do projeto tem a chave "${c.key}". Erro de digitação?`;
        }
      }
      const code = exitCodes.get(doc);
      const errors = parsed ? parsed.errors : [];
      // Never report success without having read the log.
      if (code === 0 && !parsed) errors.push({ file: doc, line: null, message: `A compilação terminou, mas não achei o log em ${where.log}; não dá para dizer se há ?? no PDF.` });
      const status = code == null ? 'skipped' : errors.length || code !== 0 ? 'error' : parsed && (parsed.undefinedRefs.length || parsed.undefinedCites.length) ? 'undefined' : 'ok';
      const out = {
        doc,
        name: path.basename(doc),
        requested: req.docs.includes(doc),
        pdf: pdfExists ? pdf : null,
        pdfMtime: pdfExists ? fs.statSync(pdf).mtimeMs : null,
        engine: info.engine,
        engineSource: info.engineSource,
        kind: info.kind,
        externals: info.externals,
        runs: runs.get(doc),
        exitCode: code,
        status,
        pages: parsed ? parsed.pages : null,
        errors,
        warnings: parsed ? parsed.warnings : [],
        badboxes: parsed ? parsed.badboxes : [],
        undefinedRefs: parsed ? parsed.undefinedRefs : [],
        undefinedCites: parsed ? parsed.undefinedCites : [],
        multiplyDefined: parsed ? parsed.multiplyDefined : [],
        missingFiles: parsed ? [...new Set(parsed.missingFiles)] : [],
        missingExternal: missingExternal.filter((m) => m.doc === doc),
      };
      this.lastResults.set(doc, out);
      docsOut.push(out);
    }
    const ok = docsOut.every((d) => d.status === 'ok' || d.status === 'skipped');
    return { id: req.id, root: req.projectRoot, ok, passes, order, docs: docsOut };
  }

  _latexmk(id, doc, info, { force, clean }) {
    return new Promise(async (resolve) => {
      const dir = path.dirname(doc);
      const base = path.basename(doc);
      if (clean) await this._spawn(id, doc, 'latexmk', ['-C', base], dir);
      // A latexmkrc that picks the format itself ($pdf_mode) wins; one that
      // does not would make latexmk fall back to DVI, so we pass the flag.
      const rc = rcInfo(dir);
      const rcPicksFormat = rc.exists && rc.pdfMode;
      const o = outputs(doc);
      // An .fls without its .aux (aux deleted by hand or by another editor)
      // makes latexmk run BibTeX on an empty aux and stop. Drop that stale
      // bookkeeping so latexmk starts as on a first build.
      // A leftover .bbl without .aux does the same (latexmk 4.83 sets up the
      // BibTeX rule first); a direct engine run below recreates the aux.
      const auxMissing = !fs.existsSync(o.aux);
      if (auxMissing) {
        for (const f of [o.fls, o.fdb]) fs.rmSync(f, { force: true });
      }
      // With $aux_dir/$out_dir the other documents' .aux files are not next
      // to their .tex, where \externaldocument looks: put their folders on
      // TEXINPUTS. The direct run below writes where latexmk will look.
      const auxDirs = [...new Set([o, ...(info.externals || []).map((e) => outputs(e))].filter((x) => x.moved).map((x) => x.auxDir))];
      const env = auxDirs.length ? { TEXINPUTS: auxDirs.join(path.delimiter) + path.delimiter + (process.env.TEXINPUTS || '') } : {};
      const direct = o.auxDir !== dir ? [`-output-directory=${o.auxDir}`] : [];
      if (o.auxDir !== dir) fs.mkdirSync(o.auxDir, { recursive: true });
      // To force a rerun we do not use latexmk -g, which forces every rule
      // including BibTeX before LaTeX has written the aux. One direct engine
      // run reads the new labels of the other documents; latexmk then sees
      // the changed aux and does whatever BibTeX/rerun work follows.
      if (force || (auxMissing && fs.existsSync(o.bbl))) {
        this.emit('event', { type: 'build:step', id, doc, rule: info.engine, run: 0 });
        await this._spawn(id, doc, info.engine, ['-interaction=nonstopmode', '-file-line-error', '-synctex=1', '-recorder', ...direct, base], dir, env);
        if (this.running.cancelled) return resolve(-1);
      }
      const args = [
        info.engineSource === 'padrão' && rcPicksFormat ? null : ENGINE_FLAG[info.engine] || '-pdf',
        '-interaction=nonstopmode',
        '-file-line-error',
        '-synctex=1',
        '-recorder',
        base,
      ].filter(Boolean);
      const code = await this._spawn(id, doc, 'latexmk', args, dir, env);
      resolve(code);
    });
  }

  _spawn(id, doc, cmd, args, cwd, extraEnv = {}) {
    // Preferências (stallSeconds) win; the variable stays for tests.
    const STALL_MS = Number(process.env.TEXUGO_STALL_MS) || (this.stallSeconds > 0 ? this.stallSeconds * 1000 : 180000);
    const MAX_LOG = 50 * 1024 * 1024;
    const STALL_MSG = `compilação parada: ${Math.round(STALL_MS / 1000)} s sem nenhum progresso (laço infinito ou comando esperando resposta?)`;
    const FLOOD_MSG = 'compilação parada: o log passou de 50 MB, sinal de laço infinito';
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, env: toolEnv(extraEnv), detached: true, windowsHide: true });
      this.running.child = child;
      this.emit('event', { type: 'build:log', id, doc, text: `$ ${cmd} ${args.join(' ')}\n` });
      let buf = '';
      // A TeX run that prints nothing for STALL_MS, or floods the log, is stuck
      // (an endless loop, a macro waiting on input that never comes). Kill it
      // instead of leaving the build spinning forever.
      let total = 0;
      let stalled = null;
      const stop = (why) => {
        if (stalled) return;
        stalled = why;
        this.emit('event', { type: 'build:log', id, doc, text: `\n! TeXugo: ${why}\n` });
        killTree(child, 'SIGKILL');
      };
      let timer = setTimeout(() => stop(STALL_MSG), STALL_MS);
      const onData = (d) => {
        clearTimeout(timer);
        timer = setTimeout(() => stop(STALL_MSG), STALL_MS);
        total += d.length;
        if (total > MAX_LOG) return stop(FLOOD_MSG);
        const text = d.toString();
        this.emit('event', { type: 'build:log', id, doc, text });
        buf += text;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) {
          // latexmk announces each tool it runs; surface them as steps.
          const m = l.match(/^Run number (\d+) of rule '([^']+)'/);
          if (m) this.emit('event', { type: 'build:step', id, doc, rule: m[2], run: Number(m[1]) });
          else if (/^Latexmk: All targets .* are up-to-date|^Latexmk: Nothing to do/.test(l)) this.emit('event', { type: 'build:step', id, doc, rule: 'atualizado', run: 0 });
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => {
        clearTimeout(timer);
        this.emit('event', { type: 'build:log', id, doc, text: String(err) + '\n' });
        resolve(-1);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        this.running.child = null;
        if (stalled) return resolve(-1);
        resolve(code == null ? -1 : code);
      });
    });
  }
}

function readMaybe(f) {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
}

// Why is \ref{key} undefined in `doc`? Looks for the label in the project.
function explainRef(key, doc, info, infos, symbols, projectRoot) {
  const defs = symbols.labels.filter((l) => l.key === key);
  if (!defs.length) return `Nenhum \\label{${key}} no projeto. Erro de digitação ou rótulo apagado?`;
  // Is it in another document's aux, i.e. defined in a separate document?
  for (const other of infos.keys()) {
    if (other === doc) continue;
    if (auxLabels(outputs(other).aux).has(key)) {
      return info.externals.includes(other)
        ? `O rótulo está em ${path.basename(other)}, que este documento importa. Recompile o grupo todo (o TeXugo faz isso sozinho).`
        : `O rótulo está em ${path.basename(other)}, mas ${path.basename(doc)} não tem \\externaldocument{${path.basename(stem(other))}}.`;
    }
  }
  const closure = includeClosure(doc);
  const own = defs.find((d) => closure.has(d.file));
  if (own) {
    return `O rótulo está neste documento (${path.relative(projectRoot, own.file)}:${own.line}), mas o LaTeX não chegou a gravá-lo: o rótulo está dentro de um trecho que não é compilado, ou a compilação parou antes por um erro.`;
  }
  const where = defs[0];
  const rel = path.relative(projectRoot, where.file);
  return `O rótulo existe em ${rel}:${where.line}, mas esse arquivo não entra neste documento (nem por \\input nem por \\externaldocument).`;
}
