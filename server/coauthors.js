// Coauthors on Git: "Novidades desde a sua última visita" (what the others
// committed since you last looked, per author, down to the sections they
// touched) and who wrote each passage (git blame of the text in the editor,
// so line numbers match even before saving).
//
// The visit mark lives in .git/texugo-visit.json: per clone, never
// committed. It moves only when the user has seen the news (opened the
// panel or "Marcar como visto"), so opening the project without looking
// never swallows anything.
import fs from 'node:fs';
import path from 'node:path';
import { run, toolEnv } from './util.js';

const git = (root, args, opts = {}) => run('git', ['-C', root, ...args], { timeout: 60000, env: toolEnv({ GIT_TERMINAL_PROMPT: '0' }), ...opts });
const MAX_COMMITS = 200;

async function gitDir(root) {
  const r = await git(root, ['rev-parse', '--absolute-git-dir']);
  return r.code === 0 ? r.stdout.trim() : null;
}

// A path as the system knows it: symlinks resolved and, on Windows, short
// 8.3 names (C:\Users\RUNNER~1) expanded, with native separators. Git
// reports its top as C:/Users/runneradmin/..., so both sides go through this.
function canon(p) {
  try {
    return path.resolve(fs.realpathSync.native(p));
  } catch {
    return path.resolve(p);
  }
}

async function top(root) {
  const r = await git(root, ['rev-parse', '--show-toplevel']);
  return r.code === 0 ? canon(r.stdout.trim()) : null;
}

export async function whoami(root) {
  const [n, e] = await Promise.all([git(root, ['config', 'user.name']), git(root, ['config', 'user.email'])]);
  return { name: n.stdout.trim(), email: e.stdout.trim().toLowerCase() };
}

const isMe = (me, name, email) => (me.email && email.toLowerCase() === me.email) || (me.name && name === me.name);

export async function readVisit(root) {
  const dir = await gitDir(root);
  if (!dir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'texugo-visit.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Records HEAD (or the given commit) as seen.
export async function markSeen(root, hash) {
  const dir = await gitDir(root);
  if (!dir) return null;
  if (!hash) hash = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  if (!hash) return null;
  const date = (await git(root, ['show', '-s', '--format=%cI', hash])).stdout.trim();
  const mark = { hash, date, at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'texugo-visit.json'), JSON.stringify(mark, null, 2));
  return mark;
}

// Section headings of a LaTeX text, with their 1-based lines.
export function headings(text) {
  const out = [];
  const re = /^[^%\n]*?\\(part|chapter|section|subsection|subsubsection|paragraph|frametitle)\*?\s*(?:\[[^\]]*\])?\s*\{([^\n]*)/;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    // The title up to its balanced closing brace.
    let depth = 1;
    let t = '';
    for (const ch of m[2]) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
      t += ch;
    }
    const title = t.replace(/\\(?:label|footnote|thanks)\{[^}]*\}/g, '').replace(/\\[a-zA-Z]+\*?\s*/g, '').replace(/[{}~]/g, ' ').replace(/\s+/g, ' ').trim();
    if (title) out.push({ level: m[1], title, line: i + 1 });
  }
  return out;
}

// The heading each line range falls under ("(antes da primeira seção)" when
// none), deduplicated, in document order.
export function sectionsFor(heads, ranges) {
  const seen = new Map();
  for (const [a, b] of ranges) {
    // Every heading that starts inside the range, plus the one above it.
    let above = null;
    for (const hd of heads) {
      if (hd.line <= a) above = hd;
      else if (hd.line <= b) seen.set(hd.line, hd);
    }
    const key = above ? above.line : 0;
    if (!seen.has(key)) seen.set(key, above || { level: null, title: null, line: 0 });
  }
  return [...seen.values()].sort((x, y) => x.line - y.line);
}

// New-side line ranges of a -U0 diff, per file.
export function hunkRanges(diffText) {
  const files = new Map();
  let cur = null;
  for (const l of diffText.split('\n')) {
    if (l.startsWith('+++ ')) {
      const p = l.slice(4).trim();
      cur = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (cur && !files.has(cur)) files.set(cur, []);
      continue;
    }
    const m = cur && l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const start = Number(m[1]);
    const n = m[2] == null ? 1 : Number(m[2]);
    // A pure deletion (n = 0) sits after line `start`.
    files.get(cur).push(n ? [start, start + n - 1] : [Math.max(1, start), Math.max(1, start)]);
  }
  return files;
}

