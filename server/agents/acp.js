// The Agent Client Protocol (ACP, version 1): JSON-RPC 2.0, one message per
// line on the agent's stdin and stdout. Gemini CLI and OpenCode speak it
// natively; Codex through the codex-acp adapter. TeXugo is the client.
//
// We advertise no file system and no terminal: the agent uses its own tools
// and asks before anything that changes something, through
// session/request_permission. Each request becomes an approval card in the
// panel, with the whole value (a diff, a command, the raw input), and the
// answer is always "once": nothing is approved for the rest of the session.
// An agent with permission modes (Codex) asks less in the modes that say so.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { killTree } from '../platform.js';
import { spawnLong, tail } from './proc.js';
import { which } from '../util.js';

export const PROTOCOL_VERSION = 1;

// What the agent is told at the start of a conversation. ACP v1 has a system
// prompt only for agents that advertise it, so it goes in the first message.
const INTRO = `<texugo-instructions>
You are running inside TeXugo, a LaTeX editor for academic writing, as the assistant in its side panel.
The user writes papers, slides and syllabi in LaTeX, usually in Portuguese or English: answer in the user's language.
Your edits, new files and shell commands are shown to the user in the panel; depending on the permission mode the user picked, they wait for the user's approval first. If the user rejects one, ask what they want instead.
Messages may start with a <texugo-context> block with the active file, the selection and the errors of the last LaTeX build: use it, do not repeat it back.
To compile, prefer telling the user to click Compile in TeXugo; run latexmk yourself only if asked.
</texugo-instructions>

`;

// ACP tool kinds as the panel draws them.
const ICON = { read: 'file', edit: 'edit', delete: 'edit', move: 'edit', search: 'search', execute: 'command', fetch: 'search', think: 'info', switch_mode: 'info', other: 'info' };

// The choices of a config option, grouped or not, as [{ id, label }].
export function choices(opt) {
  const out = [];
  for (const o of (opt && opt.options) || []) {
    if (Array.isArray(o.options)) for (const x of o.options) out.push({ id: String(x.value), label: String(x.name || x.value) });
    else if (o && o.value != null) out.push({ id: String(o.value), label: String(o.name || o.value) });
  }
  return out;
}

export class AcpSession {
  // agent: { name, product, login, acp: { bin, args, env } }
  constructor(root, opts, emit, agent) {
    this.root = root;
    this.opts = opts;
    this.emit = emit;
    this.agent = agent;
    this.running = false;
    this.next = 0;
    this.calls = new Map(); // our request id -> { resolve, reject }
    this.pending = new Map(); // reqId -> { id: the agent's request id, options }
    this.tools = new Map(); // toolCallId -> what we know of the call
    this.text = '';
    this.buf = '';
    this.err = '';
    this.config = [];
    this.first = true;
  }

