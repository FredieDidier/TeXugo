// Git panel backend: status, diff, stage/commit, pull/push, history. Uses
// the system git, so credentials come from the macOS keychain helper or
// GitHub Desktop's configuration, as in the terminal.
import { L } from './lang.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isOffline, run, toolEnv } from './util.js';
import { IS_MAC, IS_WIN } from './platform.js';

const git = (root, args, opts = {}) => run('git', ['-C', root, ...args], { timeout: 120000, ...opts });

// Git could not reach the remote at all (no network, DNS, firewall). Git's
// own text names URLs and curl errors; this says it in one plain sentence.
const NO_NET = /Could not resolve host|Failed to connect to|Network is unreachable|Connection timed out|Operation timed out|Couldn't connect to server|Connection refused/i;
// `after` gives the second sentence, in the UI language.
export function offlineText(out, after) {
  if (!NO_NET.test(out || '')) return null;
  const host = ((out.match(/(?:resolve host(?:name)?:?|connect to) ([\w.-]+)/i) || [])[1] || '').replace(/\.$/, '');
  return (host ? L('Sem conexão com ', 'No connection to ') + host + '. ' : L('Sem conexão com o remoto. ', 'No connection to the remote. ')) + after();
}
const NOTHING = () => L('Nada mudou aqui; tente de novo quando a internet voltar.', 'Nothing changed here; try again when the internet is back.');
const KEPT = () => L('Os seus commits ficam aqui e sobem no próximo Push ou Sincronizar.', 'Your commits stay here and go up with the next Push or Sync.');
const plain = (r, what) => {
  const said = r.code !== 0 && offlineText(r.stderr || r.stdout, what);
  return said ? { ...r, offline: true, stderr: said } : r;
};

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
  const overleaf = overleafUrl((await git(root, ['config', '--get', 'remote.overleaf.url'])).stdout.trim());
  return { repo: true, top, branch, upstream, ahead, behind, files, remote, webUrl: webUrl(remote), overleaf };
}

function overleafUrl(value) {
  const match = /^https:\/\/(?:(?:www\.)?overleaf\.com\/project\/|git\.overleaf\.com\/)([a-f0-9]{24})\/?$/i.exec(value);
  return match ? `https://git.overleaf.com/${match[1]}` : null;
}

