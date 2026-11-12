// Local server behind the TeXugo window. Serves the web UI, a JSON API for
// files/builds/git/synctex, and a WebSocket that pushes build progress and
// file changes. Binds to 127.0.0.1 only and requires a per-launch token, so
// web pages open in other browsers cannot reach it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as project from './project.js';
import * as gitOps from './git.js';
import * as coauthors from './coauthors.js';
import * as comments from './comments.js';
import * as sent from './sent.js';
import * as sync from './synctex.js';
import * as textsync from './textsync.js';
import { BuildManager } from './build.js';
import { LiveManager, overlayPath, realPath } from './live.js';
import { Grammar } from './grammar.js';
import { isInside, dataDir, run, which, toolEnv, writeKeepingLink, refreshTools, linkTargetOk } from './util.js';
import { listTemplates, createFromTemplate } from './templates.js';
import { exportZip, blindCheck } from './submission.js';
import * as replication from './replication.js';
import { journalById } from './replication-journals.js';
import * as ai from './ai.js';
import { Terminals } from './terminal.js';
import { IdeBridge } from './ide.js';
import { Agents, claudeFlags, MODEL_LIST } from './agent.js';
import * as doctor from './doctor.js';
import * as refs from './refs.js';
import * as compare from './compare.js';
import * as refcheck from './refcheck.js';
import * as zotero from './zotero.js';
import { setTrustCheck, riskyItems, underTrusted } from './trust.js';
import { outputs } from './outdirs.js';
import * as library from './library.js';
import * as reviewer from './review.js';
import * as rr from './rr.js';
import { openCommand, revealCommand, terminalCommand } from './platform.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const DIST = path.join(APP_ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
};

// Persistent state: recent projects, settings, per-project UI state.
const STATE_FILE = () => path.join(dataDir(), 'state.json');
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
  } catch {
    return { recents: [], settings: {}, projects: {} };
  }
}
function saveState(s) {
  const tmp = STATE_FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE_FILE());
}

