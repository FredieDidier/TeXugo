// Claude Code as a TeXugo agent: the user's own `claude`, driven the way the
// Agent SDK drives it (claude -p with stream-json in and out), one
// long-lived process per project conversation.
//
// Reading, searching and loading skills run freely. Anything that would
// change something (an edit, a new file, a shell command, a web fetch) comes
// back as a can_use_tool control request; the panel shows it (edits as a
// diff of the whole file) and we answer allow or deny with what the user
// chose. In the default mode nothing is written without the user's yes; the
// other permission modes (./modes.js) let Claude Code skip some of the asking
// or all of it.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { claudeSourceFlags } from '../trust.js';
import { killTree } from '../platform.js';
import { spawnLong, spawnTool, versionOf } from './proc.js';
import { which } from '../util.js';
import { MODES, modeOf } from './modes.js';

// Model and effort picked in the panel (or Preferências). The CLI gets the
// full id; an older Claude Code that does not know it says so, and we explain.
// The one list of Claude models: the page gets it from `hello` and `agentList`.
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

// The panel's permission modes as Claude Code's --permission-mode.
const PERMISSION_MODE = { edits: 'acceptEdits', auto: 'auto', full: 'bypassPermissions' };
const modeFlags = (opts = {}) => {
  const m = PERMISSION_MODE[modeOf(opts.mode)];
  return m ? ['--permission-mode', m] : [];
};

const FREE = ['Read', 'Grep', 'Glob', 'LS', 'TodoWrite', 'Skill'];
const SKILL_READ = '--allowedTools=Read(~/.claude/skills/**)';
const NOT_FOUND = 'Claude Code não encontrado. Instale com: curl -fsSL https://claude.ai/install.sh | bash';
const AUTH = /authenticat|log ?in|credential/i;
const NOT_LOGGED = 'O Claude Code não está logado. Rode "claude" no Terminal (ou no terminal do TeXugo) e entre na sua conta.';

export const SYSTEM = `You are running inside TeXugo, a LaTeX editor for academic writing, as the assistant in its side panel.
The user writes papers, slides and syllabi in LaTeX, usually in Portuguese or English, and talks to you in Portuguese by default: answer in the user's language.
Your edits, new files and shell commands are shown to the user in the panel; depending on the permission mode the user picked, they wait for the user's approval first. If the user rejects one, ask what they want instead.
Messages may start with a <texugo-context> block with the active file, the selection and the errors of the last LaTeX build: use it, do not repeat it back.
To compile, prefer telling the user to click Compile in TeXugo (it compiles linked documents together so \\externaldocument references resolve); run latexmk yourself only if asked.
If a writing skill is available (for example applied-micro-paper-writing), follow it when you write or revise prose.`;

export class ClaudeSession {
  constructor(root, opts, emit) {
    this.root = root;
    this.emit = emit;
    this.pending = new Map();
    this.running = false;
    this.sessionId = opts.resume || null;
    this.err = '';
    this.buf = '';
    this.flags = [...claudeFlags(opts), ...modeFlags(opts)].join(' ');
    this.opts = opts;
  }

  args() {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--allowedTools', FREE.join(','), '--append-system-prompt', SYSTEM, ...claudeSourceFlags(this.root), ...claudeFlags(this.opts), ...modeFlags(this.opts)];
    if (this.opts.resume) args.push('--resume', this.opts.resume);
    return args;
  }

  async start() {
    const bin = await which('claude');
    if (!bin) throw new Error(NOT_FOUND);
    const child = (this.child = spawnLong(bin, this.args(), this.root));
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
    child.on('close', (code) => {
      this.closed = true;
      this.onClose && this.onClose();
      for (const p of this.pending.values()) this.emit({ kind: 'permission-closed', reqId: p.reqId });
      const msg = this.err.trim().split('\n').slice(-2).join(' ');
      if (this.running) this.emit({ kind: 'error', text: /log ?in|auth/i.test(msg) ? NOT_LOGGED : `O Claude Code parou${msg ? ': ' + msg : ` (código ${code})`}.` });
      this.emit({ kind: 'status', running: false });
    });
    child.on('error', (err) => this.emit({ kind: 'error', text: String(err) }));
  }

  // The same process serves another message only with the same model,
  // effort and permission mode; otherwise the hub starts a new one that
  // resumes this one.
  matches(opts) {
    return this.running || this.flags === [...claudeFlags(opts), ...modeFlags(opts)].join(' ');
  }
  get resumeId() {
    return this.sessionId;
  }