function overleafGit(root, args, input) {
  const helper = IS_MAC ? 'osxkeychain' : IS_WIN ? 'manager' : 'libsecret';
  return git(root, [
    '-c', 'credential.helper=', '-c', `credential.helper=${helper}`,
    '-c', 'credential.username=git', '-c', 'credential.useHttpPath=false',
    '-c', 'http.followRedirects=false', ...args,
  ], { input, env: { ...toolEnv(), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' } });
}

function overleafFailure(result, phase) {
  const output = result.stderr + '\n' + result.stdout;
  const offline = offlineText(output, phase === 'connect' ? NOTHING : KEPT);
  let stderr = offline;
  if (!stderr && /Authentication failed|could not read (?:Username|Password)|401|403/i.test(output)) {
    stderr = L('O Overleaf recusou o acesso. Confira o token e se o projeto tem acesso à integração Git.', 'Overleaf denied access. Check the token and the project’s access to Git integration.');
  }
  if (!stderr && /repository .*not found|404/i.test(output)) {
    stderr = L('Projeto do Overleaf não encontrado. Confira o endereço e o acesso à integração Git.', 'Overleaf project not found. Check the address and access to Git integration.');
  }
  if (!stderr && /too large|size limit|exceeds|maximum size/i.test(output)) {
    stderr = L('O Overleaf recusou o projeto pelo tamanho. Confira os limites de arquivos e do projeto.', 'Overleaf rejected the project because of its size. Check the file and project limits.');
  }
  if (!stderr && /non-fast-forward|fetch first|\[(?:remote )?rejected\]/i.test(output)) {
    stderr = L('O Overleaf recusou o envio. Sincronize novamente para baixar as mudanças mais recentes.', 'Overleaf rejected the push. Sync again to download the latest changes.');
  }
  return { code: result.code || 1, stderr: stderr || L('A operação com o Overleaf falhou. Confira o acesso e tente novamente.', 'The Overleaf operation failed. Check access and try again.') };
}

const overleafBusy = new Set();

export async function connectOverleaf(root, address, token) {
  const url = typeof address === 'string' && overleafUrl(address.trim());
  if (!url || typeof token !== 'string' || !token || /[\s\x00-\x1f\x7f]/.test(token)) {
    return { code: 1, stderr: L('Informe o endereço do projeto e um token Git do Overleaf.', 'Enter the project address and an Overleaf Git token.') };
  }
  if (overleafBusy.has(root)) return overleafInProgress();
  overleafBusy.add(root);
  try {
    const lookup = await git(root, ['ls-remote', '--get-url', url]);
    if (lookup.code !== 0 || lookup.stdout.trim() !== url) return overleafFailure(lookup, 'connect');
    // Verify access before replacing a token shared by other projects.
    try {
      const response = await globalThis.fetch(url + '/info/refs?service=git-upload-pack', {
        headers: { Authorization: 'Basic ' + Buffer.from('git:' + token).toString('base64') },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      if (!response.ok || !response.headers.get('content-type')?.startsWith('application/x-git-upload-pack-advertisement')) {
        return overleafFailure({ code: 1, stdout: '', stderr: String(response.status) }, 'connect');
      }
    } catch (err) {
      if (isOffline(err) || err.name === 'TimeoutError') {
        return { code: 1, stderr: L('Sem conexão com o Overleaf. Tente novamente quando a conexão voltar.', 'Cannot connect to Overleaf. Try again when the connection is back.') };
      }
      return overleafFailure({ code: 1, stdout: '', stderr: '' }, 'connect');
    }
    const credential = ['protocol=https', 'host=git.overleaf.com', 'username=git', ''].join('\n');
    const approved = await overleafGit(root, ['credential', 'approve'], credential + `password=${token}\n\n`);
    const stored = await overleafGit(root, ['credential', 'fill'], credential + '\n');
    if (approved.code !== 0 || stored.code !== 0 || !stored.stdout.split('\n').includes(`password=${token}`)) {
      return { code: 1, stderr: L('O gerenciador de credenciais do sistema não guardou o token do Overleaf.', 'The system credential manager could not save the Overleaf token.') };
    }
    const existing = await git(root, ['remote', 'get-url', 'overleaf']);
    const configured = await git(root, existing.code === 0 ? ['remote', 'set-url', 'overleaf', url] : ['remote', 'add', 'overleaf', url]);
    return configured.code === 0 ? { code: 0 } : overleafFailure(configured, 'connect');
  } finally {
    overleafBusy.delete(root);
  }
}

function overleafInProgress() {
  return { code: 1, stderr: L('Já há uma operação com o Overleaf em andamento.', 'An Overleaf operation is already in progress.') };
}

export async function syncOverleaf(root, message, { force = false } = {}) {
  if (overleafBusy.has(root)) return overleafInProgress();
  overleafBusy.add(root);
  try {
    const st = await status(root);
    if (!st.overleaf) return { code: 1, stderr: L('Conecte o projeto ao Overleaf primeiro.', 'Connect the project to Overleaf first.') };
    // Check the effective fetch and push addresses before using credentials.
    const urls = await Promise.all([
      git(root, ['remote', 'get-url', '--all', 'overleaf']),
      git(root, ['remote', 'get-url', '--push', '--all', 'overleaf']),
    ]);
    if (urls.some((r) => r.code !== 0 || r.stdout.trim() !== st.overleaf)) return overleafFailure({ code: 1, stdout: '', stderr: '' });
    return await syncOverleafBranch(root, st.overleaf, st, message, force);
  } finally {
    overleafBusy.delete(root);
  }
}

// Overleaf has one branch. An explicit refspec keeps the local upstream
// available for GitHub, and merging preserves the histories of both remotes.
export async function syncOverleafBranch(root, url, st, message, force) {
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  const branch = await git(root, ['symbolic-ref', '--quiet', 'HEAD']);
  if (!gitDir || branch.code !== 0 || ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'].some((f) => fs.existsSync(path.join(gitDir, f)))) {
    return { code: 1, stderr: L('Conclua a operação Git atual e selecione um ramo antes de sincronizar com o Overleaf.', 'Finish the current Git operation and select a branch before syncing with Overleaf.') };
  }
  if (st.files.length) {
    const c = await commit(root, message, { all: true, force, files: st.files });
    if (c.code !== 0) return { code: c.code, large: c.large, stderr: c.stderr || c.stdout };
  }
  const ref = 'refs/remotes/overleaf/master';
  const fetched = await overleafGit(root, ['fetch', '--no-tags', '--no-write-fetch-head', url, `refs/heads/master:${ref}`]);
  if (fetched.code !== 0) return overleafFailure(fetched);
  const merged = await git(root, ['merge', '--ff', '--no-edit', '--no-autostash', '--allow-unrelated-histories', ref]);
  if (merged.code !== 0) {
    if (!fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) return overleafFailure(merged);
    const aborted = await git(root, ['merge', '--abort']);
    const stderr = aborted.code === 0
      ? L('As mudanças do Overleaf conflitam com as locais. O merge foi cancelado e os commits locais foram preservados.', 'Overleaf changes conflict with local changes. The merge was aborted and local commits were preserved.')
      : L('O merge com o Overleaf precisa ser resolvido no terminal.', 'Resolve the Overleaf merge in the terminal.');
    return { code: 1, conflict: true, stderr };
  }
  const pushed = await overleafGit(root, ['push', '--no-force', '--no-follow-tags', url, 'HEAD:refs/heads/master']);
  return pushed.code === 0 ? { code: 0 } : overleafFailure(pushed);
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

// New files above this size are worth a question before they enter a commit:
// GitHub refuses a push with a file over 100 MB, after the commit is made.
export const LARGE_MB = 50;
export function largeNewFiles(files, all) {
  const out = [];
  for (const f of files) {
    const isNew = all ? f.untracked || f.index === 'A' : f.staged && f.index === 'A';
    if (!isNew) continue;
    try {
      const mb = fs.statSync(f.path).size / 1048576;
      if (mb > LARGE_MB) out.push({ rel: f.rel, mb: Math.round(mb) });
    } catch {}
  }
  return out;
}

export async function commit(root, message, { all = false, force = false, files } = {}) {
  if (!force) {
    const large = largeNewFiles(files || (await status(root)).files || [], all);
    if (large.length) return { code: 1, large, stderr: `Arquivo novo grande: ${large.map((f) => `${f.rel} (${f.mb} MB)`).join(', ')}.` };
  }
  if (all) {
    const staged = await git(root, ['add', '-A']);
    if (staged.code !== 0) return staged;
  }
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
  // In the UI language: the message goes to the shared history.
  const and = L('e', 'and');
  const list = (names) => (names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} ${and} ${names[1]}` : `${names[0]}, ${names[1]} ${L('e mais', 'and')} ${names.length - 2}${L('', ' more')}`);
  const verb = (pt, en, first) => (first ? L(pt, en) : L(pt, en).toLowerCase());
  const out = [];
  if (groups.M.length) out.push(`${verb('Atualiza', 'Update', !out.length)} ${list(groups.M)}`);
  if (groups.A.length) out.push(`${verb('Adiciona', 'Add', !out.length)} ${list(groups.A)}`);
  if (groups.D.length) out.push(`${verb('Remove', 'Remove', !out.length)} ${list(groups.D)}`);
  if (groups.R.length) out.push(`${verb('Renomeia', 'Rename', !out.length)} ${list(groups.R)}`);
  return out.join('; ') || L('Atualiza o projeto', 'Update the project');
}

// One click: commit what changed (if anything), bring the remote's commits
// (rebase, so no merge commit), send ours. Stops and explains on conflict.
export async function sync(root, message, { force = false } = {}) {
  const steps = [];
  const st = await status(root);
  if (st.files.length) {
    const c = await commit(root, message, { all: !st.files.some((f) => f.staged), force, files: st.files });
    if (c.code !== 0) return { code: c.code, large: c.large, stderr: c.stderr || c.stdout, steps };
    steps.push(`commit “${c.message}”`);
  }
  if (st.remote) {
    if (st.upstream) {
      // --autostash: changes left out of the commit do not stop the pull.
      const p = await git(root, ['pull', '--rebase', '--autostash']);
      if (p.code !== 0) {
        const tail = (p.stderr || p.stdout || '').trim().split('\n').slice(-2).join(' ');
        // Only a rebase that stopped midway is a conflict; anything else
        // (no network, no access, a wrong remote) is said as it is.
        const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
        const midRebase = gitDir && ['rebase-merge', 'rebase-apply'].some((d) => fs.existsSync(path.join(gitDir, d)));
        if (midRebase) {
          await git(root, ['rebase', '--abort']);
          return { code: p.code, conflict: true, stderr: 'O pull achou mudanças que conflitam com as suas; nada foi perdido (o commit está feito). Resolva pelo GitHub Desktop ou pelo terminal. ' + tail, steps };
        }
        const committed = steps.length ? () => L('O commit está feito aqui e sobe no próximo Sincronizar.', 'The commit is made here and goes up with the next Sync.') : NOTHING;
        const said = offlineText(p.stderr || p.stdout, committed);
        if (said) return { code: p.code, offline: true, stderr: said, steps };
        return { code: p.code, stderr: 'O pull falhou (não foi conflito): ' + tail, steps };
      }
      steps.push('pull');
    }
    const u = await push(root);
    if (u.code !== 0) return { code: u.code, offline: u.offline, stderr: u.stderr || u.stdout, steps };
    steps.push('push');
  }
  return { code: 0, steps };
}

// Asks the remote what is new without changing anything here.
export async function fetch(root) {
  return plain(await git(root, ['fetch', '--quiet'], { timeout: 60000 }), NOTHING);
}

export async function pull(root) {
  return plain(await git(root, ['pull', '--ff-only']), NOTHING);
}

export async function push(root) {
  const st = await status(root);
  if (!st.upstream && st.branch) return plain(await git(root, ['push', '-u', 'origin', st.branch]), KEPT);
  return plain(await git(root, ['push']), KEPT);
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

// "Juntar" in the save-conflict dialog: a three-way merge of whole texts.
// base is what the tab loaded from disk, mine is the tab now, theirs is the
// disk now. git merge-file exits with the number of passages both sides
// changed; with none, the result keeps every change of both.
export async function mergeText(base, mine, theirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-merge-'));
  try {
    const file = (name, text) => (fs.writeFileSync(path.join(dir, name), text), path.join(dir, name));
    const r = await run('git', ['merge-file', '-p', file('mine', mine), file('base', base), file('theirs', theirs)], { timeout: 30000 });
    if (r.code < 0 || r.code > 127) throw new Error(L('Não deu para juntar: o Git não respondeu.', 'Could not merge: Git did not answer.'));
    return { text: r.stdout, conflicts: r.code };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
