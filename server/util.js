// Shared helpers: process spawning with a usable PATH, path safety, hashing.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Apps launched from Finder do not inherit the login shell PATH, so TeX Live
// and Homebrew binaries would be invisible. Add the usual locations explicitly.
const EXTRA_PATHS = [
  '/Library/TeX/texbin',
  '/usr/local/texlive/2026/bin/universal-darwin',
  '/usr/local/texlive/2025/bin/universal-darwin',
  '/usr/local/texlive/2024/bin/universal-darwin',
  '/opt/homebrew/bin',
  // Claude Code's native installer.
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.claude', 'local'),
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

export function toolEnv(extra = {}) {
  const parts = (process.env.PATH || '').split(':').filter(Boolean);
  for (const p of EXTRA_PATHS) if (!parts.includes(p)) parts.push(p);
  return {
    ...process.env,
    PATH: parts.join(':'),
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
      child = spawn(cmd, args, { cwd, env: env || toolEnv() });
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

let whichCache = new Map();
export async function which(bin) {
  if (whichCache.has(bin)) return whichCache.get(bin);
  const r = await run('/usr/bin/which', [bin], { timeout: 5000 });
  const found = r.code === 0 ? r.stdout.trim() : null;
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
  const dir = process.env.TEXUGO_DATA_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'TeXugo');
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