  async start() {
    const { bin, args = [] } = this.agent.acp;
    const env = { ...(this.agent.acp.env || {}), ...(this.agent.modeEnv ? this.agent.modeEnv(this.opts.mode) : {}) };
    if (!(await which(bin))) throw new Error(`${this.agent.product} não encontrado. Instale com: ${this.agent.install}`);
    const child = (this.child = spawnLong(bin, args, this.root, env));
    child.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (line.trim()) this.line(line);
      }
    });
    child.stderr.on('data', (d) => (this.err = (this.err + d).slice(-4000)));
    // A program that cannot start answers nothing: release what waits on it.
    child.on('error', (err) => {
      for (const c of this.calls.values()) c.reject(err);
      this.calls.clear();
      this.emit({ kind: 'error', text: String(err) });
    });
    child.on('close', (code) => {
      this.closed = true;
      this.onClose && this.onClose();
      for (const c of this.calls.values()) c.reject(new Error(`${this.agent.product} parou${this.err.trim() ? ': ' + tail(this.err, 2) : ` (código ${code})`}.`));
      this.calls.clear();
      for (const reqId of this.pending.keys()) this.emit({ kind: 'permission-closed', reqId });
      this.pending.clear();
      if (this.running) this.emit({ kind: 'error', text: `${this.agent.product} parou${this.err.trim() ? ': ' + tail(this.err, 2) : ` (código ${code})`}.` });
      this.running = false;
      this.emit({ kind: 'status', running: false });
    });
    try {
      await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'texugo', title: 'TeXugo', version: '1' } });
      const s = await this.request('session/new', { cwd: this.root, mcpServers: [] });
      this.sessionId = s.sessionId;
      this.setConfig(s.configOptions);
    } catch (err) {
      this.close();
      throw new Error(this.explain(err));
    }
  }

  // An error from the agent, in words the user can act on.
  explain(err) {
    const msg = String((err && err.message) || err);
    if ((err && err.code === -32000) || /auth|log ?in|credential|api key/i.test(msg)) return `${this.agent.product} não está logado. ${this.agent.login}`;
    return `${this.agent.product}: ${msg}`;
  }

  setConfig(list) {
    if (!Array.isArray(list)) return;
    this.config = list;
    const model = list.find((o) => o.category === 'model');
    const effort = list.find((o) => o.category === 'thought_level');
    this.emit({ kind: 'init', sessionId: this.sessionId, models: choices(model), efforts: choices(effort), model: model ? String(model.currentValue) : null, effort: effort ? String(effort.currentValue) : null });
  }

  // A different model or effort is a setting of the same conversation.
  matches() {
    return true;
  }
  get resumeId() {
    return null;
  }

  write(obj) {
    if (this.child && this.child.stdin.writable) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
  }

  request(method, params) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  line(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.id != null && !m.method) {
      const c = this.calls.get(m.id);
      if (!c) return;
      this.calls.delete(m.id);
      if (m.error) c.reject(Object.assign(new Error(String(m.error.message || 'erro')), { code: m.error.code }));
      else c.resolve(m.result || {});
    } else if (m.method === 'session/update') this.update((m.params && m.params.update) || {});
    else if (m.method === 'session/request_permission' && m.id != null) this.permission(m.id, m.params || {});
    else if (m.id != null) this.write({ id: m.id, error: { code: -32601, message: `TeXugo does not offer ${m.method}` } });
  }

  flush() {
    if (this.text.trim()) this.emit({ kind: 'text', text: this.text });
    this.text = '';
  }

  update(u) {
    const kind = u.sessionUpdate;
    if (kind === 'agent_message_chunk') {
      if (u.content && u.content.type === 'text') this.text += u.content.text || '';
      return;
    }
    if (kind === 'agent_thought_chunk' || kind === 'user_message_chunk' || kind === 'usage_update' || kind === 'available_commands_update') return;
    this.flush();
    if (kind === 'tool_call') {
      const t = { title: u.title, kind: u.kind || 'other', rawInput: u.rawInput, content: u.content || [], locations: u.locations || [] };
      this.tools.set(u.toolCallId, t);
      const file = t.locations[0] && t.locations[0].path;
      this.emit({ kind: 'tool', id: u.toolCallId, name: t.kind, label: String(u.title || t.kind), icon: ICON[t.kind] || 'info', input: file ? { path: file } : {} });
    } else if (kind === 'tool_call_update') {
      const t = this.tools.get(u.toolCallId) || {};
      for (const k of ['title', 'kind', 'rawInput', 'content', 'locations']) if (u[k] != null) t[k] = u[k];
      this.tools.set(u.toolCallId, t);
      if (u.status === 'failed') this.emit({ kind: 'tool-result', id: u.toolCallId, error: true, text: contentText(u.content).slice(0, 600) });
    } else if (kind === 'config_option_update') this.setConfig(u.configOptions);
    else if (kind === 'plan' && Array.isArray(u.entries) && u.entries.length) this.emit({ kind: 'mod-status', plugin: 'plan', text: u.entries.map((e) => `${e.status === 'completed' ? '✓' : e.status === 'in_progress' ? '▸' : '·'} ${e.content}`).join('\n').slice(0, 2000) });
  }

  // A tool that needs the user's yes, with the whole value: the diff of the
  // file, the command, or the raw input.
  permission(id, params) {
    this.flush();
    const call = params.toolCall || {};
    const known = this.tools.get(call.toolCallId) || {};
    const t = { ...known };
    for (const k of ['title', 'kind', 'rawInput', 'content', 'locations']) if (call[k] != null) t[k] = call[k];
    const reqId = randomUUID();
    const raw = t.rawInput && typeof t.rawInput === 'object' ? t.rawInput : t.rawInput != null ? { value: t.rawInput } : {};
    // ACP agents take no note with a refusal; the card does not offer one.
    const ev = { kind: 'permission', reqId, tool: String(t.title || t.kind || 'ferramenta'), input: raw, noteable: false };
    let diff = (t.content || []).find((c) => c && c.type === 'diff');
    // OpenCode's write tool sends a unified diff in its raw input instead.
    const file = raw.filepath || raw.filePath || raw.path;
    if (!diff && t.kind === 'edit' && typeof raw.diff === 'string' && typeof file === 'string') {
      const abs = path.resolve(this.root, file);
      let old = null;
      try {
        old = fs.readFileSync(abs, 'utf8');
      } catch {}
      const neu = applyUnified(old || '', raw.diff);
      if (neu != null) diff = { path: abs, oldText: old, newText: neu };
    }
    if (diff && diff.path) {
      const abs = path.resolve(this.root, diff.path);
      let old = diff.oldText;
      let exists = old != null;
      if (old == null) {
        try {
          old = fs.readFileSync(abs, 'utf8');
          exists = true;
        } catch {
          old = '';
        }
      }
      Object.assign(ev, { path: abs, isNew: !exists, oldText: old, newText: String(diff.newText || '') });
    } else if (t.kind === 'execute') {
      const cmd = raw.command ?? raw.cmd ?? raw.commandLine;
      Object.assign(ev, { tool: 'Bash', command: Array.isArray(cmd) ? cmd.join(' ') : String(cmd || t.title || ''), description: t.title && cmd ? String(t.title) : null });
    }
    this.pending.set(reqId, { id, options: params.options || [] });
    this.emit(ev);
  }

  answer(reqId, allow) {
    const p = this.pending.get(reqId);
    if (!p) return false;
    this.pending.delete(reqId);
    const want = allow ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
    const opt = want.map((k) => p.options.find((o) => o.kind === k)).find(Boolean);
    this.write({ id: p.id, result: { outcome: opt ? { outcome: 'selected', optionId: opt.optionId } : { outcome: 'cancelled' } } });
    return true;
  }

  async send(text, opts = {}) {
    if (!this.sessionId) throw new Error(`${this.agent.product} não abriu a conversa.`);
    await this.choose('model', opts.model);
    await this.choose('thought_level', opts.effort);
    if (this.agent.modeValue) await this.choose('mode', this.agent.modeValue(opts.mode));
    this.running = true;
    this.emit({ kind: 'status', running: true });
    const prompt = (this.first ? INTRO : '') + text;
    this.first = false;
    const t0 = Date.now();
    this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: prompt }] })
      .then((r) => {
        this.flush();
        const reason = r.stopReason;
        this.emit({ kind: 'result', ok: reason === 'end_turn' || reason === 'cancelled', text: reason === 'refusal' ? `${this.agent.product} recusou o pedido.` : reason === 'max_tokens' || reason === 'max_turn_requests' ? `${this.agent.product} parou no limite da resposta.` : null, ms: Date.now() - t0 });
      })
      .catch((err) => {
        this.flush();
        if (!this.closed) this.emit({ kind: 'error', text: this.explain(err) });
      })
      .finally(() => {
        if (this.closed) return;
        this.running = false;
        this.emit({ kind: 'status', running: false });
      });
    return { sessionId: this.sessionId };
  }

  // Sets a model or an effort the agent offers, when it is not the current one.
  async choose(category, value) {
    const opt = this.config.find((o) => o.category === category);
    if (!opt || value == null || value === '' || String(opt.currentValue) === value) return;
    if (!choices(opt).some((c) => c.id === value)) return;
    const r = await this.request('session/set_config_option', { sessionId: this.sessionId, configId: opt.id, value });
    if (r && Array.isArray(r.configOptions)) this.setConfig(r.configOptions);
  }

  interrupt() {
    if (!this.sessionId) return false;
    this.write({ method: 'session/cancel', params: { sessionId: this.sessionId } });
    // The protocol asks the client to answer every open request as cancelled.
    for (const [reqId, p] of this.pending) {
      this.write({ id: p.id, result: { outcome: { outcome: 'cancelled' } } });
      this.emit({ kind: 'permission-closed', reqId });
    }
    this.pending.clear();
    return true;
  }

  close() {
    this.running = false;
    try {
      killTree(this.child);
    } catch {}
  }
}

