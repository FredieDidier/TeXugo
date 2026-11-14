// "TeX doctor": what the TeX installation can do, which TeX Live package
// provides a missing .sty/.cls, installing it, and latexindent formatting.
import { L } from './lang.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, toolEnv, which, perlProblem } from './util.js';
import { IS_MAC, IS_WIN } from './platform.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERL_SHIM = path.join(HERE, 'vendor', 'perl');
const historic = (year) => `https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/${year}/tlnet-final`;

let infoCache = null;
export async function texInfo({ refresh = false } = {}) {
  if (infoCache && !refresh) return infoCache;
  const tlmgr = await which('tlmgr');
  let year = null;
  let root = null;
  if (tlmgr) {
    const r = await run('tlmgr', ['--version'], { timeout: 20000 });
    year = Number((r.stdout.match(/version (\d{4})/) || [])[1]) || null;
    root = ((r.stdout.match(/installation: (.+)/) || [])[1] || '').trim() || null;
  }
  // A TeX Live older than the current release is frozen: the main mirrors
  // refuse it, and only the historic archive of its year still serves it.
  const now = new Date();
  const currentYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const frozen = !!year && year < currentYear;
  let writable = false;
  try {
    if (root) fs.accessSync(path.join(root, 'tlpkg'), fs.constants.W_OK), (writable = true);
  } catch {}
  // MiKTeX (Windows, sometimes Linux) has its own package manager.
  const miktex = tlmgr ? null : await which('miktex');
  infoCache = { tlmgr, miktex, year, root, frozen, writable, repository: frozen ? historic(year) : null, latexindent: await latexindentStatus() };
  return infoCache;
}

async function latexindentStatus() {
  if (!(await which('latexindent'))) return { ok: false, reason: 'latexindent não está instalado.' };
  const noPerl = await perlProblem('latexindent');
  if (noPerl) return { ok: false, reason: noPerl };
  const r = await run('latexindent', ['--version'], { env: indentEnv(), timeout: 20000 });
  return r.code === 0 ? { ok: true, version: r.stdout.trim().split('\n')[0] } : { ok: false, reason: (r.stderr || r.stdout).split('\n')[0] };
}

function indentEnv() {
  const env = toolEnv();
  env.PERL5LIB = [PERL_SHIM, process.env.PERL5LIB].filter(Boolean).join(path.delimiter);
  return env;
}

const repoArgs = (info) => (info.repository ? ['--repository', info.repository] : []);

function offlineMessage(output) {
  if (/TLPDB::from_file could not get texlive\.tlpdb from: https?:\/\//i.test(output)) {
    return L(
      'Não foi possível baixar a lista de pacotes do TeX Live. Confira a conexão ou tente novamente mais tarde.',
      'Could not download the TeX Live package list. Check the connection or try again later.',
    );
  }
  if (!/Could not resolve (?:host|proxy)|Temporary failure in name resolution|Name or service not known|(?:Failed|Unable) to connect|Couldn't connect to server|Connection (?:refused|timed out)|(?:Network is unreachable|No route to host)|(?:Could not resolve|Connection) .+\((?:6|7|28)\)/i.test(output)) return null;
  return L(
    'Sem conexão com o repositório de pacotes do TeX. Tente novamente quando a conexão voltar.',
    'Cannot connect to the TeX package repository. Try again when the connection is back.',
  );
}

// Which TeX Live package provides each missing file. Needs the network.
const pkgCache = new Map();
export async function findPackages(files) {
  const info = await texInfo();
  // MiKTeX names packages after the .sty/.cls in nearly every case.
  if (!info.tlmgr && info.miktex) return files.filter((f) => /^[\w.@+-]+$/.test(f)).map((file) => ({ file, package: file.replace(/\.(sty|cls|bst|def|cfg)$/, '').toLowerCase() }));
  if (!info.tlmgr) throw new Error('tlmgr não encontrado: o TeX Live não parece estar instalado.');
  const out = [];
  for (const file of files) {
    if (!/^[\w.@+-]+$/.test(file)) continue;
    if (pkgCache.has(file)) {
      out.push({ file, package: pkgCache.get(file) });
      continue;
    }
    const r = await run('tlmgr', [...repoArgs(info), 'search', '--global', '--file', '/' + file], { timeout: 180000 });
    const offline = r.code !== 0 && offlineMessage(r.stderr + '\n' + r.stdout);
    if (offline) throw new Error(offline);
    // Output: "pkgname:\n\ttexmf-dist/.../file" blocks.
    let pkg = null;
    let current = null;
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^([\w.-]+):$/);
      if (m) current = m[1];
      else if (current && line.trim().endsWith('/' + file)) {
        pkg = current;
        break;
      }
    }
    if (!pkg && r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-2).join(' '));
    pkgCache.set(file, pkg);
    out.push({ file, package: pkg });
  }
  return out;
}

