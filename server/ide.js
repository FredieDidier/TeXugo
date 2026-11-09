// TeXugo as an "IDE" for Claude Code: the protocol the VS Code and Neovim
// integrations speak (documented by coder/claudecode.nvim, PROTOCOL.md).
//
// We listen on a WebSocket at 127.0.0.1:<port>, write ~/.claude/ide/<port>.lock
// with a random token, and start Claude Code with CLAUDE_CODE_SSE_PORT=<port>
// and ENABLE_IDE_INTEGRATION=true. Claude then connects and speaks MCP
// (JSON-RPC 2.0): it reads the selection, the open tabs and the diagnostics
// (here: the compile errors and ?? of the last build), and it sends every
// edit it wants to make through openDiff, which TeXugo shows as a diff for
// the user to accept or reject. On accept we answer FILE_SAVED with the
// contents and Claude Code writes the file itself; TeXugo's file watcher
// then reloads the tab, as one undoable change.
//
// The page holds the editor state, so this module keeps what the page last
// reported (selection, tabs) and asks the page (askUi) for anything that
// needs the user: showing a diff, opening a file, saving.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PROTOCOL = '2024-11-05';
const SCHEMA = 'http://json-schema.org/draft-07/schema#';
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false, $schema: SCHEMA });

const TOOLS = [
  {
    name: 'openDiff',
    description: 'Open a diff view comparing old file content with new file content',
    inputSchema: obj(
      {
        old_file_path: { type: 'string', description: 'Path to the old file to compare' },
        new_file_path: { type: 'string', description: 'Path to the new file to compare' },
        new_file_contents: { type: 'string', description: 'Contents for the new file version' },
        tab_name: { type: 'string', description: 'Name for the diff tab/view' },
      },
      ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name'],
    ),
  },
  {
    name: 'openFile',
    description: 'Open a file in the editor and optionally select a range of text',
    inputSchema: obj(
      {
        filePath: { type: 'string', description: 'Path to the file to open' },
        preview: { type: 'boolean', description: 'Whether to open the file in preview mode', default: false },
        startLine: { type: 'integer', minimum: 1, description: 'Optional: Line number to start selection' },
        endLine: { type: 'integer', minimum: 1, description: 'Optional: Line number to end selection' },
        startText: { type: 'string', description: 'Text pattern to find the start of the selection range. Selects from the beginning of this match.' },
        endText: { type: 'string', description: 'Text pattern to find the end of the selection range. Selects up to the end of this match. If not provided, only the startText match will be selected.' },
        selectToEndOfLine: { type: 'boolean', description: 'If true, selection will extend to the end of the line containing the endText match.', default: false },
        makeFrontmost: { type: 'boolean', description: 'Whether to make the file the active editor tab. If false, the file will be opened in the background without changing focus.', default: true },
      },
      ['filePath'],
    ),
  },
  { name: 'getCurrentSelection', description: 'Get the current text selection in the editor', inputSchema: obj() },
  { name: 'getLatestSelection', description: 'Get the most recent text selection (even if not in the active editor)', inputSchema: obj() },
  { name: 'getOpenEditors', description: 'Get list of currently open files', inputSchema: obj() },
  { name: 'getWorkspaceFolders', description: 'Get all workspace folders currently open in the IDE', inputSchema: obj() },
  {
    name: 'getDiagnostics',
    description: 'Get language diagnostics (errors, warnings) from the editor. In TeXugo these are the LaTeX errors, undefined references (??) and warnings of the last build.',
    inputSchema: obj({ uri: { type: 'string', description: 'Optional file URI to get diagnostics for. If not provided, gets diagnostics for all open files.' } }),
  },
  { name: 'checkDocumentDirty', description: 'Check if a document has unsaved changes (is dirty)', inputSchema: obj({ filePath: { type: 'string', description: 'Path to the file to check' } }, ['filePath']) },
  { name: 'saveDocument', description: 'Save a document with unsaved changes', inputSchema: obj({ filePath: { type: 'string', description: 'Path to the file to save' } }, ['filePath']) },
  { name: 'closeAllDiffTabs', description: 'Close all diff tabs in the editor', inputSchema: obj() },
];

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t) }] });
const toPath = (p) => (p && p.startsWith('file:') ? fileURLToPath(p) : p);

export class IdeBridge {
  // broadcast: send an event to the page; askUi(type, payload) -> Promise of
  // the page's answer; diagnostics() -> [{ file, line, severity, message }];
  // allowed(path) -> whether the path is inside an open project.
  constructor({ broadcast, askUi, diagnostics, allowed }) {
    this.broadcast = broadcast;
    this.askUi = askUi;
    this.diagnostics = diagnostics;
    this.allowed = allowed;
    this.state = { selection: null, latest: null, tabs: [], folders: [] };
    this.clients = new Set();
    this.port = null;
    this.token = randomBytes(16).toString('hex');
    this.lock = null;
    this.diffs = new Map(); // tab_name -> { reqId }
  }

