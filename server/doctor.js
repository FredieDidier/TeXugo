// "TeX doctor": what the TeX installation can do, which TeX Live package
// provides a missing .sty/.cls, installing it, and latexindent formatting.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, toolEnv, which } from './util.js';

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
  infoCache = { tlmgr, year, root, frozen, writable, repository: frozen ? historic(year) : null, latexindent: await latexindentStatus() };
  return infoCache;
}

async function latexindentStatus() {
  if (!(await which('latexindent'))) return { ok: false, reason: 'latexindent não está instalado.' };
  const r = await run('latexindent', ['--version'], { env: indentEnv(), timeout: 20000 });
  return r.code === 0 ? { ok: true, version: r.stdout.trim().split('\n')[0] } : { ok: false, reason: (r.stderr || r.stdout).split('\n')[0] };
}

function indentEnv() {
  const env = toolEnv();
  env.PERL5LIB = [PERL_SHIM, process.env.PERL5LIB].filter(Boolean).join(':');
  return env;
}

const repoArgs = (info) => (info.repository ? ['--repository', info.repository] : []);

// Which TeX Live package provides each missing file. Needs the network.
const pkgCache = new Map();
export async function findPackages(files) {
  const info = await texInfo();
  if (!info.tlmgr) throw new Error('tlmgr não encontrado: o TeX Live não parece estar instalado.');
  const out = [];
  for (const file of files) {
    if (!/^[\w.@+-]+$/.test(file)) continue;
    if (pkgCache.has(file)) {
      out.push({ file, package: pkgCache.get(file) });
      continue;
    }
    const r = await run('tlmgr', [...repoArgs(info), 'search', '--global', '--file', '/' + file], { timeout: 180000 });
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
  const repo = repoArgs(info).join(' ');
  const script = `(${tlmgr} ${repo} update --self; ${tlmgr} ${repo} install ${pkgs.join(' ')}) 2>&1`;
  let r;
  if (info.writable) r = await run('/bin/sh', ['-c', script], { timeout: 15 * 60000 });
  else {
    const as = `do shell script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges with prompt "O TeXugo quer instalar pacotes do TeX Live: ${pkgs.join(', ')}"`;
    r = await run('osascript', ['-e', as], { timeout: 15 * 60000 });
  }
  const output = (r.stdout + r.stderr).trim();
  if (/User canceled|-128/.test(output)) return { ok: false, cancelled: true, output };
  const installed = pkgs.filter((p) => new RegExp(`(\\[\\d+/\\d+[^\\]]*\\]\\s+)?install:\\s+${p}\\b|package already present: ${p}\\b`).test(output));
  return { ok: r.code === 0 && installed.length === pkgs.length, installed, output: output.split('\n').slice(-40).join('\n') };
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
