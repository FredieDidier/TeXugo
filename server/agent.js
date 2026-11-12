// Claude chat inside TeXugo: the user's own Claude Code, driven the way the
// Agent SDK drives it (claude -p with stream-json in and out), one long-lived
// process per project conversation.
//
// Reading, searching and loading skills run freely. Anything that would
// change something (an edit, a new file, a shell command, a web fetch) comes
// back to us as a can_use_tool control request; we show it in the panel
// (edits as a diff of the whole file) and answer allow or deny with what the
// user chose. Nothing is written without the user's yes.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { toolEnv, which, winSpawn } from './util.js';
import { claudeSourceFlags } from './trust.js';

// Model and effort picked in the panel (or Preferências). The CLI gets the
// full id; an older Claude Code that does not know it says so, and we explain.
// The one list of models: the page gets it from `hello`.
export const MODEL_LIST = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];
export const MODELS = MODEL_LIST.map((m) => m.id);
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_EFFORT = 'medium';
export function claudeFlags({ model, effort } = {}) {
  const m = /^[\w.-]+(\[1m\])?$/.test(model || '') ? model : DEFAULT_MODEL;
  const e = EFFORTS.includes(effort) ? effort : DEFAULT_EFFORT;
  return ['--model', m, '--effort', e];
}

const FREE = ['Read', 'Grep', 'Glob', 'LS', 'TodoWrite', 'Skill'];

const SYSTEM = `You are running inside TeXugo, a LaTeX editor for academic writing, as the assistant in its side panel.
The user writes papers, slides and syllabi in LaTeX, usually in Portuguese or English, and talks to you in Portuguese by default: answer in the user's language.
Every edit, new file or shell command you make is shown to the user as a diff or a command to approve before it happens; if they reject it, ask what they want instead.
Messages may start with a <texugo-context> block with the active file, the selection and the errors of the last LaTeX build: use it, do not repeat it back.
To compile, prefer telling the user to click Compile in TeXugo (it compiles linked documents together so \\externaldocument references resolve); run latexmk yourself only if asked.
If a writing skill is available (for example applied-micro-paper-writing), follow it when you write or revise prose.`;

export class Agents {
  constructor(broadcast) {
    this.broadcast = broadcast;
    this.sessions = new Map(); // root -> session
  }

  emit(root, ev) {
    this.broadcast({ type: 'agent:event', root, ...ev });
  }

  async start(root, opts = {}) {
    const claude = await which('claude');
    if (!claude) throw new Error('Claude Code não encontrado. Instale com: curl -fsSL https://claude.ai/install.sh | bash');
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--allowedTools', FREE.join(','), '--append-system-prompt', SYSTEM, ...claudeSourceFlags(root), ...claudeFlags(opts)];
    if (opts.resume) args.push('--resume', opts.resume);
    const [cmd, cargs, copts] = winSpawn(claude, args, toolEnv());
    const child = spawn(cmd, cargs, { cwd: root, env: toolEnv(), ...copts });
    const s = { root, child, buf: '', pending: new Map(), running: false, sessionId: opts.resume || null, err: '', flags: claudeFlags(opts).join(' ') };
    this.sessions.set(root, s);
    child.stdout.on('data', (d) => {
      s.buf += d;
      let i;
      while ((i = s.buf.indexOf('\n')) >= 0) {
        const line = s.buf.slice(0, i);
        s.buf = s.buf.slice(i + 1);
        if (line.trim()) this.line(s, line);
      }
    });
    child.stderr.on('data', (d) => (s.err = (s.err + d).slice(-4000)));
    child.on('close', (code) => {
      if (this.sessions.get(root) === s) this.sessions.delete(root);
      for (const p of s.pending.values()) this.emit(root, { kind: 'permission-closed', reqId: p.reqId });
      const msg = s.err.trim().split('\n').slice(-2).join(' ');
      if (s.running) this.emit(root, { kind: 'error', text: /log ?in|auth/i.test(msg) ? 'O Claude Code não está logado. Rode "claude" no Terminal (ou no terminal do TeXugo) e entre na sua conta.' : `O Claude Code parou${msg ? ': ' + msg : ` (código ${code})`}.` });
      this.emit(root, { kind: 'status', running: false });
    });
    child.on('error', (err) => this.emit(root, { kind: 'error', text: String(err) }));
    return s;
  }

