// Agents other than Claude Code. In the panel each one speaks ACP
// (./acp.js); the actions on the text run the agent's own non-interactive
// mode, always read-only. The acceptance test of each read-only mode is in
// test/agents-live.test.js: asked to create a file, the agent must not.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { which } from '../util.js';
import { AcpSession } from './acp.js';
import { spawnTool, tail, versionOf } from './proc.js';
import { MODES, modeOf } from './modes.js';

// Model and effort ids go on a command line (through cmd.exe on Windows):
// only plain ids pass.
export const safeId = (v) => (typeof v === 'string' && /^[\w.:/@-]{1,100}$/.test(v) ? v : null);

const acpSession = (agent) =>
  class extends AcpSession {
    constructor(root, opts, emit) {
      super(root, opts, emit, agent);
    }
  };

// OpenCode decides by its permission rules; TeXugo passes its own, which
// win over the project's and the user's (OPENCODE_CONFIG_CONTENT is read
// last). Panel: reading inside the project is free, everything else asks.
// One-shot: only the reading tools exist.
// The tools that change something are named one by one, so a project's
// opencode.json that allows one of them is overridden key by key.
const CHANGING = ['edit', 'bash', 'webfetch', 'websearch', 'task', 'external_directory'];
const READING = { read: 'allow', grep: 'allow', glob: 'allow', list: 'allow', skill: 'allow' };
const OPENCODE_PANEL = { permission: { '*': 'ask', ...Object.fromEntries(CHANGING.map((k) => [k, 'ask'])), ...READING, todowrite: 'allow', todoread: 'allow' } };
const OPENCODE_READ_ONLY = { permission: { '*': 'deny', ...Object.fromEntries(CHANGING.map((k) => [k, 'deny'])), ...READING } };
// OpenCode reads the user's Claude Code skills from ~/.claude/skills and
// sends them to its model; their descriptions name the user's projects.
// TeXugo starts it without them, in the panel, the one-shot and the terminal.
const NO_CLAUDE_SKILLS = { OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1' };

export const opencode = {
  id: 'opencode',
  name: 'OpenCode',
  product: 'OpenCode',
  install: 'npm install -g opencode-ai',
  site: 'https://opencode.ai',
  login: 'Rode "opencode auth login" no terminal e escolha um provedor.',
  acp: { bin: 'opencode', args: ['acp'], env: { ...NO_CLAUDE_SKILLS, OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_PANEL) } },
  readOnlyEnv: { ...NO_CLAUDE_SKILLS, OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_READ_ONLY) },
  tui: ({ model }) => ['opencode', ...(safeId(model) ? ['-m', model] : [])],
  tuiEnv: NO_CLAUDE_SKILLS,
  async detect() {
    const bin = await which('opencode');
    return { installed: !!bin, panel: !!bin, oneShot: !!bin, version: bin ? await versionOf(bin) : null };
  },
  get Session() {
    return acpSession(this);
  },
  async oneShot(prompt, opts) {
    const bin = await which('opencode');
    if (!bin) throw new Error(`OpenCode não encontrado. Instale com: ${this.install}`);
    const args = ['run', '--format', 'json'];
    if (safeId(opts.model)) args.push('-m', opts.model);
    if (safeId(opts.effort)) args.push('--variant', opts.effort);
    const out = await spawnTool(bin, args, prompt, { ...opts, env: this.readOnlyEnv });
    let text = '';
    let error = '';
    for (const line of out.stdout.split('\n')) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type === 'text' && e.part && typeof e.part.text === 'string') text += (text ? '\n' : '') + e.part.text;
      else if (e.type === 'error') error = String((e.error && (e.error.message || (e.error.data && e.error.data.message))) || JSON.stringify(e.error || e)).slice(0, 300);
    }
    if (!text) throw new Error(/auth|log ?in|credential|api key/i.test(error + out.stderr) ? `O OpenCode não está logado. ${this.login}` : `O OpenCode falhou: ${error || tail(out.stderr) || `código ${out.code}`}`);
    return text;
  },
};