// The new text of a file from its old text and a one-file unified diff, or
// null when the diff does not apply.
export function applyUnified(old, diff) {
  const src = old === '' ? [] : old.split('\n');
  const out = [];
  let at = 0;
  let hunks = 0;
  const lines = diff.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
    if (!m) continue;
    hunks++;
    const start = Math.max(0, Number(m[1]) - (m[2] === '0' ? 0 : 1));
    if (start < at) return null;
    out.push(...src.slice(at, start));
    at = start;
    for (i++; i < lines.length && !lines[i].startsWith('@@'); i++) {
      const l = lines[i];
      if (l.startsWith('+')) out.push(l.slice(1));
      else if (l.startsWith('-') || l.startsWith(' ')) {
        if (src[at] !== l.slice(1)) return null;
        if (l.startsWith(' ')) out.push(src[at]);
        at++;
      } else if (l.startsWith('\\')) continue;
      else if (l === '' && i === lines.length - 1) continue;
      else return null;
    }
    i--;
  }
  if (!hunks) return null;
  out.push(...src.slice(at));
  // A new file ends with a newline unless the diff says it does not.
  if (old === '' && out.length && !/^\\ No newline/m.test(diff)) out.push('');
  return out.join('\n');
}

function contentText(list) {
  return (list || [])
    .map((c) => (c && c.type === 'content' && c.content && c.content.type === 'text' ? c.content.text : ''))
    .filter(Boolean)
    .join('\n');
}