// revs: what git log takes, e.g. ['A..HEAD'] or ['--since=…', 'HEAD'].
async function commitsIn(root, revs, me) {
  const r = await git(root, ['log', '--no-merges', '-n', String(MAX_COMMITS), '--date=iso-strict', '--pretty=format:%x1e%H%x1f%an%x1f%ae%x1f%ad%x1f%s', '--numstat', ...revs]);
  if (r.code !== 0) return [];
  const out = [];
  for (const block of r.stdout.split('\x1e').filter((b) => b.trim())) {
    const [headLine, ...rest] = block.split('\n');
    const [hash, name, email, date, subject] = headLine.split('\x1f');
    if (isMe(me, name, email)) continue;
    const files = [];
    for (const l of rest) {
      const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      // Renames show as "old => new" or "dir/{a => b}/f".
      let rel = m[3];
      const br = rel.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
      if (br) rel = (br[1] + br[3] + br[4]).replace(/\/\//g, '/');
      else if (rel.includes(' => ')) rel = rel.split(' => ')[1];
      files.push({ rel, add: m[1] === '-' ? 0 : Number(m[1]), del: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' });
    }
    out.push({ hash, short: hash.slice(0, 7), author: name, email: email.toLowerCase(), date, subject, files });
  }
  return out;
}

// Sections touched by each .tex file of a commit, titles as in that commit.
async function addSections(root, c) {
  const tex = c.files.filter((f) => /\.(tex|ltx)$/i.test(f.rel) && !f.binary);
  if (!tex.length) return;
  const d = await git(root, ['show', '--no-color', '--format=', '-U0', '--no-renames', c.hash, '--', ...tex.map((f) => f.rel)]);
  const ranges = hunkRanges(d.stdout);
  await Promise.all(
    tex.map(async (f) => {
      const rs = ranges.get(f.rel);
      if (!rs || !rs.length) return;
      const body = await git(root, ['show', `${c.hash}:${f.rel}`]);
      if (body.code !== 0) return;
      f.sections = sectionsFor(headings(body.stdout), rs).map((s) => s.title);
    }),
  );
}

function byAuthor(commits, toLocal) {
  const groups = new Map();
  for (const c of commits) {
    const key = c.email || c.author;
    if (!groups.has(key)) groups.set(key, { name: c.author, email: c.email, commits: [], add: 0, del: 0, files: new Map() });
    const g = groups.get(key);
    g.commits.push(c);
    for (const f of c.files) {
      g.add += f.add;
      g.del += f.del;
      if (!g.files.has(f.rel)) g.files.set(f.rel, { rel: f.rel, path: toLocal(f.rel), add: 0, del: 0, sections: [] });
      const gf = g.files.get(f.rel);
      gf.add += f.add;
      gf.del += f.del;
      for (const s of f.sections || []) if (!gf.sections.includes(s)) gf.sections.push(s);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, files: [...g.files.values()].sort((a, b) => b.add + b.del - (a.add + a.del)) }))
    .sort((a, b) => b.commits.length - a.commits.length);
}

async function exists(root, hash) {
  return (await git(root, ['cat-file', '-e', `${hash}^{commit}`])).code === 0;
}

// What the others committed. since: 'visit' (default) or a number of days.
// `base` pins the baseline the panel is showing, so refreshing it after
// "seen" was recorded still shows the same news.
export async function news(root, { since = 'visit', base = null } = {}) {
  const topDir = await top(root);
  if (!topDir) return { repo: false };
  const me = await whoami(root);
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  if (!head) return { repo: true, empty: true, me };
  const upstream = (await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).stdout.trim() || null;

  let revs = null;
  let baseline = null;
  let firstVisit = false;
  if (since === 'visit') {
    const mark = base ? { hash: base } : await readVisit(root);
    if (!mark) {
      firstVisit = true;
      baseline = await markSeen(root, head);
    } else if (await exists(root, mark.hash)) {
      baseline = mark;
      revs = [`${mark.hash}..HEAD`];
    } else if (mark.date) {
      // The marked commit is gone (history rewritten): fall back to its date.
      baseline = mark;
      revs = [`--since=${mark.date}`, 'HEAD'];
    }
  } else {
    const days = Math.max(1, Math.min(365, Number(since) || 7));
    baseline = { date: new Date(Date.now() - days * 864e5).toISOString() };
    revs = [`--since=${baseline.date}`, 'HEAD'];
  }
  const localCommits = revs ? await commitsIn(root, revs, me) : [];
  const remote = upstream ? await commitsIn(root, ['HEAD..@{u}'], me) : [];
  // Each commit costs about three git processes: at most six commits at once,
  // so 120 commits do not start 360 processes together (slow on Windows).
  const queue = [...localCommits, ...remote];
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) await addSections(root, queue.shift());
  }));
  // Git paths are relative to the top of the repository; the app knows the
  // project by the path it opened (maybe a subfolder, maybe via a symlink).
  let prefix = '';
  try {
    prefix = path.relative(topDir, canon(root));
  } catch {}
  const toLocal = (rel) => path.join(root, path.relative(prefix, rel));
  const authors = byAuthor(localCommits, toLocal);
  const remoteAuthors = byAuthor(remote, toLocal);
  // Where each touched section is now, to jump to it.
  for (const a of [...authors, ...remoteAuthors])
    for (const f of a.files) {
      if (!f.sections.length) continue;
      try {
        f.lines = Object.fromEntries(headings(fs.readFileSync(f.path, 'utf8')).map((hd) => [hd.title, hd.line]).reverse());
      } catch {}
      const at = (s) => (s == null ? 0 : f.lines && f.lines[s] != null ? f.lines[s] : 1e9);
      f.sections.sort((x, y) => at(x) - at(y));
    }
  return {
    repo: true,
    me,
    head,
    upstream,
    since,
    baseline,
    firstVisit,
    authors,
    remote: remoteAuthors,
    count: localCommits.length,
    remoteCount: remote.length,
  };
}