// Installs packages. MacTeX lives in a root-owned folder, so the install
// runs through macOS's own administrator dialog: the user types the
// password there, and TeXugo never sees it.
export async function installPackages(pkgs) {
  pkgs = [...new Set(pkgs)].filter((p) => /^[\w.-]+$/.test(p));
  if (!pkgs.length) throw new Error('Nenhum pacote válido.');
  const info = await texInfo();
  const tlmgr = info.tlmgr;
  let r;
  if (!tlmgr && info.miktex) {
    r = await run('miktex', ['packages', 'install', ...pkgs], { timeout: 15 * 60000 });
    const output = (r.stdout + r.stderr).trim();
    return { ok: r.code === 0, installed: r.code === 0 ? pkgs : [], output: (r.code !== 0 && offlineMessage(output)) || output.split('\n').slice(-40).join('\n') };
  }
  const repo = repoArgs(info).join(' ');
  const script = `(${tlmgr} ${repo} update --self; ${tlmgr} ${repo} install ${pkgs.join(' ')}) 2>&1`;
  if (info.writable || IS_WIN) {
    // Windows' TeX Live is usually the user's own: no password, no shell.
    const a = await run(tlmgr, [...repoArgs(info), 'update', '--self'], { timeout: 15 * 60000 });
    const b = await run(tlmgr, [...repoArgs(info), 'install', ...pkgs], { timeout: 15 * 60000 });
    r = { code: b.code, stdout: a.stdout + a.stderr + b.stdout, stderr: b.stderr };
  } else if (!IS_MAC) {
    // Linux: the desktop's own password dialog (polkit).
    r = await run('pkexec', ['/bin/sh', '-c', script], { timeout: 15 * 60000 });
    if (r.code === 126) return { ok: false, cancelled: true, output: '' };
  } else {
    const as = `do shell script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges with prompt "${L('O TeXugo quer instalar pacotes do TeX Live', 'TeXugo wants to install TeX Live packages')}: ${pkgs.join(', ')}"`;
    r = await run('osascript', ['-e', as], { timeout: 15 * 60000 });
  }
  const output = (r.stdout + r.stderr).trim();
  if (/User canceled|-128/.test(output)) return { ok: false, cancelled: true, output };
  const installed = pkgs.filter((p) => new RegExp(`(\\[\\d+/\\d+[^\\]]*\\]\\s+)?install:\\s+${p}\\b|package already present: ${p}\\b`).test(output));
  const ok = r.code === 0 && installed.length === pkgs.length;
  return { ok, installed, output: (!ok && offlineMessage(output)) || output.split('\n').slice(-40).join('\n') };
}

// Formats LaTeX with latexindent, in a scratch folder so indent.log and
// backups never land in the project. A project localSettings.yaml or
// .latexindent.yaml wins over TeXugo's defaults.
export async function formatLatex(text, file) {
  const st = await latexindentStatus();
  if (!st.ok) throw new Error('latexindent não funciona: ' + st.reason);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-indent-'));
  try {
    const src = path.join(tmp, path.basename(file));
    fs.writeFileSync(src, text);
    const dir = path.dirname(file);
    const own = ['localSettings.yaml', 'latexindent.yaml', '.latexindent.yaml', 'indentconfig.yaml'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    let settings = own;
    if (!settings) {
      settings = path.join(tmp, 'texugo.yaml');
      // Two spaces like the editor; leave the document body flush left.
      fs.writeFileSync(settings, 'defaultIndent: "  "\nindentPreamble: 0\nnoAdditionalIndent:\n  document: 1\n');
    }
    const r = await run('latexindent', [`-l=${settings}`, `-c=${tmp}`, src], { cwd: tmp, env: indentEnv(), timeout: 60000 });
    if (r.code !== 0 || !r.stdout) throw new Error((r.stderr || 'latexindent falhou').trim().split('\n').slice(-3).join(' '));
    return { text: r.stdout, settings: own ? path.basename(own) : null };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
