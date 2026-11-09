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
  if (!message || !message.trim()) message = await autoMessage(root);
  const r = await git(root, ['commit', '-m', message]);
  return { ...r, message };
}

// A message from the staged files, for a commit without one, the way GitHub
// Desktop does: "Atualiza paper.tex e refs.bib", "Adiciona fig1.pdf".
export async function autoMessage(root) {
  const r = await git(root, ['diff', '--cached', '--name-status', '-z']);
  const parts = r.stdout.split('\0').filter(Boolean);
  const groups = { A: [], M: [], D: [], R: [] };
  for (let i = 0; i < parts.length; i++) {
    const st = parts[i][0];
    const file = st === 'R' || st === 'C' ? (i += 2, parts[i]) : parts[++i];
    (groups[st] || groups.M).push(path.basename(file || ''));
  }
  const list = (names) => (names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} e ${names[1]}` : `${names[0]}, ${names[1]} e mais ${names.length - 2}`);
  const out = [];
  if (groups.M.length) out.push(`Atualiza ${list(groups.M)}`);
  if (groups.A.length) out.push(`${out.length ? 'adiciona' : 'Adiciona'} ${list(groups.A)}`);
  if (groups.D.length) out.push(`${out.length ? 'remove' : 'Remove'} ${list(groups.D)}`);
  if (groups.R.length) out.push(`${out.length ? 'renomeia' : 'Renomeia'} ${list(groups.R)}`);
  return out.join('; ') || 'Atualiza o projeto';
}

// One click: commit what changed (if anything), bring the remote's commits
// (rebase, so no merge commit), send ours. Stops and explains on conflict.
export async function sync(root, message) {
  const steps = [];
  const st = await status(root);
  if (st.files.length) {
    const c = await commit(root, message, { all: !st.files.some((f) => f.staged) });
    if (c.code !== 0) return { code: c.code, stderr: c.stderr || c.stdout, steps };
    steps.push(`commit “${c.message}”`);
  }
  if (st.remote) {
    if (st.upstream) {
      const p = await git(root, ['pull', '--rebase']);
      if (p.code !== 0) {
        await git(root, ['rebase', '--abort']);
        return { code: p.code, stderr: 'O pull achou mudanças que conflitam com as suas; nada foi perdido (o commit está feito). Resolva pelo GitHub Desktop ou pelo terminal. ' + (p.stderr || '').trim().split('\n').slice(-2).join(' '), steps };
      }
      steps.push('pull');
    }
    const u = await push(root);
    if (u.code !== 0) return { code: u.code, stderr: u.stderr || u.stdout, steps };
    steps.push('push');
  }
  return { code: 0, steps };
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