// Gemini CLI: `gemini --acp` with its default approval mode (asks before
// edits and commands); `--approval-mode plan` is its read-only mode.
export const gemini = {
  id: 'gemini',
  name: 'Gemini',
  product: 'Gemini CLI',
  install: 'npm install -g @google/gemini-cli',
  site: 'https://geminicli.com',
  login: 'Rode "gemini" no terminal e entre com a sua conta Google.',
  acp: { bin: 'gemini', args: ['--acp', '--approval-mode', 'default'] },
  tui: ({ model }) => ['gemini', ...(safeId(model) ? ['-m', model] : [])],
  async detect() {
    const bin = await which('gemini');
    return { installed: !!bin, panel: !!bin, oneShot: !!bin, version: bin ? await versionOf(bin) : null };
  },
  get Session() {
    return acpSession(this);
  },
  async oneShot(prompt, opts) {
    const bin = await which('gemini');
    if (!bin) throw new Error(`Gemini CLI não encontrado. Instale com: ${this.install}`);
    // The prompt goes on stdin; -p is appended to it and makes the run headless.
    const args = ['--approval-mode', 'plan', '--output-format', 'json'];
    if (safeId(opts.model)) args.push('-m', opts.model);
    args.push('-p', 'Follow the instructions above.');
    const out = await spawnTool(bin, args, prompt, opts);
    let data;
    try {
      data = JSON.parse(out.stdout.slice(out.stdout.indexOf('{')));
    } catch {
      const msg = tail(out.stderr || out.stdout);
      throw new Error(/auth|log ?in|credential|api key/i.test(msg) ? `O Gemini CLI não está logado. ${this.login}` : `O Gemini CLI falhou: ${msg || `código ${out.code}`}`);
    }
    if (data.error) throw new Error(`O Gemini CLI respondeu com erro: ${String(data.error.message || JSON.stringify(data.error)).slice(0, 300)}`);
    return String(data.response || '');
  },
};

// Codex: the panel through codex-acp, started in the session mode that
// matches the panel's permission mode (./modes.js). The default is its
// read-only mode: asks before editing files or using the network, and
// commands run in a sandbox that cannot write. The one-shot is
// `codex exec --sandbox read-only`.
const CODEX_MODE = { ask: 'read-only', edits: 'workspace-write', auto: 'agent', full: 'agent-full-access' };
export const codex = {
  id: 'codex',
  name: 'Codex',
  product: 'Codex',
  install: 'npm install -g @openai/codex @agentclientprotocol/codex-acp',
  site: 'https://developers.openai.com/codex',
  login: 'Rode "codex login" no terminal e entre na sua conta.',
  acp: { bin: 'codex-acp', args: [] },
  modes: MODES,
  modeValue: (m) => CODEX_MODE[modeOf(m)],
  modeEnv(m) {
    return { INITIAL_AGENT_MODE: this.modeValue(m) };
  },
  tui: ({ model, effort }) => ['codex', ...(safeId(model) ? ['-m', model] : []), ...(safeId(effort) ? ['-c', `model_reasoning_effort=${effort}`] : [])],
  async detect() {
    const [acp, bin] = await Promise.all([which('codex-acp'), which('codex')]);
    return { installed: !!(acp || bin), panel: !!acp, oneShot: !!bin, version: bin ? await versionOf(bin) : acp ? await versionOf(acp) : null };
  },
  get Session() {
    return acpSession(this);
  },
  async oneShot(prompt, opts) {
    const bin = await which('codex');
    if (!bin) throw new Error(`Codex não encontrado. Instale com: ${this.install}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-codex-'));
    const last = path.join(dir, 'answer.txt');
    try {
      const args = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '-o', last];
      if (safeId(opts.model)) args.push('-m', opts.model);
      if (safeId(opts.effort)) args.push('-c', `model_reasoning_effort=${opts.effort}`);
      args.push('-');
      const out = await spawnTool(bin, args, prompt, opts);
      let text = '';
      try {
        text = fs.readFileSync(last, 'utf8');
      } catch {}
      if (!text.trim()) {
        const msg = tail(out.stderr || out.stdout);
        throw new Error(/auth|log ?in|credential|api key/i.test(msg) ? `O Codex não está logado. ${this.login}` : `O Codex falhou: ${msg || `código ${out.code}`}`);
      }
      return text;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
};