  line(s, raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const root = s.root;
    if (m.type === 'system' && m.subtype === 'init') {
      s.sessionId = m.session_id;
      this.emit(root, { kind: 'init', model: m.model, sessionId: m.session_id });
    } else if (m.type === 'system' && (m.subtype === 'ui_log' || m.subtype === 'ui_status')) {
      // Lines from the user's Claude Code mods, such as jev-model-router
      // reporting the model and effort it picked for this message.
      this.emit(root, { kind: m.subtype === 'ui_log' ? 'mod-log' : 'mod-status', plugin: String(m.plugin || ''), text: m.text == null ? null : String(m.text).slice(0, 2000) });
    } else if (m.type === 'assistant') {
      for (const c of m.message.content || []) {
        if (c.type === 'text' && /does not support this model|requires? (?:Claude Code )?(?:version )?[\d.]+ or newer/i.test(c.text)) this.emit(root, { kind: 'error', text: `${c.text.trim()}\n\nSeu Claude Code está desatualizado para este modelo. Rode "claude update" no terminal (ou escolha outro modelo).` });
        else if (c.type === 'text' && c.text.trim()) this.emit(root, { kind: 'text', text: c.text });
        else if (c.type === 'tool_use') this.emit(root, { kind: 'tool', id: c.id, name: c.name, input: brief(c.input) });
      }
    } else if (m.type === 'user') {
      for (const c of (m.message && m.message.content) || []) {
        if (c.type === 'tool_result') this.emit(root, { kind: 'tool-result', id: c.tool_use_id, error: !!c.is_error, text: resultText(c.content).slice(0, 600) });
      }
    } else if (m.type === 'result') {
      s.running = false;
      this.emit(root, { kind: 'result', ok: m.subtype === 'success' && !m.is_error, text: m.is_error ? String(m.result || '') : null, ms: m.duration_ms, turns: m.num_turns });
      this.emit(root, { kind: 'status', running: false });
    } else if (m.type === 'control_request' && m.request && m.request.subtype === 'can_use_tool') {
      this.permission(s, m.request_id, m.request);
    }
  }

  // A tool that needs the user's yes. Edits are turned into the full old and
  // new file, so the panel can show exactly what changes.
  permission(s, requestId, req) {
    const reqId = randomUUID();
    const input = req.input || {};
    // The card shows every field whole (it scrolls), so a WebFetch URL or an
    // MCP tool's arguments are never approved half-read.
    const ev = { kind: 'permission', reqId, tool: req.tool_name, input: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(req.tool_name) ? brief(input) : input };
    const file = input.file_path || input.notebook_path;
    try {
      if (file && ['Edit', 'MultiEdit', 'Write'].includes(req.tool_name)) {
        const abs = path.resolve(s.root, file);
        const exists = fs.existsSync(abs);
        const old = exists ? fs.readFileSync(abs, 'utf8') : '';
        let neu = old;
        if (req.tool_name === 'Write') neu = input.content || '';
        else {
          const edits = req.tool_name === 'MultiEdit' ? input.edits || [] : [input];
          for (const e of edits) neu = e.replace_all ? neu.split(e.old_string).join(e.new_string) : neu.replace(e.old_string, () => e.new_string);
        }
        Object.assign(ev, { path: abs, isNew: !exists, oldText: old, newText: neu });
      } else if (req.tool_name === 'Bash') {
        Object.assign(ev, { command: input.command, description: input.description || null });
      }
    } catch {}
    s.pending.set(reqId, { reqId, requestId, input });
    this.emit(s.root, ev);
  }

  answer(root, reqId, allow, note) {
    const s = this.sessions.get(root);
    const p = s && s.pending.get(reqId);
    if (!p) return false;
    s.pending.delete(reqId);
    const response = allow
      ? { behavior: 'allow', updatedInput: p.input }
      : { behavior: 'deny', message: note ? `The user rejected this in TeXugo and said: ${note}` : 'The user rejected this in TeXugo. Ask what they want instead.' };
    this.write(s, { type: 'control_response', response: { subtype: 'success', request_id: p.requestId, response } });
    return true;
  }

  write(s, obj) {
    if (s.child.stdin.writable) s.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  async send(root, text, opts = {}) {
    let s = this.sessions.get(root);
    // A different model or effort needs a new process; --resume keeps the
    // conversation.
    if (s && !s.running && s.flags !== claudeFlags(opts).join(' ')) {
      const resume = s.sessionId;
      this.reset(root);
      s = null;
      opts = { ...opts, resume };
    }
    if (!s) s = await this.start(root, opts);
    s.running = true;
    this.emit(root, { kind: 'status', running: true });
    this.write(s, { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: s.sessionId || '' });
    return { sessionId: s.sessionId };
  }

  interrupt(root) {
    const s = this.sessions.get(root);
    if (!s) return false;
    this.write(s, { type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
    return true;
  }

  reset(root) {
    const s = this.sessions.get(root);
    if (s) {
      this.sessions.delete(root);
      s.running = false;
      try {
        s.child.kill('SIGTERM');
      } catch {}
    }
    return true;
  }

  killAll() {
    for (const root of [...this.sessions.keys()]) this.reset(root);
  }
}

// Tool inputs without large payloads (file contents travel separately).
function brief(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (['content', 'old_string', 'new_string', 'edits'].includes(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 400) : v;
  }
  return out;
}

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x.type === 'text' ? x.text : '')).join('\n');
  return '';
}
