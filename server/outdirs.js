// Where a document's build leaves its files. Next to the .tex by default; a
// latexmkrc in the document's folder can move them with $out_dir (PDF,
// SyncTeX) and $aux_dir (.aux, .log, .fls). Plain literal assignments are
// read directly; anything else (Perl expressions) is asked of latexmk itself,
// which runs the rc files and prints the final values. Cached per rc mtime.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { toolEnv } from './util.js';

const RC_NAMES = ['latexmkrc', '.latexmkrc'];
const cache = new Map(); // dir -> { key, info }

function readMaybe(f) {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
}

function askLatexmk(dir) {
  try {
    const r = spawnSync('latexmk', ['-e', 'print "TEXUGO_OUT=$out_dir\\nTEXUGO_AUX=$aux_dir\\n"; exit 0;'], { cwd: dir, env: toolEnv(), encoding: 'utf8', timeout: 10000 });
    const text = (r.stdout || '') + (r.stderr || '');
    const get = (k) => (text.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || null;
    return { out: get('TEXUGO_OUT'), aux: get('TEXUGO_AUX') };
  } catch {
    return { out: null, aux: null };
  }
}

export function rcInfo(dir) {
  const files = RC_NAMES.map((f) => path.join(dir, f));
  const key = files.map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)).join(':');
  const hit = cache.get(dir);
  if (hit && hit.key === key) return hit.info;
  let text = '';
  let exists = false;
  for (const f of files) {
    const t = readMaybe(f);
    if (t != null) (exists = true), (text += t + '\n');
  }
  text = text.replace(/(^|[^\\$])#.*$/gm, '$1');
  const assigned = (name) => new RegExp('\\$' + name + '\\s*=').test(text);
  const literal = (name) => {
    const m = text.match(new RegExp('\\$' + name + '\\s*=\\s*([\'"])([^\'"$@]+)\\1\\s*;'));
    return m ? m[2] : null;
  };
  let out = literal('out_dir');
  let aux = literal('aux_dir');
  if ((assigned('out_dir') && !out) || (assigned('aux_dir') && !aux)) {
    const asked = askLatexmk(dir);
    out = asked.out || out;
    aux = asked.aux || aux;
  }
  const outDir = out ? path.resolve(dir, out) : null;
  const auxDir = aux ? path.resolve(dir, aux) : outDir;
  const info = { exists, pdfMode: assigned('pdf_mode'), outDir, auxDir };
  cache.set(dir, { key, info });
  return info;
}

// Every path of a document's build output.
export function outputs(doc) {
  const dir = path.dirname(doc);
  const base = path.basename(doc).replace(/\.tex$/, '');
  const rc = rcInfo(dir);
  const auxDir = rc.auxDir || dir;
  const outDir = rc.outDir || dir;
  const a = (ext) => path.join(auxDir, base + ext);
  const o = (ext) => path.join(outDir, base + ext);
  // latexmk copies the PDF and SyncTeX to out_dir; look in aux_dir too in
  // case an older latexmk left them there.
  const pick = (ext) => (fs.existsSync(o(ext)) || !fs.existsSync(a(ext)) ? o(ext) : a(ext));
  return { dir, base, auxDir, outDir, moved: auxDir !== dir || outDir !== dir, aux: a('.aux'), log: a('.log'), fls: a('.fls'), fdb: a('.fdb_latexmk'), bbl: a('.bbl'), pdf: pick('.pdf'), synctex: pick('.synctex.gz') };
}