  async start() {
    if (this.port) return this.port;
    removeStaleLocks();
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: (info) => this.authorized(info.req) });
    await new Promise((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
    this.wss = wss;
    this.port = wss.address().port;
    wss.on('connection', (ws) => this.connected(ws));
    this.writeLock();
    const cleanup = () => this.removeLock();
    process.once('exit', cleanup);
    return this.port;
  }

  authorized(req) {
    const got = Buffer.from(String(req.headers['x-claude-code-ide-authorization'] || ''));
    const want = Buffer.from(this.token);
    return got.length === want.length && timingSafeEqual(got, want);
  }

  writeLock() {
    if (!this.port) return;
    const dir = path.join(os.homedir(), '.claude', 'ide');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${this.port}.lock`);
    const body = { pid: process.pid, workspaceFolders: this.state.folders, ideName: 'TeXugo', transport: 'ws', authToken: this.token };
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
    fs.renameSync(tmp, file);
    this.lock = file;
  }

  removeLock() {
    if (this.lock) fs.rmSync(this.lock, { force: true });
  }

  // Environment for a terminal that runs Claude Code against this bridge.
  env() {
    return { CLAUDE_CODE_SSE_PORT: String(this.port), ENABLE_IDE_INTEGRATION: 'true', FORCE_CODE_TERMINAL: 'true' };
  }

  get connectedCount() {
    return this.clients.size;
  }

  // ------------------------------------------------------- state from the page
  setFolders(folders) {
    this.state.folders = [...new Set(folders)];
    this.writeLock();
  }

  setTabs(tabs) {
    this.state.tabs = tabs;
  }

  // sel: { filePath, text, start: {line, character}, end, isEmpty }
  setSelection(sel) {
    if (!sel) return;
    const msg = {
      text: sel.text || '',
      filePath: sel.filePath,
      fileUrl: pathToFileURL(sel.filePath).href,
      selection: { start: sel.start, end: sel.end, isEmpty: !!sel.isEmpty },
    };
    this.state.selection = msg;
    if (!msg.selection.isEmpty) this.state.latest = msg;
    this.notify('selection_changed', msg);
  }

  // "Mencionar no Claude": the file and lines go into Claude's prompt.
  atMention(filePath, lineStart, lineEnd) {
    this.notify('at_mentioned', { filePath, lineStart, lineEnd });
  }

  notify(method, params) {
    const s = JSON.stringify({ jsonrpc: '2.0', method, params });
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(s);
  }

  // ------------------------------------------------------------- connection
  connected(ws) {
    this.clients.add(ws);
    this.broadcast({ type: 'ide:clients', count: this.clients.size });
    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.id == null) return; // notifications (initialized, ide_connected)
      let result;
      let error;
      try {
        result = await this.handle(msg.method, msg.params || {}, ws);
      } catch (err) {
        error = { code: err.code || -32000, message: err.message || String(err) };
      }
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify(error ? { jsonrpc: '2.0', id: msg.id, error } : { jsonrpc: '2.0', id: msg.id, result }));
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      this.broadcast({ type: 'ide:clients', count: this.clients.size });
      // A diff waiting for an answer goes away with its client.
      for (const [name, d] of this.diffs) if (d.ws === ws) this.closeDiff(name);
    });
  }

  async handle(method, params, ws) {
    switch (method) {
      case 'initialize':
        return { protocolVersion: PROTOCOL, capabilities: { logging: {}, prompts: { listChanged: true }, tools: { listChanged: true } }, serverInfo: { name: 'texugo', version: '1' } };
      case 'ping':
        return {};
      case 'prompts/list':
        return { prompts: [] };
      case 'resources/list':
        return { resources: [] };
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.tool(params.name, params.arguments || {}, ws);
      default: {
        const e = new Error('Method not found: ' + method);
        e.code = -32601;
        throw e;
      }
    }
  }

  async tool(name, a, ws) {
    switch (name) {
      case 'getCurrentSelection':
        return this.state.selection ? text({ success: true, ...this.state.selection }) : text({ success: false, message: 'No active editor found' });
      case 'getLatestSelection':
        return this.state.latest ? text({ success: true, ...this.state.latest }) : text({ success: false, message: 'No selection available' });
      case 'getOpenEditors':
        return text({
          tabs: this.state.tabs.map((t) => ({ uri: pathToFileURL(t.path).href, isActive: !!t.active, isPinned: false, isPreview: false, isDirty: !!t.dirty, label: path.basename(t.path), groupIndex: 0, viewColumn: 1, isGroupActive: true, fileName: t.path, languageId: languageOf(t.path), lineCount: t.lines || 0 })),
        });
      case 'getWorkspaceFolders':
        return text({ success: true, folders: this.state.folders.map((f) => ({ name: path.basename(f), uri: pathToFileURL(f).href, path: f })), rootPath: this.state.folders[0] || null });
      case 'getDiagnostics': {
        const only = a.uri ? toPath(a.uri) : null;
        const byFile = new Map();
        for (const d of this.diagnostics()) {
          if (!d.file || (only && path.resolve(d.file) !== path.resolve(only))) continue;
          const uri = pathToFileURL(d.file).href;
          if (!byFile.has(uri)) byFile.set(uri, { uri, diagnostics: [] });
          const line = Math.max(0, (d.line || 1) - 1);
          byFile.get(uri).diagnostics.push({ message: d.message, severity: d.severity, range: { start: { line, character: 0 }, end: { line, character: 0 } }, source: 'LaTeX (TeXugo)' });
        }
        return text([...byFile.values()]);
      }
      case 'checkDocumentDirty': {
        const p = toPath(a.filePath);
        const t = this.state.tabs.find((x) => x.path === p);
        return t ? text({ success: true, filePath: p, isDirty: !!t.dirty, isUntitled: false }) : text({ success: false, message: 'Document not open' });
      }
      case 'saveDocument': {
        const p = toPath(a.filePath);
        if (!this.state.tabs.some((x) => x.path === p)) return text({ success: false, message: 'Document not open' });
        const r = await this.askUi('ide:save', { path: p });
        return text({ success: !!r.saved, filePath: p, saved: !!r.saved, message: r.saved ? 'Document saved' : 'Document not saved' });
      }
      case 'openFile': {
        const p = toPath(a.filePath);
        if (!this.allowed(p)) throw Object.assign(new Error('File outside the open project'), { code: -32602 });
        await this.askUi('ide:openFile', { path: p, startLine: a.startLine, endLine: a.endLine, startText: a.startText, endText: a.endText, selectToEndOfLine: !!a.selectToEndOfLine, focus: a.makeFrontmost !== false });
        return a.makeFrontmost === false ? text({ success: true, filePath: p }) : text(`Opened file: ${p}`);
      }
      case 'openDiff':
        return this.openDiff(a, ws);
      case 'close_tab':
        this.closeDiff(a.tab_name);
        return text('TAB_CLOSED');
      case 'closeAllDiffTabs': {
        const n = this.diffs.size;
        for (const name of [...this.diffs.keys()]) this.closeDiff(name);
        return text(`CLOSED_${n}_DIFF_TABS`);
      }
      default: {
        const e = new Error('Unknown tool: ' + name);
        e.code = -32601;
        throw e;
      }
    }
  }

  // Blocks until the user accepts or rejects the diff in TeXugo.
  async openDiff(a, ws) {
    const oldPath = toPath(a.old_file_path);
    const newPath = toPath(a.new_file_path) || oldPath;
    if (!this.allowed(newPath)) throw Object.assign(new Error('File outside the open project'), { code: -32602 });
    const name = a.tab_name;
    if (this.diffs.has(name)) this.closeDiff(name);
    const tab = this.state.tabs.find((x) => x.path === newPath);
    if (tab && tab.dirty) {
      this.broadcast({ type: 'ide:dirty', path: newPath });
      throw Object.assign(new Error(`Cannot create diff: ${path.basename(newPath)} has unsaved changes in TeXugo. Ask the user to save it first.`), { code: -32000 });
    }
    let old = '';
    try {
      old = fs.readFileSync(oldPath, 'utf8');
    } catch {}
    const reqId = randomBytes(6).toString('hex');
    this.diffs.set(name, { reqId, ws });
    const answer = await this.askUi('ide:openDiff', { reqId, tabName: name, path: newPath, isNew: !fs.existsSync(newPath), oldText: old, newText: a.new_file_contents }, 0);
    this.diffs.delete(name);
    if (answer && answer.accepted) return { content: [{ type: 'text', text: 'FILE_SAVED' }, { type: 'text', text: a.new_file_contents }] };
    return { content: [{ type: 'text', text: 'DIFF_REJECTED' }, { type: 'text', text: name }] };
  }

  closeDiff(name) {
    const d = this.diffs.get(name);
    if (!d) return;
    this.diffs.delete(name);
    this.broadcast({ type: 'ide:closeDiff', reqId: d.reqId });
  }
}

// Lock files of TeXugo processes that were killed before they could clean up.
function removeStaleLocks() {
  const dir = path.join(os.homedir(), '.claude', 'ide');
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.lock'));
  } catch {
    return;
  }
  for (const n of names) {
    const f = path.join(dir, n);
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (d.ideName !== 'TeXugo') continue;
      try {
        process.kill(d.pid, 0);
      } catch (e) {
        if (e.code === 'ESRCH') fs.rmSync(f, { force: true });
      }
    } catch {}
  }
}

function languageOf(p) {
  if (/\.(tex|sty|cls|ltx)$/i.test(p)) return 'latex';
  if (/\.bib$/i.test(p)) return 'bibtex';
  if (/\.(md|markdown)$/i.test(p)) return 'markdown';
  return 'plaintext';
}
