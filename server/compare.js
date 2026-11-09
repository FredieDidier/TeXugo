// "Comparar com versão": a PDF with the changes marked (latexdiff) between
// the current document and another version of it — a .tex, ZIP or folder a
// coauthor sent (Overleaf export, e-mail, WhatsApp), or a Git commit.
//
// The other version is rebuilt in a temporary folder that mirrors the
// document's layout. Files it does not bring (the generated tables a
// coauthor never sends, figures, sections they did not touch) are taken
// from the current version, so they count as unchanged instead of showing
// up as entirely new. latexdiff --flatten then compares the whole document,
// \input files included, and the result is compiled inside .texugo/diff in
// the document's folder, with the current figures, tables and .bib.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, toolEnv, readText } from './util.js';
import { includeClosure, docInfo } from './project.js';

const DEPTH = 6; // how many ../ levels an \input may climb in the mirror

function findMain(dir, wantedName) {
  const all = [];
  (function walk(d, depth) {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith('.tex')) all.push({ full, depth });
    }
  })(dir, 0);
  const byDepth = (a, b) => a.depth - b.depth;
  const same = all.filter((f) => path.basename(f.full) === wantedName).sort(byDepth);
  if (same.length) return same[0].full;
  const docs = all.filter((f) => /\\documentclass/.test((readText(f.full) || '').slice(0, 20000))).sort(byDepth);
  if (docs.length === 1) return docs[0].full;
  if (!docs.length) throw new Error('Não achei nenhum documento LaTeX (\\documentclass) na versão recebida.');
  throw new Error(`A versão recebida tem ${docs.length} documentos e nenhum se chama ${wantedName}: ${docs.map((d) => path.relative(dir, d.full)).join(', ')}.`);
}