export function createServer({ port = 0, token = randomBytes(24).toString('hex'), hooks = {} } = {}) {
  const state = loadState();
  // Folders trusted to run their own latexmkrc and .claude/ settings (I8).
  // On the first run of this version, the folders already in the recents
  // count as the user's own.
  if (!Array.isArray(state.trusted)) state.trusted = [...(state.recents || [])];
  setTrustCheck((dir) => underTrusted(state.trusted, dir));
  const openProjects = new Set(); // roots the UI opened; file access is limited to these
  const watchers = new Map();
  const builds = new BuildManager();
  builds.stallSeconds = Number((state.settings || {}).stallSeconds) || 0;
  const clients = new Set();
  const selfWrites = new Map(); // path -> time of our own last write, to mute echo

  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === 1) ws.send(data);
  };
  builds.on('event', broadcast);
  const live = new LiveManager();
  live.on('event', broadcast);
  const grammar = new Grammar(broadcast);

  const allowed = (p) => typeof p === 'string' && [...openProjects].some((r) => isInside(r, p)) && linkTargetOk([...openProjects], p);
  // The paper library lives in the app's data folder: readable (PDF views,
  // Preview) though it is in no project.
  const readable = (p) => allowed(p) || (typeof p === 'string' && isInside(library.libDir(), path.resolve(p)));
  const mustAllow = (p) => {
    if (!allowed(p)) throw httpError(403, 'Caminho fora do projeto aberto.');
    return path.resolve(p);
  };

  // Questions to the page (show a diff, open a file, save): the page answers
  // with uiReply. timeout 0 waits for the user as long as it takes.
  const asks = new Map();
  let askSeq = 0;
  const askUi = (type, payload, timeout = 30000) =>
    new Promise((resolve) => {
      if (![...clients].some((c) => c.readyState === 1)) return resolve({});
      const askId = `a${++askSeq}`;
      const timer = timeout ? setTimeout(() => (asks.delete(askId), resolve({})), timeout) : null;
      asks.set(askId, (answer) => (timer && clearTimeout(timer), asks.delete(askId), resolve(answer || {})));
      broadcast({ type, askId, ...payload });
    });

  const terminals = new Terminals(broadcast);
  // Compile errors and ?? of the last builds, as diagnostics for Claude Code.
  const diagnostics = () => {
    const out = [];
    for (const r of builds.lastResults.values()) {
      for (const e of r.errors || []) out.push({ file: e.file || r.doc, line: e.line, severity: 'Error', message: e.message + (e.hint ? ` (${e.hint})` : '') });
      for (const u of r.undefinedRefs || []) out.push({ file: u.file || r.doc, line: u.line, severity: 'Warning', message: `Undefined reference \\ref{${u.key}} (prints ?? in the PDF)` + (u.explain ? `. ${u.explain}` : '') });
      for (const c of r.undefinedCites || []) out.push({ file: c.file || r.doc, line: c.line, severity: 'Warning', message: `Undefined citation \\cite{${c.key}}` + (c.explain ? `. ${c.explain}` : '') });
      for (const w of (r.warnings || []).slice(0, 100)) out.push({ file: w.file || r.doc, line: w.line, severity: 'Warning', message: w.message });
    }
    return out;
  };
  const ide = new IdeBridge({ broadcast, askUi, diagnostics, allowed });
  const agents = new Agents(broadcast);

  function watch(root) {
    if (watchers.has(root)) return;
    const pending = new Map();
    let timer = null;
    try {
      const w = fs.watch(root, { recursive: true }, (_ev, rel) => {
        if (!rel) return;
        if (/(^|\/)(\.git|node_modules)(\/|$)/.test(rel) || rel.endsWith('.texugo-tmp') || rel.startsWith('.texugo/live/')) return;
        const full = path.join(root, rel);
        pending.set(full, true);
        clearTimeout(timer);
        timer = setTimeout(() => {
          const files = [...pending.keys()].filter((f) => !(selfWrites.get(f) > Date.now() - 1500));
          pending.clear();
          if (files.length) broadcast({ type: 'fs:change', root, files });
        }, 250);
      });
      watchers.set(root, w);
    } catch {
      // fs.watch can fail on network volumes; the UI still works without it.
    }
  }

  function rememberRecent(root) {
    state.recents = [root, ...(state.recents || []).filter((r) => r !== root)].slice(0, 15);
    saveState(state);
  }

  const api = {
    async hello({ refresh } = {}) {
      if (refresh) refreshTools();
      const tools = {};
      for (const t of ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'biber', 'bibtex', 'synctex', 'git', 'chktex']) tools[t] = await which(t);
      const tex = tools.pdflatex ? (await run('pdflatex', ['--version'])).stdout.split('\n')[0] : null;
      return {
        version: JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version,
        tools,
        tex,
        recents: (state.recents || []).filter((r) => fs.existsSync(r)),
        settings: state.settings || {},
        models: MODEL_LIST,
        home: process.env.HOME,
        // Nothing chosen and nothing opened yet: the page picks the language.
        firstRun: !(state.recents || []).length && !state.projects && !(state.settings || {}).lang,
      };
    },
    async saveSettings({ settings }) {
      state.settings = { ...(state.settings || {}), ...settings };
      builds.stallSeconds = Number(state.settings.stallSeconds) || 0;
      saveState(state);
      return state.settings;
    },
    // Before opening: does the folder bring configuration that runs code,
    // and has the user already said they trust it? Reads only file names.
    async projectRisk({ root }) {
      root = path.resolve(String(root || ''));
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw httpError(404, 'Pasta não encontrada.');
      const docDirs = project.listDocuments(root).map((d) => path.dirname(d));
      return { risky: riskyItems(root, docDirs), trusted: underTrusted(state.trusted, root) };
    },
    async trustProject({ root }) {
      root = path.resolve(String(root || ''));
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw httpError(404, 'Pasta não encontrada.');
      if (!state.trusted.includes(root)) state.trusted.push(root);
      saveState(state);
      return true;
    },
    async openProject({ root }) {
      root = path.resolve(root);
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw httpError(404, 'Pasta não encontrada.');
      openProjects.add(root);
      ide.setFolders([...openProjects]);
      watch(root);
      rememberRecent(root);
      ensureGitignore(root);
      const docs = project.listDocuments(root).map((d) => ({ ...project.docInfo(d), pdf: outputs(d).pdf }));
      return { root, name: path.basename(root), docs, ui: (state.projects || {})[root] || null };
    },
    async saveProjectUi({ root, ui }) {
      mustAllow(root);
      state.projects = state.projects || {};
      state.projects[root] = ui;
      saveState(state);
      return true;
    },
    async forgetRecent({ root }) {
      state.recents = (state.recents || []).filter((r) => r !== root);
      saveState(state);
      return state.recents;
    },
    async tree({ root, showArtifacts }) {
      mustAllow(root);
      return project.listTree(root, { showArtifacts });
    },
    async documents({ root }) {
      mustAllow(root);
      const docs = project.listDocuments(root);
      return { docs: docs.map((d) => project.docInfo(d)), truncated: !!docs.truncated };
    },
    async read({ path: p }) {
      p = mustAllow(p);
      const st = fs.statSync(p);
      if (st.size > 8 * 1024 * 1024) throw httpError(413, 'Arquivo grande demais para o editor (> 8 MB).');
      const buf = fs.readFileSync(p);
      const binary = buf.subarray(0, 8000).includes(0);
      return { path: p, text: binary ? null : buf.toString('utf8'), binary, mtime: st.mtimeMs, size: st.size };
    },
    async write({ path: p, text, expectMtime }) {
      p = mustAllow(p);
      if (expectMtime && fs.existsSync(p)) {
        const now = fs.statSync(p).mtimeMs;
        // Someone else (git, an agent, another editor) changed the file after
        // we loaded it. Refuse instead of silently overwriting their work.
        if (Math.abs(now - expectMtime) > 1) return { conflict: true, mtime: now };
      }
      selfWrites.set(p, Date.now());
      writeKeepingLink(p, text);
      return { mtime: fs.statSync(p).mtimeMs };
    },
    async createFile({ path: p, text = '', dir = false }) {
      p = mustAllow(p);
      if (fs.existsSync(p)) throw httpError(409, 'Já existe um arquivo com esse nome.');
      if (dir) fs.mkdirSync(p, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
      }
      return { path: p };
    },
    async rename({ from, to }) {
      from = mustAllow(from);
      to = mustAllow(to);
      if (fs.existsSync(to)) throw httpError(409, 'Já existe um arquivo com esse nome.');
      fs.renameSync(from, to);
      return { path: to };
    },
    async trash({ path: p }) {
      p = mustAllow(p);
      if (hooks.trash) await hooks.trash(p);
      else throw httpError(501, 'Mover para o Lixo só funciona no app.');
      return true;
    },
    async reveal({ path: p }) {
      p = mustAllow(p);
      if (hooks.reveal) hooks.reveal(p);
      else await run(...revealCommand(p));
      return true;
    },
    async openExternal({ path: p }) {
      if (!readable(p)) throw httpError(403, 'Caminho fora do projeto aberto.');
      p = path.resolve(p);
      if (hooks.openPath) await hooks.openPath(p);
      else await run(...openCommand(p));
      return true;
    },
    async openUrl({ url }) {
      if (!/^https:\/\//.test(url)) throw httpError(400, 'Só links https.');
      if (hooks.openUrl) await hooks.openUrl(url);
      else await run(...openCommand(url));
      return true;
    },
    async broadcast({ msg }) {
      // Relay between TeXugo windows (main window <-> PDF windows).
      const okTypes = ['open-request', 'sync-show', 'pdfwin:open', 'pdfwin:close', 'pdfwin:dock', 'pdfwin:ping'];
      if (!msg || !okTypes.includes(msg.type)) throw httpError(400, 'Mensagem desconhecida.');
      broadcast(msg);
      return true;
    },
    async stat({ paths }) {
      return paths.map((p) => {
        try {
          return { path: p, mtime: fs.statSync(mustAllow(p)).mtimeMs };
        } catch {
          return { path: p, mtime: null };
        }
      });
    },
    async rootsFor({ root, path: p }) {
      mustAllow(p);
      return project.rootsFor(root, p).map((d) => project.docInfo(d));
    },
    // The .tex files of a document (itself plus everything it \input s).
    async docFiles({ doc }) {
      return [...project.includeClosure(mustAllow(doc))].filter((f) => /\.tex$/.test(f));
    },
    async outline({ path: p, text }) {
      return project.outline(mustAllow(p), text);
    },
    async symbols({ root }) {
      mustAllow(root);
      return project.projectSymbols(root);
    },
    async search({ root, query, regex = false, caseSensitive = false }) {
      mustAllow(root);
      if (!query) return [];
      let re;
      try {
        re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
      } catch {
        throw httpError(400, 'Expressão regular inválida.');
      }
      const out = [];
      const files = project.listTexFiles(root).concat(listByExt(root, ['.bib', '.md', '.sty', '.cls', '.txt']));
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && out.length < 2000; i++) {
          re.lastIndex = 0;
          const m = re.exec(lines[i]);
          if (m) out.push({ file: f, line: i + 1, col: m.index, text: lines[i].slice(0, 300), len: m[0].length });
        }
      }
      return out;
    },
    async build({ root, docs, force, clean }) {
      mustAllow(root);
      docs.forEach(mustAllow);
      return { id: builds.request(root, docs, { force, clean }) };
    },
    async cancelBuild() {
      builds.cancel();
      return true;
    },
    async buildPlan({ docs }) {
      docs.forEach(mustAllow);
      const { order, infos } = builds.plan(docs);
      return order.map((d) => infos.get(d));
    },
    async lastResults({ docs }) {
      return docs.map((d) => builds.lastResults.get(d) || null);
    },
    async cleanAux({ doc }) {
      doc = mustAllow(doc);
      return run('latexmk', ['-c', path.basename(doc)], { cwd: path.dirname(doc) });
    },
    async syncForward(args) {
      mustAllow(args.file);
      mustAllow(args.pdf);
      // A live PDF knows unsaved files by their overlay copy.
      const ov = live.overlayFor(args.pdf);
      if (ov) {
        const o = overlayPath(ov.dirs, ov.doc, args.file);
        if (o && fs.existsSync(o)) return sync.forward({ ...args, file: o });
      }
      return sync.forward(args);
    },
    async syncInverse(args) {
      mustAllow(args.pdf);
      const r = await sync.inverse(args);
      const ov = live.overlayFor(args.pdf);
      if (ov && r.ok) r.file = realPath(ov.dirs, ov.doc, r.file);
      return r;
    },
    // Live preview of `doc` with the unsaved buffers [{ path, text }].
    async livePreview({ root, doc, buffers, tolerate }) {
      mustAllow(root);
      doc = mustAllow(doc);
      for (const b of buffers || []) mustAllow(b.path);
      return live.request(path.resolve(root), doc, buffers, { tolerate });
    },
    // Grammar and spelling (LanguageTool), on plain paragraphs.
    async grammarStatus() {
      return grammar.status();
    },
    async grammarCheck({ paras, server, disabledRules, level }) {
      try {
        return { results: await grammar.check(paras || [], { server, disabledRules, level }) };
      } catch (err) {
        return { error: err.message, code: err.code || null };
      }
    },
    async grammarInstall() {
      await grammar.install();
      return grammar.status();
    },
    async liveStop({ doc }) {
      live.stop(mustAllow(doc));
      return true;
    },
    async gitStatus({ root }) {
      mustAllow(root);
      return gitOps.status(root);
    },
    async gitDiff({ root, path: p, staged }) {
      mustAllow(root);
      return gitOps.diff(root, p, staged);
    },
    async gitStage({ root, files }) {
      mustAllow(root);
      return gitOps.stage(root, files);
    },
    async gitUnstage({ root, files }) {
      mustAllow(root);
      return gitOps.unstage(root, files);
    },
    async gitCommit({ root, message, all, force }) {
      mustAllow(root);
      return gitOps.commit(root, message, { all, force });
    },
    async gitSync({ root, message, force }) {
      mustAllow(root);
      return gitOps.sync(root, message, { force });
    },
    async gitFetch({ root }) {
      mustAllow(root);
      return gitOps.fetch(root);
    },
    async gitPull({ root }) {
      mustAllow(root);
      return gitOps.pull(root);
    },
    async gitPush({ root }) {
      mustAllow(root);
      return gitOps.push(root);
    },
    async gitLog({ root, path: p }) {
      mustAllow(root);
      return gitOps.log(root, p);
    },
    async gitNews({ root, since, base }) {
      mustAllow(root);
      return coauthors.news(root, { since, base });
    },
    async gitMarkSeen({ root, hash }) {
      mustAllow(root);
      if (hash != null && !/^[0-9a-f]{7,40}$/.test(hash)) throw httpError(400, 'Commit inválido.');
      return coauthors.markSeen(root, hash);
    },
    async gitNewsDiff({ root, from, to, path: p }) {
      mustAllow(root);
      for (const r of [from, to || 'HEAD']) if (!/^([0-9a-f]{7,40}|HEAD|@\{u\})$/.test(r)) throw httpError(400, 'Commit inválido.');
      return coauthors.newsDiff(root, { from, to, file: p ? mustAllow(p) : null });
    },
    async gitShow({ root, rev, path: p }) {
      mustAllow(root);
      if (!/^[0-9a-f]{7,40}$/.test(rev)) throw httpError(400, 'Commit inválido.');
      return coauthors.showCommit(root, { rev, file: p ? mustAllow(p) : null });
    },
    async gitBlame({ root, path: p, text }) {
      mustAllow(root);
      return coauthors.blame(root, { file: mustAllow(p), text });
    },
    async commentsList({ root }) {
      mustAllow(root);
      return comments.list(root);
    },
    async commentAdd({ root, path: p, anchor, text }) {
      mustAllow(root);
      return comments.create(root, { file: mustAllow(p), anchor, text });
    },
    async commentReply({ root, id, text }) {
      mustAllow(root);
      return comments.reply(root, id, text);
    },
    async commentResolve({ root, id, done }) {
      mustAllow(root);
      return comments.resolve(root, id, !!done);
    },
    async commentsStripEmails({ root }) {
      mustAllow(root);
      return comments.stripEmails(root);
    },
    async commentReanchor({ root, id, anchor }) {
      mustAllow(root);
      return comments.reanchor(root, id, anchor);
    },
    async commentDelete({ root, id }) {
      mustAllow(root);
      return comments.remove(root, id);
    },
    async gitInit({ root }) {
      mustAllow(root);
      return gitOps.init(root);
    },
    async templates() {
      return listTemplates();
    },
    async gitClone({ url, parent, name }) {
      url = String(url || '').trim();
      if (!/^(https:\/\/[\w.-]+\/[\w.\/~-]+|git@[\w.-]+:[\w.\/~-]+)$/.test(url)) throw httpError(400, 'Endereço inválido. Use https://github.com/dono/repo ou git@github.com:dono/repo.git');
      if (!name || /[\/]|^\.\.?$/.test(name)) throw httpError(400, 'Nome de pasta inválido.');
      const target = path.join(path.resolve(parent), name);
      if (fs.existsSync(target) && fs.readdirSync(target).length) throw httpError(409, 'A pasta já existe e não está vazia.');
      fs.mkdirSync(path.resolve(parent), { recursive: true });
      // GIT_TERMINAL_PROMPT=0: fail fast instead of waiting for a password
      // prompt nobody can answer; credentials come from the keychain.
      const r = await run('git', ['clone', '--', url, target], { timeout: 10 * 60 * 1000, env: { ...toolEnv(), GIT_TERMINAL_PROMPT: '0' } });
      if (r.code !== 0) {
        const msg = (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ');
        throw httpError(500, /Authentication|could not read Username|Permission denied/i.test(msg) ? 'Sem permissão para clonar. Repositório privado? Entre na conta pelo GitHub Desktop ou use o endereço SSH. (' + msg + ')' : msg);
      }
      return api.openProject({ root: target });
    },
    async createProject({ template, parent, name, fields, lang }) {
      // A folder name, not a path: "../x" would create it outside `parent`.
      if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[\\/\0]/.test(name)) throw httpError(400, 'Nome de pasta inválido.');
      const target = path.join(path.resolve(parent), name);
      if (fs.existsSync(target) && fs.readdirSync(target).length) throw httpError(409, 'A pasta já existe e não está vazia.');
      createFromTemplate(template, target, fields || {}, lang);
      // A project TeXugo made from its own template is the user's.
      if (!state.trusted.includes(target)) state.trusted.push(target), saveState(state);
      return api.openProject({ root: target });
    },
    async texDoctor() {
      return doctor.texInfo({ refresh: true });
    },
    async findPackages({ files }) {
      return doctor.findPackages(files);
    },
    async installPackages({ pkgs }) {
      return doctor.installPackages(pkgs);
    },
    async format({ path: p, text }) {
      return doctor.formatLatex(text, mustAllow(p));
    },
    // Terminals and the Claude Code bridge.
    async termCreate({ root, kind, cols, rows, model, effort }) {
      mustAllow(root);
      let env = {};
      if (kind === 'claude') {
        await ide.start();
        ide.setFolders([...openProjects]);
        env = ide.env();
      }
      return terminals.create({ cwd: root, kind, cols, rows, env, claudeArgs: kind === 'claude' ? claudeFlags({ model, effort }) : [] });
    },
    async termList() {
      return terminals.list();
    },
    async termSnapshot({ id }) {
      return terminals.snapshot(id);
    },
    async termKill({ id }) {
      terminals.kill(id);
      return true;
    },
    async ideState({ tabs, selection }) {
      if (tabs) ide.setTabs(tabs.filter((t) => allowed(t.path)));
      if (selection && allowed(selection.filePath)) ide.setSelection(selection);
      return { clients: ide.connectedCount };
    },
    async ideMention({ path: p, lineStart, lineEnd }) {
      ide.atMention(mustAllow(p), lineStart, lineEnd);
      return { clients: ide.connectedCount };
    },
    async uiReply({ askId, answer }) {
      const fn = asks.get(askId);
      if (fn) fn(answer);
      return true;
    },
    // Claude chat panel.
    async agentSend({ root, text, model, effort }) {
      mustAllow(root);
      if (!text || !text.trim()) throw httpError(400, 'Mensagem vazia.');
      return agents.send(path.resolve(root), text, { model, effort });
    },
    async agentAnswer({ root, reqId, allow, note }) {
      return agents.answer(path.resolve(mustAllow(root)), reqId, !!allow, note);
    },
    async agentInterrupt({ root }) {
      return agents.interrupt(path.resolve(mustAllow(root)));
    },
    async agentReset({ root }) {
      return agents.reset(path.resolve(mustAllow(root)));
    },
    async aiRewrite({ root, path: p, action, text, before, after, hints, lang, model, effort }) {
      mustAllow(p);
      mustAllow(root);
      if (!text || text.length > 12000) throw httpError(400, 'Selecione um trecho de até 12 mil caracteres.');
      return ai.rewrite({ root, file: p, action, text, before, after, hints: hints || [], lang, model, effort });
    },
    async aiCancel({ root } = {}) {
      return ai.cancelAi(root);
    },
    async exportZip({ doc }) {
      return exportZip(mustAllow(doc));
    },
    // Replication package: what the folder shows against the DCAS standard,
    // the journal chosen and the boxes ticked (.texugo/replication.json).
    async replicationScan({ root, doc }) {
      root = mustAllow(root);
      const out = await replication.scan(root, { doc: doc ? mustAllow(doc) : null });
      const top = (await run('git', ['rev-parse', '--show-toplevel'], { cwd: root, timeout: 8000 })).stdout.trim();
      out.gitTop = top && path.resolve(top) !== root && isInside(top, root) ? top : null;
      out.state = replication.loadState(root);
      return out;
    },
    async replicationState({ root, state }) {
      return replication.saveState(mustAllow(root), state || {});
    },
    async replicationReadme({ root, doc, title, authors, journal }) {
      root = mustAllow(root);
      return replication.draftReadme(root, { doc: doc ? mustAllow(doc) : null, title: String(title || '').slice(0, 300), authors: String(authors || '').slice(0, 300), journal: journalById(journal) });
    },
    async replicationSaveReadme({ root, text }) {
      return replication.saveReadme(mustAllow(root), String(text || '').slice(0, 500000));
    },
    // References: look up a DOI / arXiv id / title and append it to a .bib.
    async refLookup({ q }) {
      return refs.lookup(q);
    },
    // SyncTeX by text, for PDFs built without a .synctex.gz.
    async syncTextInverse({ doc, text }) {
      return textsync.findInSource(mustAllow(doc), String(text || '').slice(0, 2000));
    },
    async syncLineWords({ file, line }) {
      return textsync.sourceLineWords(mustAllow(file), Number(line) || 1);
    },
    async refCheck({ bib, keys }) {
      if (!/\.bib$/.test(bib || '')) throw httpError(400, 'Escolha um arquivo .bib.');
      return refcheck.checkBib(mustAllow(bib), { keys });
    },
    async refApply({ bib, fixes }) {
      if (!/\.bib$/.test(bib || '')) throw httpError(400, 'Escolha um arquivo .bib.');
      return refcheck.applyFixes(mustAllow(bib), Array.isArray(fixes) ? fixes : []);
    },
    // Referee-style review of the whole paper by the user's Claude Code.
    async reviewRun({ root, doc, journal, focus, lang, model, effort }) {
      mustAllow(root);
      return reviewer.review({ root, doc: path.resolve(mustAllow(doc)), journal, focus, lang, model, effort });
    },
    async respondReferees({ root, doc, reports, source, lang, model, effort }) {
      mustAllow(root);
      if (!reports || reports.length < 40) throw httpError(400, 'Cole os pareceres.');
      if (source && !['git', 'path'].includes(source.kind)) throw httpError(400, 'Versão inválida.');
      return rr.respond({ root, doc: path.resolve(mustAllow(doc)), reports: String(reports).slice(0, 200000), source, lang, model, effort });
    },
    // PDF annotations: a received annotated PDF is copied into the project
    // (so the viewer may read it); which notes are resolved is kept beside it.
    async annotImport({ doc, file }) {
      doc = mustAllow(doc);
      if (!/\.pdf$/i.test(file || '') || !fs.existsSync(file)) throw httpError(400, 'Escolha um PDF.');
      const dir = path.join(path.dirname(doc), '.texugo', 'annotations');
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, path.basename(file));
      fs.copyFileSync(file, target);
      return target;
    },
    async annotState({ doc, pdf }) {
      mustAllow(doc);
      try {
        return JSON.parse(fs.readFileSync(path.join(path.dirname(doc), '.texugo', 'annotations', path.basename(pdf) + '.json'), 'utf8'));
      } catch {
        return {};
      }
    },
    async annotMark({ doc, pdf, id, done }) {
      mustAllow(doc);
      const dir = path.join(path.dirname(doc), '.texugo', 'annotations');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, path.basename(pdf) + '.json');
      let st = {};
      try {
        st = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {}
      if (done) st[id] = true;
      else delete st[id];
      fs.writeFileSync(f, JSON.stringify(st));
      return st;
    },
    async reviewLast({ doc }) {
      return reviewer.lastReview(path.resolve(mustAllow(doc)));
    },
    async reviewMark({ doc, id, done }) {
      const r = reviewer.lastReview(path.resolve(mustAllow(doc)));
      if (!r) return null;
      const p = r.points.find((x) => x.id === id);
      if (p) p.done = !!done;
      fs.writeFileSync(path.join(path.dirname(doc), '.texugo', 'review', path.basename(doc, '.tex') + '.json'), JSON.stringify(r, null, 2));
      return r;
    },
    async reviewSaveMd({ root, doc }) {
      const r = reviewer.lastReview(path.resolve(mustAllow(doc)));
      if (!r) throw httpError(404, 'Nenhum parecer gerado ainda.');
      const target = path.join(path.dirname(doc), path.basename(doc, '.tex') + '-parecer.md');
      fs.writeFileSync(target, reviewer.toMarkdown(r, mustAllow(root)));
      return target;
    },
    // Paper library: PDFs kept for every project, searchable by their text.
    async libList() {
      return library.list();
    },
    async libAddFiles({ files }) {
      const out = [];
      for (const f of (Array.isArray(files) ? files : []).slice(0, 500)) {
        if (!/\.pdf$/i.test(f) || !fs.existsSync(f)) throw httpError(404, 'PDF não encontrado: ' + f);
        out.push(library.addFile(path.resolve(f)));
      }
      return out;
    },
    async libAddData({ name, data }) {
      return library.addBuffer(Buffer.from(String(data || ''), 'base64'), String(name || 'paper.pdf'));
    },
    async libSetText({ id, pages, guess }) {
      return library.setText(id, Array.isArray(pages) ? pages : [], guess || {});
    },
    async libUpdate({ id, meta }) {
      return library.update(id, meta || {});
    },
    async libRemove({ id }) {
      return library.remove(id);
    },
    async libSearch({ q }) {
      return library.search(q);
    },
    async libZotero() {
      return zotero.pdfAttachments();
    },
    async libAddZotero({ items }) {
      const out = [];
      for (const it of (Array.isArray(items) ? items : []).slice(0, 5000)) {
        try {
          out.push(library.addFile(it.path, it));
        } catch {}
      }
      return out;
    },
    // Zotero and other reference managers.
    async zoteroLibrary() {
      return zotero.library();
    },
    async zoteroAdd({ bib, refs: list }) {
      if (!/\.bib$/.test(bib || '')) throw httpError(400, 'Escolha um arquivo .bib.');
      return zotero.addItems(mustAllow(bib), Array.isArray(list) ? list.slice(0, 500) : []);
    },
    async importBib({ bib, source }) {
      if (!/\.bib$/.test(bib || '') || !/\.bib$/i.test(source || '')) throw httpError(400, 'Escolha um arquivo .bib.');
      if (!fs.existsSync(source)) throw httpError(404, 'Arquivo não encontrado: ' + source);
      return zotero.importBib(mustAllow(bib), path.resolve(source));
    },
    async refBibs({ doc }) {
      return refs.bibsOf(mustAllow(doc)).filter(allowed);
    },
    async refAdd({ bib, ref }) {
      if (!/\.bib$/.test(bib || '')) throw httpError(400, 'Escolha um arquivo .bib.');
      return refs.addToBib(mustAllow(bib), ref);
    },
    // Compare with another version (received .tex/ZIP/folder or a Git commit).
    async compareBuild({ doc, source, target }) {
      mustAllow(doc);
      if (!source || !['path', 'git'].includes(source.kind)) throw httpError(400, 'Escolha a outra versão.');
      if (target && (target.kind !== 'git' || !/^([0-9a-f]{7,40}|HEAD|@\{u\})$/.test(target.rev || ''))) throw httpError(400, 'Versão inválida.');
      return compare.compareBuild(path.resolve(doc), source, target || null);
    },
    // Versions sent to someone, and what came back read against them.
    async sentList({ root }) {
      return { marks: sent.list(mustAllow(root)), feedback: sent.feedbackList(mustAllow(root)).map(({ id, doc, from, source, date, base, counts }) => ({ id, doc, from, source, date, base, counts })) };
    },
    async sentMark({ root, doc, to, note }) {
      return sent.mark(mustAllow(root), mustAllow(doc), { to, note });
    },
    async sentDelete({ root, id }) {
      return sent.remove(mustAllow(root), id);
    },
    async sentFeedback({ root, doc, source, base, buffers, from }) {
      root = mustAllow(root);
      if (!source || source.kind !== 'path' || !source.path) throw httpError(400, 'Escolha o arquivo que voltou.');
      if (base && !((base.kind === 'sent' && base.id) || (base.kind === 'git' && base.rev))) throw httpError(400, 'Versão de base inválida.');
      const own = {};
      for (const [p, text] of Object.entries(buffers || {})) if (allowed(p) && typeof text === 'string') own[path.resolve(p)] = text;
      return sent.feedback(root, mustAllow(doc), { kind: 'path', path: String(source.path) }, { base: base || null, buffers: own, from });
    },
    async sentFeedbackGet({ root, id }) {
      return sent.feedbackGet(mustAllow(root), id);
    },
    async sentDecide({ root, id, n, decision }) {
      return sent.decide(mustAllow(root), id, Number(n), decision ?? null);
    },
    async sentFeedbackDelete({ root, id }) {
      return sent.feedbackRemove(mustAllow(root), id);
    },
    async sentMapLine({ root, id, file, line, marked }) {
      return sent.mapLine(mustAllow(root), id, mustAllow(file), Number(line) || 1, { marked: String(marked || '').slice(0, 400) });
    },
    async sentPdf({ root, id }) {
      return sent.sentPdf(mustAllow(root), id);
    },
    async compareSave({ doc, pdf }) {
      return compare.saveCopy(mustAllow(pdf), mustAllow(doc));
    },
    async blindCheck({ doc, names }) {
      return blindCheck(mustAllow(doc), { names });
    },
    async openTerminal({ path: p }) {
      p = mustAllow(p);
      await run(...terminalCommand(fs.statSync(p).isDirectory() ? p : path.dirname(p)));
      return true;
    },
    async wordCount({ doc }) {
      // texcount counts words in the text, headers and captions separately,
      // following \input; much better than counting in the editor.
      doc = mustAllow(doc);
      const r = await run('texcount', ['-inc', '-total', '-brief', '-utf8', path.basename(doc)], { cwd: path.dirname(doc), timeout: 30000 });
      const m = r.stdout.match(/(\d+)\+(\d+)\+(\d+)/);
      return m ? { text: Number(m[1]), headers: Number(m[2]), captions: Number(m[3]), raw: r.stdout.trim() } : { raw: r.stdout + r.stderr };
    },
    async chktex({ path: p }) {
      p = mustAllow(p);
      const r = await run('chktex', ['-q', '-v0', '-f', '%l:%c:%d:%k:%n:%m\n', p], { cwd: path.dirname(p), timeout: 20000 });
      return r.stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [line, col, len, kind, num, ...msg] = l.split(':');
          return { line: Number(line), col: Number(col), len: Number(len) || 1, kind, num: Number(num), message: msg.join(':') };
        })
        .filter((d) => d.line);
    },
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      // DNS-rebinding guard: only accept our own host names.
      const host = (req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) return send(res, 403, 'forbidden');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'POST') return send(res, 405, 'POST only');
        if (req.headers['x-texugo-token'] !== token) return send(res, 401, 'bad token');
        const name = url.pathname.slice(5);
        if (!Object.hasOwn(api, name)) return send(res, 404, 'unknown method');
        const body = await readBody(req);
        const out = await api[name](body ? JSON.parse(body) : {});
        return sendJson(res, 200, { ok: true, data: out });
      }
      if (url.pathname === '/file') {
        // Raw project files (PDFs, images). Token in the query because pdf.js
        // and <img> cannot set headers.
        if (url.searchParams.get('t') !== token) return send(res, 401, 'bad token');
        const p = path.resolve(url.searchParams.get('p') || '');
        if (!readable(p) || !fs.existsSync(p)) return send(res, 404, 'not found');
        res.writeHead(200, {
          'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store',
          // A project's own .html or .svg opened by URL runs nothing here.
          'content-security-policy': 'sandbox',
        });
        return fs.createReadStream(p).pipe(res);
      }
      // Static UI.
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = path.join(DIST, path.normalize(rel));
      if (!isInside(DIST, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...(file.endsWith('.html') ? { 'content-security-policy': CSP } : {}) });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      sendJson(res, status, { ok: false, error: err.message || String(err) });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const host = (req.headers.host || '').split(':')[0];
    // Only our own page: a browser tab elsewhere sends its own Origin (this
    // also guards --dev, whose token is the fixed "dev").
    const origin = req.headers.origin;
    const ownOrigin = !origin || /^http:\/\/(127\.0\.0\.1|localhost):(\d+)$/.test(origin) && Number(origin.split(':')[2]) === server.address().port;
    if (url.pathname !== '/ws' || url.searchParams.get('t') !== token || !['127.0.0.1', 'localhost'].includes(host) || !ownOrigin) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      // A PDF window says which PDF it shows; when its connection drops
      // (closed, crashed, reloaded) the main window takes the PDF back.
      const pdfwin = url.searchParams.get('pdfwin');
      const pdfroot = url.searchParams.get('root');
      // Keystrokes and sizes of the terminals.
      ws.on('message', (raw) => {
        let m;
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (m.type === 'term:input' && typeof m.data === 'string') terminals.write(m.id, m.data);
        else if (m.type === 'term:resize') terminals.resize(m.id, m.cols, m.rows);
      });
      ws.on('close', () => {
        clients.delete(ws);
        if (pdfwin) broadcast({ type: 'pdfwin:close', pdf: pdfwin, root: pdfroot });
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        server,
        port: actual,
        token,
        url: `http://127.0.0.1:${actual}/?t=${token}`,
        allowProject: (root) => {
          openProjects.add(path.resolve(root));
          watch(path.resolve(root));
        },
        close: () => {
          terminals.killAll();
          agents.killAll();
          ide.removeLock();
          for (const w of watchers.values()) w.close();
          builds.cancel();
          live.stopAll();
          grammar.stop();
          server.close();
        },
      });
    });
  });
}