// Diff of one file across the news (baseline..HEAD), or of one commit.
export async function newsDiff(root, { from, to = 'HEAD', file }) {
  const args = ['diff', '--no-color', '-U3', from, to];
  if (file) args.push('--', path.relative(root, file));
  return (await git(root, args)).stdout;
}

export async function showCommit(root, { rev, file }) {
  const args = ['show', '--no-color', '--format=%h · %an · %ad%n%s%n%b', '--date=format:%d/%m/%Y %H:%M', rev];
  if (file) args.push('--', path.relative(root, file));
  return (await git(root, args)).stdout;
}

// git blame of `text` (the editor's buffer) as if it were `file`. Lines not
// yet committed come back with local: true.
export async function blame(root, { file, text }) {
  const topDir = await top(root);
  if (!topDir) return { repo: false };
  // Through symlinks (/var -> /private/var), as git reports the top.
  let real = file;
  try {
    real = path.join(canon(path.dirname(file)), path.basename(file));
  } catch {}
  const rel = path.relative(topDir, real);
  const tracked = await git(root, ['ls-files', '--error-unmatch', '--', rel], { cwd: topDir });
  if (tracked.code !== 0) return { repo: true, tracked: false };
  const args = ['blame', '--porcelain', '-w'];
  if (text != null) args.push('--contents', '-');
  args.push('--', rel);
  const r = await run('git', ['-C', topDir, ...args], { input: text, timeout: 60000 });
  if (r.code !== 0) return { repo: true, tracked: true, error: r.stderr.trim() };
  const me = await whoami(root);
  return { repo: true, tracked: true, ...parseBlame(r.stdout, me) };
}

export function parseBlame(out, me = {}) {
  const commits = {};
  const lines = [];
  let cur = null;
  for (const l of out.split('\n')) {
    if (l.startsWith('\t')) {
      if (cur) lines.push(cur);
      cur = null;
      continue;
    }
    const m = l.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (m) {
      cur = m[1];
      if (!commits[cur]) commits[cur] = { hash: cur, local: /^0+$/.test(cur) };
      continue;
    }
    if (!cur) continue;
    const sp = l.indexOf(' ');
    const k = sp < 0 ? l : l.slice(0, sp);
    const v = sp < 0 ? '' : l.slice(sp + 1);
    const c = commits[cur];
    if (k === 'author') c.author = v;
    else if (k === 'author-mail') c.email = v.replace(/[<>]/g, '').toLowerCase();
    else if (k === 'author-time') c.time = Number(v) * 1000;
    else if (k === 'summary') c.summary = v;
  }
  for (const c of Object.values(commits)) c.me = c.local || isMe(me, c.author || '', c.email || '');
  return { commits, lines };
}