  line(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === 'system' && m.subtype === 'init') {
      this.sessionId = m.session_id;
      this.emit({ kind: 'init', model: m.model, sessionId: m.session_id });
    } else if (m.type === 'system' && (m.subtype === 'ui_log' || m.subtype === 'ui_status')) {
      // Lines from the user's Claude Code mods, such as jev-model-router
      // reporting the model and effort it picked for this message.
      this.emit({ kind: m.subtype === 'ui_log' ? 'mod-log' : 'mod-status', plugin: String(m.plugin || ''), text: m.text == null ? null : String(m.text).slice(0, 2000) });
    } else if (m.type === 'assistant') {
      // Claude Code's own notices come as assistant messages of the model
      // "<synthetic>"; an expired login is one of them, and gets the notice
      // in the user's language instead of passing as a reply from Claude.
      const own = m.message.model === '<synthetic>';
      for (const c of m.message.content || []) {
        if (own && c.type === 'text' && AUTH.test(c.text)) this.emit({ kind: 'error', text: NOT_LOGGED });
        else if (c.type === 'text' && /does not support this model|requires? (?:Claude Code )?(?:version )?[\d.]+ or newer/i.test(c.text)) this.emit({ kind: 'error', text: `${c.text.trim()}\n\nSeu Claude Code está desatualizado para este modelo. Rode "claude update" no terminal (ou escolha outro modelo).` });
        else if (c.type === 'text' && c.text.trim()) this.emit({ kind: 'text', text: c.text });
        else if (c.type === 'tool_use') this.emit({ kind: 'tool', id: c.id, name: c.name, input: brief(c.input) });
      }
    } else if (m.type === 'user') {
      for (const c of (m.message && m.message.content) || []) {
        if (c.type === 'tool_result') this.emit({ kind: 'tool-result', id: c.tool_use_id, error: !!c.is_error, text: resultText(c.content).slice(0, 600) });
      }
    } else if (m.type === 'result') {
      this.running = false;
      this.emit({ kind: 'result', ok: m.subtype === 'success' && !m.is_error, text: m.is_error ? (AUTH.test(String(m.result || '')) ? NOT_LOGGED : String(m.result || '')) : null, ms: m.duration_ms, turns: m.num_turns });
      this.emit({ kind: 'status', running: false });
    } else if (m.type === 'control_request' && m.request && m.request.subtype === 'can_use_tool') {
      this.permission(m.request_id, m.request);
    }
  }

  // A tool that needs the user's yes. Edits are turned into the full old and
  // new file, so the panel can show exactly what changes.
  permission(requestId, req) {
    const reqId = randomUUID();
    const input = req.input || {};
    // The card shows every field whole (it scrolls), so a WebFetch URL or an
    // MCP tool's arguments are never approved half-read.
    const ev = { kind: 'permission', reqId, tool: req.tool_name, input: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(req.tool_name) ? brief(input) : input };
    const file = input.file_path || input.notebook_path;
    try {
      if (file && ['Edit', 'MultiEdit', 'Write'].includes(req.tool_name)) {
        const abs = path.resolve(this.root, file);
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
    this.pending.set(reqId, { reqId, requestId, input });
    this.emit(ev);
  }

  answer(reqId, allow, note) {
    const p = this.pending.get(reqId);
    if (!p) return false;
    this.pending.delete(reqId);
    const response = allow
      ? { behavior: 'allow', updatedInput: p.input }
      : { behavior: 'deny', message: note ? `The user rejected this in TeXugo and said: ${note}` : 'The user rejected this in TeXugo. Ask what they want instead.' };
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: p.requestId, response } });
    return true;
  }

  write(obj) {
    if (this.child && this.child.stdin.writable) this.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  async send(text) {
    this.running = true;
    this.emit({ kind: 'status', running: true });
    this.write({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: this.sessionId || '' });
    return { sessionId: this.sessionId };
  }

  interrupt() {
    this.write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
    return true;
  }

  close() {
    this.running = false;
    try {
      killTree(this.child);
    } catch {}
  }
}
export const claude = {
  id: 'claude',
  name: 'Claude',
  product: 'Claude Code',
  install: 'curl -fsSL https://claude.ai/install.sh | bash',
  site: 'https://claude.com/claude-code',
  modes: MODES,
  async detect() {
    const bin = await which('claude');
    return { installed: !!bin, panel: !!bin, oneShot: !!bin, version: bin ? await versionOf(bin) : null, models: MODEL_LIST, efforts: EFFORTS, defaultModel: DEFAULT_MODEL, defaultEffort: DEFAULT_EFFORT };
  },
  get Session() {
    return ClaudeSession;
  },
  // One headless run, read-only tools: the selection actions, the referee
  // review and the response to referees. Reads outside the project are
  // refused in a headless run, so the user's own skills folder is allowed
  // by name: a skill's SKILL.md points to reference files next to it.
  async oneShot(prompt, opts) {
    const bin = await which('claude');
    if (!bin) throw new Error('Claude Code não encontrado. Instale com: curl -fsSL https://claude.ai/install.sh | bash (e entre na sua conta com "claude" no Terminal).');
    const out = await spawnTool(bin, ['-p', '--output-format', 'json', '--tools', opts.tools || 'Skill,Read', SKILL_READ, '--no-session-persistence', ...claudeSourceFlags(opts.root), ...claudeFlags(opts)], prompt, opts);
    const notLogged = 'O Claude Code não está logado. Abra o Terminal, rode "claude" e entre na sua conta.';
    let data;
    try {
      data = JSON.parse(out.stdout);
    } catch {
      const msg = (out.stderr || out.stdout || '').trim().split('\n').slice(-3).join(' ');
      throw new Error(/log ?in|auth|credential/i.test(msg) ? notLogged : 'O Claude Code falhou: ' + (msg || `código ${out.code}`));
    }
    // An expired login also comes this way: a JSON result marked as an error.
    if (data.is_error) {
      const msg = String(data.result || '');
      throw new Error(/authenticat|log ?in|credential/i.test(msg) ? notLogged : 'O Claude Code respondeu com erro: ' + msg.slice(0, 300));
    }
    return String(data.result || '');
  },
};

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
