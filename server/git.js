// Git panel backend: status, diff, stage/commit, pull/push, history. Uses
// the system git, so credentials come from the macOS keychain helper or
// GitHub Desktop's configuration, as in the terminal.
import path from 'node:path';
import { run } from './util.js';

const git = (root, args, opts = {}) => run('git', ['-C', root, ...args], { timeout: 120000, ...opts });

export async function status(root) {
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) return { repo: false };
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).stdout.trim();
  const r = await git(root, ['status', '--porcelain=v1', '-b', '-uall', '-z']);
  const parts = r.stdout.split('\0').filter(Boolean);
  let branch = null;
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('## ')) {
      const m = p.match(/^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/);
      if (m) {
        branch = m[1];
        upstream = m[2] || null;
        const a = (m[3] || '').match(/ahead (\d+)/);
        const b = (m[3] || '').match(/behind (\d+)/);
        ahead = a ? Number(a[1]) : 0;
        behind = b ? Number(b[1]) : 0;
      }
      continue;
    }
    const x = p[0];
    const y = p[1];
    let file = p.slice(3);
    let from = null;
    if (x === 'R' || x === 'C') from = parts[++i];
    files.push({ path: path.join(top, file), rel: file, index: x, work: y, from, staged: x !== ' ' && x !== '?', untracked: x === '?' });
  }
  const remote = (await git(root, ['remote', 'get-url', 'origin'])).stdout.trim() || null;
  return { repo: true, top, branch, upstream, ahead, behind, files, remote, webUrl: webUrl(remote) };
}

function webUrl(remote) {
  if (!remote) return null;
  let m = remote.match(/^git@github\.com:(.+?)(\.git)?$/);
  if (m) return `https://github.com/${m[1]}`;
  m = remote.match(/^https:\/\/github\.com\/(.+?)(\.git)?$/);
  return m ? `https://github.com/${m[1]}` : null;
}

export async function diff(root, file, staged) {
  const args = ['diff', '--no-color', '-U3'];
  if (staged) args.push('--cached');
  const r = await git(root, [...args, '--', file]);
  if (!r.stdout && !staged) {
    // Untracked file: show it whole as an addition.
    const u = await git(root, ['diff', '--no-color', '--no-index', '--', '/dev/null', file]);
    return u.stdout;
  }
  return r.stdout;
}

export async function stage(root, files) {
  return git(root, ['add', '--', ...files]);
}

export async function unstage(root, files) {
  return git(root, ['reset', '-q', 'HEAD', '--', ...files]);
}

export async function commit(root, message, { all = false } = {}) {
  if (all) await git(root, ['add', '-A']);
  return git(root, ['commit', '-m', message]);
}

export async function pull(root) {
  return git(root, ['pull', '--ff-only']);
}

export async function push(root) {
  const st = await status(root);
  if (!st.upstream && st.branch) return git(root, ['push', '-u', 'origin', st.branch]);
  return git(root, ['push']);
}

export async function log(root, file) {
  const args = ['log', '-n', '40', '--date=iso-strict', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s'];
  if (file) args.push('--', file);
  const r = await git(root, args);
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, author, date, subject] = l.split('\x1f');
      return { hash, author, date, subject };
    });
}

export async function init(root) {
  return git(root, ['init']);
}
