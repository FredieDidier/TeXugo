// Starting agent programs: a long-lived one for the panel, a one-shot run for
// the actions on the text. The one-shot runs are one at a time per project
// (the 30-minute response to referees in one paper does not block a quick
// revision in another window), and Cancelar stops only the window's project.
import { spawn, execFile } from 'node:child_process';
import { toolEnv, winSpawn } from '../util.js';
import { killTree } from '../platform.js';

const current = new Map(); // project root -> child of the running one-shot

export function cancelOneShot(root) {
  let any = false;
  for (const [r, child] of current) {
    if (root && r !== root) continue;
    try {
      killTree(child);
    } catch {}
    current.delete(r);
    any = true;
  }
  return any;
}

// PWD goes with the folder: OpenCode takes its project from PWD, not from
// the folder it was started in, and TeXugo's own PWD is wherever the app
// was launched.
// A process that lives as long as the panel's conversation.
export function spawnLong(bin, args, cwd, env = {}) {
  const full = toolEnv({ ...env, PWD: cwd });
  const [cmd, cargs, copts] = winSpawn(bin, args, full);
  return spawn(cmd, cargs, { cwd, env: full, ...copts });
}

// One run that reads the prompt on stdin and ends. Resolves with what it
// printed; throws when another run holds the project or when it was
// cancelled (or ran out of time) before printing anything.
export async function spawnTool(bin, args, input, { root = '', timeout = 300000, env = {} } = {}) {
  if (current.has(root)) throw new Error('Já há uma ação de IA em andamento neste projeto.');
  const full = toolEnv(root ? { ...env, PWD: root } : env);
  const out = await new Promise((resolve) => {
    const [cmd, cargs, copts] = winSpawn(bin, args, full);
    const child = spawn(cmd, cargs, { cwd: root || undefined, env: full, ...copts });
    current.set(root, child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => killTree(child), timeout);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (current.get(root) === child) current.delete(root);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
  if (out.signal === 'SIGTERM' && !out.stdout) throw new Error('Cancelado (ou passou do tempo).');
  return out;
}

// "name 1.2.3" from `bin --version`, or null.
export function versionOf(bin, args = ['--version']) {
  return new Promise((resolve) => {
    const full = toolEnv();
    const [cmd, cargs, copts] = winSpawn(bin, args, full);
    execFile(cmd, cargs, { env: full, timeout: 8000, windowsHide: true, ...copts }, (err, stdout) => {
      const line = String(stdout || '').trim().split('\n')[0] || '';
      resolve(err && !line ? null : line.slice(0, 80) || null);
    });
  });
}

// The last lines a program printed on error, for a message.
export function tail(text, n = 3) {
  return String(text || '').trim().split('\n').slice(-n).join(' ').slice(0, 400);
}