// Like Lattice: in a Git repository, keep LaTeX build files out of commits
// by adding the missing patterns to .gitignore, once, in a marked block.
// The .bbl and each document's own PDF are generated too: the submission
// ZIP takes the .bbl from disk, not from Git, and coauthors compile their
// own PDF. Figures in PDF stay tracked: only <document>.pdf is ignored.
const GENERATED = ['*.bbl', '*.aux', '*.log', '*.fls', '*.fdb_latexmk', '*.out', '*.toc', '*.lof', '*.lot', '*.blg', '*.bcf', '*.run.xml', '*.synctex.gz', '*.synctex(busy)', '*.nav', '*.snm', '*.vrb', '*.xdv', '*.texugo-tmp', '.texugo/'];
function ensureGitignore(root) {
  try {
    if (!fs.existsSync(path.join(root, '.git'))) return;
    const file = path.join(root, '.gitignore');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const have = new Set(text.split('\n').map((l) => l.trim()));
    const posix = (p) => '/' + path.relative(root, p).split(path.sep).join('/');
    const docs = project.listDocuments(root);
    const wanted = [...GENERATED, ...docs.map((d) => posix(d).replace(/\.tex$/, '.pdf'))];
    // A latexmkrc output folder inside the project holds only build files.
    for (const d of docs) {
      const o = outputs(d);
      for (const dir of [o.outDir, o.auxDir]) if (o.moved && dir !== o.dir && dir !== root && isInside(root, dir)) wanted.push(posix(dir) + '/');
    }
    const missing = [...new Set(wanted)].filter((g) => !have.has(g));
    if (!missing.length) return;
    const block = (text && !text.endsWith('\n') ? '\n' : '') + (text ? '\n' : '') + '# TeXugo: arquivos gerados pelo LaTeX\n' + missing.join('\n') + '\n';
    fs.appendFileSync(file, block);
  } catch {
    // A read-only or odd repository is not worth failing the open for.
  }
}

function listByExt(root, exts) {
  const out = [];
  (function walk(dir, depth) {
    if (depth > 8 || out.length > 2000) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(full, depth + 1);
      } else if (exts.includes(path.extname(e.name))) out.push(full);
    }
  })(root, 0);
  return out;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function send(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// The page's policy, also sent as a header (the <meta> copy cannot carry
// frame-ancestors and is the only barrier if a page ever loses it).
export const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; font-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'";

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 50 * 1024 * 1024) {
        // Stop reading: otherwise the rest still arrives and piles up.
        data = '';
        reject(httpError(413, 'too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