async function gitRoot(dir) {
  const r = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 10000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

// Returns a function rel -> text (or null) that reads the other version.
async function sourceReader(doc, source, tmp) {
  const docDir = path.dirname(doc);
  if (source.kind === 'git') {
    const root = await gitRoot(docDir);
    if (!root) throw new Error('Esta pasta não é um repositório Git.');
    if (!/^[\w./~^@{}-]+$/.test(source.rev || '')) throw new Error('Versão do Git inválida.');
    const prefix = path.relative(fs.realpathSync(root), fs.realpathSync(docDir));
    const read = async (rel) => {
      const p = path.posix.normalize(path.join(prefix, rel).split(path.sep).join('/'));
      if (p.startsWith('..')) return null;
      const r = await run('git', ['-C', root, 'show', `${source.rev}:${p}`], { timeout: 20000 });
      return r.code === 0 ? r.stdout : null;
    };
    if ((await read(path.basename(doc))) == null) throw new Error(`${path.basename(doc)} não existe nessa versão do Git.`);
    return { read, label: source.label || source.rev, mainRel: path.basename(doc) };
  }
  let p = path.resolve(source.path || '');
  if (!fs.existsSync(p)) throw new Error('Arquivo não encontrado: ' + p);
  let base;
  let main;
  if (fs.statSync(p).isDirectory()) {
    base = p;
    main = findMain(p, path.basename(doc));
  } else if (/\.zip$/i.test(p)) {
    base = path.join(tmp, 'zip');
    fs.mkdirSync(base, { recursive: true });
    const r = await run('ditto', ['-x', '-k', p, base], { timeout: 60000 });
    if (r.code !== 0) throw new Error('Não deu para abrir o ZIP: ' + (r.stderr || '').trim());
    main = findMain(base, path.basename(doc));
  } else if (/\.tex$/i.test(p)) {
    base = path.dirname(p);
    main = p;
  } else throw new Error('Escolha um .tex, um .zip ou uma pasta.');
  const mainDir = path.dirname(main);
  const read = async (rel) => {
    const f = rel === '.main' ? main : path.resolve(mainDir, rel);
    // A lone .tex brings only itself; its folder (often Downloads) is not
    // the coauthor's project.
    if (/\.tex$/i.test(p) && !fs.statSync(p).isDirectory() && f !== main) return null;
    try {
      return fs.readFileSync(f, 'utf8');
    } catch {
      return null;
    }
  };
  return { read, label: path.basename(p), mainRel: '.main' };
}

export async function compareBuild(doc, source) {
  const docDir = path.dirname(doc);
  const stem = path.basename(doc, '.tex');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-diff-'));
  try {
    const src = await sourceReader(doc, source, tmp);
    // Mirror: the old document sits DEPTH folders deep so ../ inputs land
    // inside tmp too.
    const oldDir = path.join(tmp, 'old', ...Array.from({ length: DEPTH }, (_, i) => 'd' + i));
    fs.mkdirSync(oldDir, { recursive: true });
    const oldDoc = path.join(oldDir, path.basename(doc));
    const mainText = await src.read(src.mainRel);
    if (mainText == null) throw new Error('Não deu para ler o documento da outra versão.');
    fs.writeFileSync(oldDoc, mainText);
    const changedFiles = [];
    const fromCurrent = [];
    for (const f of includeClosure(doc)) {
      if (f === doc) continue;
      const rel = path.relative(docDir, f);
      const target = path.resolve(oldDir, rel);
      if (!target.startsWith(path.join(tmp, 'old'))) continue;
      const text = await src.read(rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (text == null) {
        fs.copyFileSync(f, target);
        fromCurrent.push(rel);
      } else {
        fs.writeFileSync(target, text);
        if (text !== readText(f)) changedFiles.push(rel);
      }
    }
    if (mainText !== readText(doc)) changedFiles.unshift(path.basename(doc));

    const outDir = path.join(docDir, '.texugo', 'diff');
    fs.mkdirSync(outDir, { recursive: true });
    const job = `${stem}-mudancas`;
    const diffTex = path.join(outDir, job + '.tex');
    const ld = await run('latexdiff', ['--flatten', '--encoding=utf8', oldDoc, doc], { cwd: docDir, timeout: 180000 });
    if (ld.code !== 0 || !ld.stdout.includes('\\begin{document}')) {
      throw new Error('O latexdiff falhou: ' + (ld.stderr || '').split('\n').filter((l) => /error|die|at .* line/i.test(l)).slice(0, 3).join(' ').slice(0, 400) || `código ${ld.code}`);
    }
    fs.writeFileSync(diffTex, ld.stdout);
    // Count in the body only: the preamble defines \DIFaddbegin and friends.
    const body = ld.stdout.slice(ld.stdout.indexOf('\\begin{document}'));
    const added = (body.match(/\\DIFaddbegin\b/g) || []).length;
    const deleted = (body.match(/\\DIFdelbegin\b/g) || []).length;

    // Compile from the document's folder, so figures, \input tables and
    // \externaldocument labels resolve as in the real build.
    const info = docInfo(doc);
    const engine = info.engine || 'pdflatex';
    const env = { ...toolEnv(), BIBINPUTS: docDir + ':', BSTINPUTS: docDir + ':' };
    const tex = () => run(engine, ['-interaction=nonstopmode', '-file-line-error', `-output-directory=${outDir}`, diffTex], { cwd: docDir, env, timeout: 300000 });
    await tex();
    // Bibliography: BibTeX against the document's .bib (deleted text keeps
    // its citations); the document's own .bbl if that fails or for biber.
    const bbl = path.join(outDir, job + '.bbl');
    let bibOk = false;
    if (info.bibTool === 'bibtex') {
      const b = await run('bibtex', [job], { cwd: outDir, env, timeout: 120000 });
      bibOk = b.code === 0 && fs.existsSync(bbl);
    }
    if (!bibOk && fs.existsSync(path.join(docDir, stem + '.bbl'))) fs.copyFileSync(path.join(docDir, stem + '.bbl'), bbl);
    await tex();
    await tex();
    const pdf = path.join(outDir, job + '.pdf');
    if (!fs.existsSync(pdf)) {
      const log = readText(path.join(outDir, job + '.log')) || '';
      const err = (log.match(/^!.*$/m) || [''])[0];
      throw new Error(`O PDF com as mudanças não compilou${err ? ': ' + err : ''}. O arquivo está em .texugo/diff/${job}.tex.`);
    }
    return { pdf, tex: diffTex, label: src.label, added, deleted, changedFiles, fromCurrent, same: !added && !deleted };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Copies the marked PDF next to the document, to send to a coauthor.
export function saveCopy(pdf, doc) {
  const target = path.join(path.dirname(doc), path.basename(pdf));
  fs.copyFileSync(pdf, target);
  return target;
}
