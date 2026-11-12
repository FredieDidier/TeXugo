// Shared helpers: process spawning with a usable PATH, path safety, hashing.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extraPaths, appDataDir, IS_WIN } from './platform.js';

// Apps launched from Finder (or the Start menu, or a desktop launcher) do
// not inherit the login shell PATH, so TeX and other tools would be
// invisible. platform.js lists the usual places on each system.
const EXTRA_PATHS = extraPaths();

// Variables a parent Claude Code session (or the desktop app that launched
// TeXugo from one) leaves in the environment. Passed on, they make the
// user's own claude believe it is nested, point it at another login server
// or proxy, and ask the user to sign in again.
const INHERITED = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|ANTHROPIC_BASE_URL|USE_STAGING_OAUTH|USE_LOCAL_OAUTH)$/;

export function cleanEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!INHERITED.test(k)) out[k] = v;
  return out;
}

export function toolEnv(extra = {}) {
  const env = cleanEnv();
  // Windows spells it Path; keep the one key it already has.
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const parts = (env[key] || '').split(path.delimiter).filter(Boolean);
  for (const p of EXTRA_PATHS) if (!parts.includes(p)) parts.push(p);
  return {
    ...env,
    [key]: parts.join(path.delimiter),
    // Keep TeX from wrapping log lines at 79 characters; the log parser
    // relies on file paths and messages staying on one line.
    max_print_line: '10000',
    error_line: '254',
    half_error_line: '238',
    ...extra,
  };
}

// Runs a command and resolves with { code, stdout, stderr }. Never rejects on a
// non-zero exit; callers decide what failure means.
export function run(cmd, args, { cwd, input, timeout = 60000, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      const e = env || toolEnv();
      const [c, a, o] = winSpawn(cmd, args, e);
      child = spawn(c, a, { cwd, env: e, ...o });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = timeout ? setTimeout(() => child.kill('SIGKILL'), timeout) : null;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input != null) child.stdin.end(input);
  });
}

// Where a command lives on the PATH (with Windows' .exe/.cmd/.bat), or null.
export function findOnPath(bin, env = toolEnv()) {
  if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const exts = IS_WIN ? ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';')] : [''];
  for (const dir of (env[key] || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const f = path.join(dir, bin + ext);
      try {
        if (fs.statSync(f).isFile() && (IS_WIN ? ext || /\.(exe|com|bat|cmd)$/i.test(f) : true)) return f;
      } catch {}
    }
  }
  return null;
}

// On Windows, spawn finds .exe files by itself but not npm's .cmd shims
// (claude, latexindent from some installs) and Node refuses .bat/.cmd
// without a shell: run those through cmd.exe with each argument quoted.
export function winSpawn(cmd, args, env) {
  if (!IS_WIN) return [cmd, args, {}];
  const full = findOnPath(cmd, env) || cmd;
  if (!/\.(bat|cmd)$/i.test(full)) return [full, args, {}];
  const q = (x) => '"' + String(x).replace(/"/g, '""') + '"';
  return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + [full, ...args].map(q).join(' ') + '"'], { windowsVerbatimArguments: true }];
}

let whichCache = new Map();
export async function which(bin) {
  if (whichCache.has(bin)) return whichCache.get(bin);
  const found = findOnPath(bin);
  whichCache.set(bin, found);
  return found;
}

// True when `child` is `parent` or lies inside it (after resolving ..).
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function sha1(text) {
  return createHash('sha1').update(text).digest('hex');
}

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function dataDir() {
  const dir = process.env.TEXUGO_DATA_DIR || appDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Removes LaTeX comments from a line, keeping escaped \%.
export function stripComment(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '%') {
      let bs = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) bs++;
      if (bs % 2 === 0) return line.slice(0, i);
    }
  }
  return line;
}

export function stripComments(text) {
  return text.split('\n').map(stripComment).join('\n');
}

// Atomic save that keeps what the user set up: when the path is a symbolic
// link (a shared .bib), write the real file, next to it, and keep the link;
// keep the file's mode (a 755 script stays executable).
export function writeKeepingLink(p, text) {
  let real = p;
  let mode = null;
  try {
    real = fs.realpathSync(p);
    mode = fs.statSync(real).mode & 0o7777;
  } catch {}
  const tmp = real + '.texugo-tmp';
  fs.writeFileSync(tmp, text);
  if (mode !== null) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, real);
  return real;
}
