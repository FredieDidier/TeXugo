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
let EXTRA_PATHS = extraPaths();

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

// A fetch() that never reached a server: no network, DNS down, host
// unreachable or refusing. Node puts the system error code on err.cause
// (or on each attempt of an AggregateError when it tried several addresses).
const OFFLINE = /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EHOSTDOWN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/;
export function isOffline(err) {
  for (let e = err, i = 0; e && i < 5; e = e.cause, i++) {
    if (OFFLINE.test(e.code || '')) return true;
    if (Array.isArray(e.errors) && e.errors.some((x) => x && OFFLINE.test(x.code || ''))) return true;
  }
  return false;
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
    // Decode as a stream: a chunk may end in the middle of an accented
    // letter, and decoding each chunk alone would break it.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
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
// After the user installs TeX (or anything else) with the app open: forget
// what was missing and look for the TeX Live year folder again.
export function refreshTools() {
  whichCache = new Map();
  EXTRA_PATHS = extraPaths();
}
export async function which(bin) {
  if (whichCache.has(bin)) return whichCache.get(bin);
  const found = findOnPath(bin);
  whichCache.set(bin, found);
  return found;
}

// MiKTeX's latexmk, latexdiff and latexindent are Perl scripts behind an
// .exe wrapper, and MiKTeX does not bring Perl (TeX Live for Windows does).
// Without it they die with a message nobody understands, so say it first.
export function perlProblemFor({ tool, toolPath, perlPath, platform = process.platform }) {
  if (platform !== 'win32' || !toolPath || perlPath || !/miktex/i.test(toolPath)) return null;
  return `O ${tool} do MiKTeX precisa de Perl, que o MiKTeX não traz. Instale o Strawberry Perl (https://strawberryperl.com) e clique em Verificar de novo, ou use o TeX Live, que já vem com Perl.`;
}
export async function perlProblem(tool) {
  if (!IS_WIN) return null;
  return perlProblemFor({ tool, toolPath: await which(tool), perlPath: await which('perl') });
}

// Where a path really points: symbolic links resolved, for a path that does
// not exist yet through its nearest existing folder.
export function realPath(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}

// A symbolic link inside a project may point outside it: a shared .bib in
// ~/Dropbox is common and stays allowed. What it may not reach is outside
// the home folder or a hidden folder of it (~/.ssh, ~/.aws, ~/.config):
// a cloned repository can carry such a link.
export function linkTargetOk(roots, p) {
  const real = realPath(p);
  if (roots.some((r) => isInside(realPath(r), real))) return true;
  const home = os.homedir();
  if (!isInside(home, real)) return false;
  return !path.relative(home, real).split(path.sep).some((seg) => seg.startsWith('.'));
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
