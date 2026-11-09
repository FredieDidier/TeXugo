// Terminals in the project folder, on real pseudo-terminals (node-pty), so
// full-screen programs such as Claude Code work as in Terminal.app. Output
// goes to every window over the event WebSocket; keystrokes come back over
// it. Each terminal keeps its recent output, so a reloaded window gets its
// screen back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { toolEnv } from './util.js';

const require = createRequire(import.meta.url);
let pty = null;
function loadPty() {
  if (pty) return pty;
  pty = require('node-pty');
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

  create({ cwd, kind = 'shell', cols = 100, rows = 30, env = {}, title }) {
    const P = loadPty();
    const shell = process.env.SHELL || '/bin/zsh';
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    // A login shell reads the user's profile, so PATH, nvm and the like match
    // Terminal.app. Claude Code runs inside that shell: quitting it leaves a
    // usable prompt instead of a dead tab.
    const args = kind === 'claude' ? ['-l', '-i', '-c', 'claude; exec "$SHELL" -l'] : ['-l'];
    const p = P.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: dir,
      env: { ...toolEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'TeXugo', LANG: process.env.LANG || 'pt_BR.UTF-8', ...env },
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
