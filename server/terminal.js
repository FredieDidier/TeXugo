// Terminals in the project folder, on real pseudo-terminals (node-pty), so
// full-screen programs such as Claude Code work as in Terminal.app. Output
// goes to every window over the event WebSocket; keystrokes come back over
// it. Each terminal keeps its recent output, so a reloaded window gets its
// screen back.
import { execFileSync } from 'node:child_process';
import { serverLang, L } from './lang.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { toolEnv } from './util.js';
import { userShell, IS_WIN } from './platform.js';

const require = createRequire(import.meta.url);
let pty = null;
function loadPty() {
  if (pty) return pty;
  try {
    pty = require('node-pty');
  } catch (err) {
    // node-pty is a native module: prebuilt for macOS and Windows, compiled
    // at install on Linux. A build that did not compile it still runs; only
    // the terminal is missing, and it says why.
    throw new Error(L(
      'O terminal não está disponível nesta instalação (o módulo node-pty não carregou). O resto do TeXugo funciona; use o terminal do sistema. Detalhe: ',
      'The terminal is not available in this installation (the node-pty module did not load). The rest of TeXugo works; use the system terminal. Detail: ',
    ) + String(err.message).split('\n')[0]);
  }
  // npm may install node-pty without running its scripts, which leaves the
  // helper it spawns through without the execute bit.
  try {
    const dir = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds', `${process.platform}-${process.arch}`);
    const helper = path.join(dir, 'spawn-helper');
    if (fs.existsSync(helper) && !(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755);
  } catch {}
  return pty;
}

const KEEP = 400 * 1024; // characters of output kept per terminal

export class Terminals {
  constructor(broadcast) {
    this.broadcast = broadcast;
    this.items = new Map(); // id -> { id, p, title, cwd, kind, buf, exited }
    this.seq = 0;
  }

  create({ cwd, kind = 'shell', cols = 100, rows = 30, env = {}, title, claudeArgs = [], command = [] }) {
    const P = loadPty();
    const { shell, login } = userShell();
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    // A login shell reads the user's profile, so PATH, nvm and the like match
    // Terminal.app. Claude Code runs inside that shell: quitting it leaves a
    // usable prompt instead of a dead tab.
    // claudeArgs are fixed flags (--model id --effort level), checked by
    // claudeFlags; another agent's command is its program and plain ids
    // (server/agents/others.js). Quoting each word is enough.
    const prog = kind === 'claude' ? ['claude', ...claudeArgs] : kind === 'agent' ? command : null;
    const flags = prog && prog.map((a) => `'${String(a).replace(/'/g, '')}'`).join(' ');
    // Windows: cmd.exe /k keeps the prompt after the agent quits.
    const args = IS_WIN ? (prog ? ['/k', prog.map((a) => String(a).replace(/[^\w.=:/@-]/g, '')).join(' ')] : []) : prog ? ['-l', '-i', '-c', `${flags}; exec "$SHELL" -l`] : login;
    const p = P.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: dir,
      env: { ...toolEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'TeXugo', LANG: process.env.LANG || termLang(), ...env },
    });
    const id = `t${++this.seq}`;
    const t = { id, p, kind, cwd: dir, title: title || (kind === 'claude' ? 'Claude Code' : path.basename(shell)), buf: '', exited: null };
    this.items.set(id, t);
    p.onData((data) => {
      t.buf = (t.buf + data).slice(-KEEP);
      this.broadcast({ type: 'term:data', id, data });
    });
    p.onExit(({ exitCode }) => {
      t.exited = exitCode;
      this.broadcast({ type: 'term:exit', id, code: exitCode });
    });
    this.broadcast({ type: 'term:list', items: this.list() });
    return this.info(t);
  }

  info(t) {
    return { id: t.id, kind: t.kind, title: t.title, cwd: t.cwd, exited: t.exited };
  }

  list() {
    return [...this.items.values()].map((t) => this.info(t));
  }

  // Screen contents so far, for a window that (re)attaches.
  snapshot(id) {
    const t = this.items.get(id);
    return t ? { ...this.info(t), buf: t.buf } : null;
  }

  write(id, data) {
    const t = this.items.get(id);
    if (t && t.exited == null) t.p.write(data);
  }

  resize(id, cols, rows) {
    const t = this.items.get(id);
    if (t && t.exited == null && cols > 1 && rows > 1) {
      try {
        t.p.resize(Math.floor(cols), Math.floor(rows));
      } catch {}
    }
  }

  kill(id) {
    const t = this.items.get(id);
    if (!t) return;
    try {
      t.p.kill();
    } catch {}
    this.items.delete(id);
    this.broadcast({ type: 'term:list', items: this.list() });
  }

  killAll() {
    for (const id of [...this.items.keys()]) this.kill(id);
  }
}

// Apps started from the Dock get no LANG. Without one, Git and the shell
// fall back to ASCII; pick UTF-8 in the UI language, falling back to
// en_US.UTF-8 (present everywhere) when pt_BR is not installed.
function termLang() {
  if (serverLang() !== 'pt') return 'en_US.UTF-8';
  if (process.platform === 'darwin') return 'pt_BR.UTF-8';
  try {
    const out = execFileSync('locale', ['-a'], { encoding: 'utf8', timeout: 2000 });
    return /^pt_BR\.utf-?8$/im.test(out) ? 'pt_BR.UTF-8' : 'en_US.UTF-8';
  } catch {
    return 'en_US.UTF-8';
  }
}
