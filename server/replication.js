// "Pacote de replicação": reads the project folder the way a journal's Data
// Editor would, against the Data and Code Availability Standard (DCAS) and the
// Social Science Data Editors' README template. What the folder can tell
// (a README and its sections, a license, code by language, a master script,
// absolute paths, random numbers without a seed, dependency files, data files
// and their size, which tables and figures of the paper some script writes)
// is checked here; what only the authors know (rights to the data, a clean
// run, ethics approval) is a box they tick in the page. The ticks and the
// chosen journal live in .texugo/replication.json, outside Git.
import fs from 'node:fs';
import path from 'node:path';
import { sourceFiles } from './submission.js';
import { parseBib, texToText } from './bibparse.js';
import { run } from './util.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.texugo', '.Rproj.user', '__pycache__', '.venv', 'venv', '.ipynb_checkpoints', '.mypy_cache', '.pytest_cache', '.quarto', 'renv', '.idea', '.vscode']);
const LANGS = [
  [/\.(R|r|Rmd|rmd|qmd)$/, 'R'],
  [/\.(do|ado)$/, 'Stata'],
  [/\.(py|ipynb)$/, 'Python'],
  [/\.jl$/, 'Julia'],
  [/\.m$/, 'MATLAB'],
  [/\.sas$/, 'SAS'],
  [/\.sql$/, 'SQL'],
  [/\.(sh|bash|zsh)$/, 'Shell'],
  [/\.(f90|f95|f)$/, 'Fortran'],
];
const DATA_EXT = /\.(csv|tsv|txt\.gz|csv\.gz|dta|rds|rdata|rda|parquet|feather|arrow|xlsx|xls|sav|sas7bdat|xpt|dbf|shp|gpkg|geojson|nc|h5|hdf5|mat|fst|qs|json\.gz|zip|7z)$/i;
// Formats only one commercial program reads well (DCAS rule 4; the
// Econometric Society asks for an open copy of these).
const PROPRIETARY = /\.(dta|sav|sas7bdat|mat|xlsx?)$/i;
const IMAGE_EXT = /\.(pdf|png|jpe?g|eps|svg)$/i;
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.Rhistory|~\$[^/]*|[^/]*\.(swp|tmp|bak))$/i;
const MASTER = /^(\d+[_-]?)?(master|main|run[_-]?all|runall|replicate|replication)([_-]\w+)?\.(R|do|py|sh|jl|m)$|^(run|make)\.(R|do|py|sh|jl|m)$|^(Makefile|Snakefile|_targets\.R|dvc\.yaml|justfile)$/i;
const DEPS = /^(renv\.lock|DESCRIPTION|requirements(-[\w]+)?\.txt|environment\.ya?ml|Pipfile(\.lock)?|pyproject\.toml|poetry\.lock|uv\.lock|conda-lock\.yml|Project\.toml|Manifest\.toml|setup\.do|config\.do|_config\.do)$/i;
const MAX_FILES = 20000;
const MAX_READ = 2 * 1024 * 1024;

// Storage buckets of the README template.
const BUCKETS = [
  [25e6, '< 25 MB'],
  [250e6, '25 MB – 250 MB'],
  [2e9, '250 MB – 2 GB'],
  [25e9, '2 GB – 25 GB'],
  [250e9, '25 GB – 250 GB'],
  [Infinity, '> 250 GB'],
];
export const bucketOf = (bytes) => BUCKETS.find(([max]) => bytes < max)[1];

const langOf = (name) => (LANGS.find(([re]) => re.test(name)) || [])[1] || null;

// A line without its comment, per language (good enough for scanning: a #
// inside a string is rare in research code).
function codeLine(lang, line) {
  const t = line.trim();
  if (lang === 'Stata') {
    if (t.startsWith('*') || t.startsWith('//')) return '';
    return line.replace(/\s\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
  }
  if (lang === 'MATLAB') return t.startsWith('%') ? '' : line.replace(/%.*$/, '');
  if (lang === 'SQL') return line.replace(/--.*$/, '');
  if (lang === 'Fortran') return t.startsWith('!') ? '' : line;
  return t.startsWith('#') ? '' : line.replace(/\s#.*$/, '');
}

// Code cells of a notebook as lines.
function notebookLines(text) {
  try {
    const nb = JSON.parse(text);
    return (nb.cells || []).filter((c) => c.cell_type === 'code').flatMap((c) => (Array.isArray(c.source) ? c.source.join('') : String(c.source || '')).split('\n'));
  } catch {
    return [];
  }
}

// A path that only exists on the author's machine.
const ABS = /(?:^|[\s"'(=,])((?:\/Users|\/home|\/Volumes|\/mnt\/[a-z])\/[^\s"'),;]+|[A-Za-z]:[\\/][^\s"'),;]*|~\/[^\s"'),;]+)/;

const SEED = {
  R: /\bset\.seed\s*\(|\bRNGkind\s*\(|\bseed\s*=\s*\d/,
  Stata: /^\s*(set\s+seed|set\s+rngstream)\b|\bseed\s*\(\s*\d/,
  Python: /\b(np|numpy)\.random\.seed\s*\(|\brandom\.seed\s*\(|default_rng\s*\(\s*\d|\b(seed|random_state)\s*=\s*\d|manual_seed\s*\(|set_seed\s*\(|\bPYTHONHASHSEED\b/,
  Julia: /Random\.seed!\s*\(|\bseed!\s*\(|StableRNG\s*\(\s*\d|MersenneTwister\s*\(\s*\d/,
  MATLAB: /\brng\s*\(\s*['"]?\w/,
};
const RNG = {
  R: /\b(runif|rnorm|rbinom|rpois|rexp|rgamma|rbeta|rmultinom|mvrnorm|rmvnorm|sample|sample_n|sample_frac|slice_sample|boot|bootstrap|createDataPartition|randomForest|ranger|kmeans|permute)\s*\(/,
  Stata: /\b(runiform|rnormal|rbinomial|rpoisson|rbeta|rgamma|rchi2|rt|rexponential)\s*\(|^\s*(bsample|bootstrap|permute|simulate|ritest|boottest)\b|^\s*sample\s+\d|vce\s*\(\s*(boot|bootstrap)/,
  Python: /\b(np|numpy)\.random\.\w+\s*\(|\brandom\.(random|randint|choice|choices|shuffle|sample|uniform|gauss|normalvariate)\s*\(|default_rng\s*\(|torch\.(rand|randn|randint|randperm)\s*\(|train_test_split\s*\(|\b(KMeans|RandomForest\w*|GradientBoosting\w*|bootstrap)\s*\(/,
  Julia: /\b(rand|randn|randperm|shuffle!?|sample)\s*\(/,
  MATLAB: /\b(rand|randn|randi|randperm|datasample|bootstrp)\s*\(/,
};
const PKG = {
  R: [/\b(?:library|require|requireNamespace)\s*\(\s*["']?([A-Za-z][\w.]*)/g, /\b([A-Za-z][\w.]*)::/g],
  Python: [/^\s*import\s+([A-Za-z_][\w]*)/g, /^\s*from\s+([A-Za-z_][\w]*)[\w.]*\s+import\b/g],
  Stata: [/\b(?:ssc|net)\s+install\s+([A-Za-z_]\w*)/g],
  Julia: [/^\s*using\s+([A-Za-z]\w*)/g, /^\s*import\s+([A-Za-z]\w*)/g],
};
const PY_STD = new Set(['os', 'sys', 're', 'json', 'math', 'time', 'datetime', 'random', 'pathlib', 'itertools', 'functools', 'collections', 'subprocess', 'glob', 'shutil', 'pickle', 'csv', 'typing', 'warnings', 'logging', 'argparse', 'string', 'copy', 'io', 'gzip', 'zipfile', 'tempfile', 'statistics', 'dataclasses', 'textwrap', 'hashlib', 'urllib', 'concurrent', 'multiprocessing', 'unicodedata', 'decimal', 'fractions', 'operator', 'abc', 'enum', 'contextlib', 'traceback', 'platform', 'getpass', 'socket', 'base64', 'struct', 'threading', 'queue', 'heapq', 'bisect', 'calendar', 'locale', 'uuid', 'inspect', 'importlib', 'pprint', 'sqlite3', 'xml', 'html', 'http', 'email', 'tarfile', 'codecs', 'ast', 'types', 'weakref', 'gc', 'signal', 'shlex', 'secrets', 'numbers', 'cmath', '__future__']);
const R_BASE = new Set(['base', 'stats', 'utils', 'methods', 'graphics', 'grDevices', 'datasets', 'tools', 'parallel', 'grid', 'splines', 'stats4', 'compiler']);

// Every file of the package folder, with size; skips tool and system folders.
function walk(root) {
  const files = [];
  let total = 0;
  let truncated = false;
  (function rec(dir) {
    if (files.length >= MAX_FILES) return void (truncated = true);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.endsWith('.Rcheck')) continue;
        rec(abs);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(abs).size;
        } catch {}
        total += size;
        files.push({ abs, rel: path.relative(root, abs).split(path.sep).join('/'), name: e.name, size });
        if (files.length >= MAX_FILES) return void (truncated = true);
      }
    }
  })(root);
  return { files, total, truncated };
}

// README sections, found by their headings (Markdown or plain text) or, for a
// PDF, by its text. Keys follow the Data Editors' template.
const SECTIONS = {
  availability: /data\s+availability|availability\s+(and|&)\s+provenance|data\s+(and|&)\s+code\s+availability|disponibilidade\s+dos\s+dados/i,
  datasets: /dataset\s+list|data\s+sources?|details\s+on\s+each\s+data\s+source|lista\s+(das\s+)?bases/i,
  requirements: /computational\s+requirements|software\s+requirements|requisitos\s+computacionais/i,
  runtime: /run\s*-?\s*time|time\s+to\s+reproduce|wall[- ]clock|tempo\s+de\s+execu/i,
  programs: /description\s+of\s+(programs|code)|programs?\s*\/\s*code|descri[cç][aã]o\s+(dos\s+)?(programas|c[oó]digos)/i,
  instructions: /instructions\s+(to|for)\s+replicators|instructions|how\s+to\s+(run|replicate)|instru[cç][oõ]es/i,
  exhibits: /list\s+of\s+tables|tables\s+and\s+(figures|programs)|lista\s+de\s+tabelas/i,
  references: /^#*\s*references|data\s+citations?|bibliograph|refer[eê]ncias/im,
  rights: /statement\s+about\s+rights|rights\s+to|permission\s+to|direitos/i,
};

async function readmeText(file) {
  if (/\.pdf$/i.test(file)) {
    const r = await run('pdftotext', ['-layout', file, '-'], { timeout: 20000 });
    return r.code === 0 ? r.stdout : '';
  }
  try {
    return fs.readFileSync(file, 'utf8').slice(0, MAX_READ);
  } catch {
    return '';
  }
}

// Bibliography entries that look like datasets (DCAS rule 6: cite the data).
function dataCitations(bibFiles) {
  const out = [];
  for (const f of bibFiles) {
    let entries = [];
    try {
      entries = parseBib(fs.readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    for (const e of entries) {
      const fl = e.fields || {};
      const blob = `${fl.title || ''} ${fl.howpublished || ''} ${fl.note || ''} ${fl.publisher || ''}`;
      if (e.type === 'dataset' || e.type === 'data' || (['misc', 'online', 'electronic', 'techreport', 'manual'].includes(e.type) && /\b(data|dataset|database|microdata|survey|census|panel|registry|dados|microdados|censo|pesquisa nacional)\b/i.test(blob))) out.push({ key: e.key, title: (fl.title || '').replace(/[{}]/g, '').slice(0, 120) });
    }
  }
  return out;
}

// The paper's tables and figures that come from files: images it includes
// and \input'ed .tex files that hold a tabular.
function exhibitsOf(doc) {
  if (!doc) return [];
  let files = [];
  try {
    files = sourceFiles(doc);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (f === doc || /\.(bbl|aux|bib|cls|sty|bst)$/i.test(f)) continue;
    if (IMAGE_EXT.test(f)) out.push({ abs: f, kind: 'figure' });
    else if (/\.tex$/i.test(f)) {
      let t = '';
      try {
        t = fs.readFileSync(f, 'utf8').slice(0, 200000);
      } catch {}
      if (/\\begin\{(tabular\*?|tabularx|longtable|threeparttable|table)\}|\\toprule|\\midrule/.test(t) && !/\\section\*?\{/.test(t)) out.push({ abs: f, kind: 'table' });
    }
  }
  return out;
}

const cap = (arr, n = 50) => arr.slice(0, n);

export async function scan(root, { doc = null } = {}) {
  root = path.resolve(root);
  const { files, total, truncated } = walk(root);
  const top = files.filter((f) => !f.rel.includes('/'));

  // README and license at the package root.
  const readmes = top.filter((f) => /^readme(\.(md|markdown|txt|pdf|rst|html|tex))?$/i.test(f.name));
  const readmeFile = readmes.find((f) => /\.pdf$/i.test(f.name)) || readmes.find((f) => /\.(md|markdown)$/i.test(f.name)) || readmes[0] || null;
  let readme = null;
  if (readmeFile) {
    const text = await readmeText(readmeFile.abs);
    const sections = {};
    for (const [k, re] of Object.entries(SECTIONS)) sections[k] = re.test(text);
    readme = { rel: readmeFile.rel, all: readmes.map((f) => f.rel), pdf: readmes.some((f) => /\.pdf$/i.test(f.name)), sections, words: (text.match(/\S+/g) || []).length, todos: (text.match(/\bTODO\b/g) || []).length };
  }
  const license = top.find((f) => /^(license|licence|copying)(\.(md|txt))?$/i.test(f.name)) || null;

  // Code: languages, master script, absolute paths, randomness, packages.
  const code = [];
  const byLang = {};
  const absPaths = [];
  const rngUses = [];
  const seeds = [];
  const packages = {};
  const outputsText = []; // code text, to find which script writes an exhibit
  for (const f of files) {
    const lang = langOf(f.name);
    if (!lang || f.size > MAX_READ) continue;
    let text = '';
    try {
      text = fs.readFileSync(f.abs, 'utf8');
    } catch {
      continue;
    }
    const lines = f.name.endsWith('.ipynb') ? notebookLines(text) : text.split('\n');
    code.push({ rel: f.rel, lang, lines: lines.length });
    byLang[lang] = (byLang[lang] || 0) + 1;
    outputsText.push({ rel: f.rel, text: f.name.endsWith('.ipynb') ? lines.join('\n') : text });
    lines.forEach((raw, i) => {
      const line = codeLine(lang, raw);
      if (!line.trim()) return;
      const at = { rel: f.rel, abs: f.abs, line: f.name.endsWith('.ipynb') ? null : i + 1, text: raw.trim().slice(0, 160) };
      const a = ABS.exec(line);
      if (a) absPaths.push({ ...at, path: a[1] });
      if (SEED[lang] && SEED[lang].test(line)) seeds.push(at);
      else if (RNG[lang] && RNG[lang].test(line)) rngUses.push(at);
      for (const re of PKG[lang] || []) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          const name = m[1];
          if (lang === 'Python' && PY_STD.has(name)) continue;
          if (lang === 'R' && R_BASE.has(name)) continue;
          (packages[lang] = packages[lang] || new Set()).add(name);
        }
      }
    });
  }
  const masters = files.filter((f) => MASTER.test(f.name) && f.rel.split('/').length <= 2).map((f) => f.rel).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const deps = files.filter((f) => DEPS.test(f.name) && f.rel.split('/').length <= 3).map((f) => f.rel);
  const adoDirs = [...new Set(files.filter((f) => /(^|\/)ado\/.+\.ado$/i.test(f.rel)).map((f) => f.rel.replace(/\/ado\/.*$/i, '/ado').replace(/^ado\/.*$/i, 'ado')))];

  // Data files.
  const data = files.filter((f) => DATA_EXT.test(f.name));
  const dataFiles = data.map((f) => ({ rel: f.rel, size: f.size, open: !PROPRIETARY.test(f.name) }));
  const dataBytes = dataFiles.reduce((s, f) => s + f.size, 0);
  const closedOnly = dataFiles.filter((f) => !f.open);

  // Tables and figures of the paper, and the script that names each one.
  const exhibits = exhibitsOf(doc).map((x) => {
    const base = path.basename(x.abs);
    const stem = base.replace(/\.[^.]+$/, '');
    const re = new RegExp(`(^|[^\\w.-])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[A-Za-z]+)?(["'\\s),]|$)`, 'm');
    const by = outputsText.filter((c) => re.test(c.text)).map((c) => c.rel);
    return { rel: path.relative(root, x.abs).split(path.sep).join('/'), abs: x.abs, kind: x.kind, by };
  });

  const bibs = files.filter((f) => /\.bib$/i.test(f.name)).map((f) => f.abs);
  const big = files.filter((f) => f.size > 2e9).map((f) => ({ rel: f.rel, size: f.size }));

  return {
    root,
    truncated,
    fileCount: files.length,
    total,
    bucket: bucketOf(total),
    readme,
    license: license ? license.rel : null,
    code: cap(code, 400),
    byLang,
    masters,
    deps,
    adoDirs,
    packages: Object.fromEntries(Object.entries(packages).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b))])),
    absPaths: cap(absPaths, 100),
    absCount: absPaths.length,
    rng: {
      uses: cap(rngUses, 30),
      count: rngUses.length,
      seeds: cap(seeds, 30),
      // Files that draw random numbers and set no seed of their own.
      unseeded: [...new Set(rngUses.map((u) => u.rel))].filter((rel) => !seeds.some((x) => x.rel === rel)),
    },
    data: { files: cap(dataFiles.sort((a, b) => b.size - a.size), 300), count: dataFiles.length, bytes: dataBytes, closed: cap(closedOnly, 50).map((f) => f.rel), closedCount: closedOnly.length },
    exhibits,
    dataCites: dataCitations(bibs),
    junk: cap(files.filter((f) => JUNK.test(f.rel)).map((f) => f.rel), 50),
    big,
  };
}

// ------------------------------------------------------------ saved state

const stateFile = (root) => path.join(root, '.texugo', 'replication.json');
export function loadState(root) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(root), 'utf8'));
  } catch {
    return { journal: null, manual: {} };
  }
}
export function saveState(root, state) {
  const clean = { journal: typeof state.journal === 'string' ? state.journal.slice(0, 40) : null, manual: {} };
  for (const [k, v] of Object.entries(state.manual || {})) if (/^[a-z]{2,20}$/.test(k) && ['ok', 'na'].includes(v)) clean.manual[k] = v;
  fs.mkdirSync(path.dirname(stateFile(root)), { recursive: true });
  fs.writeFileSync(stateFile(root), JSON.stringify(clean, null, 2) + '\n');
  return clean;
}

// ------------------------------------------------------------ README draft

// Versions installed on this Mac, offered as a starting point in the draft.
async function versions(langs) {
  const probes = {
    R: ['Rscript', ['--version']],
    Python: ['python3', ['--version']],
    Julia: ['julia', ['--version']],
  };
  const out = {};
  await Promise.all(
    langs.map(async (l) => {
      if (!probes[l]) return;
      const r = await run(probes[l][0], probes[l][1], { timeout: 8000 });
      const m = /(\d+\.\d+(\.\d+)?)/.exec(r.stdout + r.stderr);
      if (r.code === 0 && m) out[l] = m[1];
    }),
  );
  return out;
}

const mdEscape = (s) => String(s).replace(/\|/g, '\\|');

// A README in the shape of the Data Editors' template, filled with what the
// folder shows and with clear TODOs for what only the authors know. English:
// that is what the journals read.
export async function draftReadme(root, { doc = null, title = '', authors = '', journal = null } = {}) {
  const s = await scan(root, { doc });
  if (doc && (!title || !authors)) {
    let tex = '';
    try {
      tex = fs.readFileSync(doc, 'utf8');
    } catch {}
    const arg = (cmd) => {
      const m = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\])?\\s*\\{`).exec(tex);
      if (!m) return '';
      let i = m.index + m[0].length;
      let depth = 1;
      const start = i;
      while (i < tex.length && depth) depth += tex[i] === '{' ? 1 : tex[i] === '}' ? -1 : 0, i++;
      return tex.slice(start, i - 1);
    };
    const plain = (x) => texToText(x.replace(/\\thanks\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '').replace(/\\and\b/g, ', ').replace(/\\\\/g, ' ')).replace(/\\[a-zA-Z]+\*?/g, '').replace(/[{}~]/g, ' ').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
    title = title || plain(arg('title'));
    authors = authors || plain(arg('author'));
  }
  const langs = Object.keys(s.byLang).sort((a, b) => s.byLang[b] - s.byLang[a]);
  const ver = await versions(langs);
  const L = [];
  const p = (...xs) => L.push(...xs);
  p(`# Replication package for: ${title || 'TODO: paper title'}`, '', `Authors: ${authors || 'TODO'}`, '');
  p('## Overview', '', `The code in this package constructs the analysis files from the original data sources and produces all tables and figures of the paper. ${s.masters.length ? `The master script \`${s.masters[0]}\` runs everything` : 'TODO: name the script that runs everything'}. TODO: expected run time (see below).`, '');
  p('## Data Availability and Provenance Statements', '');
  p('### Statement about Rights', '', '- [ ] The authors have legitimate access to, and permission to use, the data used in this manuscript.', '- [ ] The authors have documented permission to redistribute and publish the data included in this package (see the LICENSE file).', '');
  p('### Summary of Availability', '', '- [ ] All data **are** publicly available.', '- [ ] Some data **cannot be made** publicly available.', '- [ ] **No data can be made** publicly available.', '');
  p('### Details on each Data Source', '', 'TODO: for each source, say who provides it, how to obtain it (URL, registration, cost), when it was accessed, its license, and cite it in the References below.', '');
  if (s.dataCites.length) p('Data citations found in the bibliography: ' + s.dataCites.map((c) => `\`${c.key}\``).join(', ') + '.', '');
  p('## Dataset list', '', '| Data file | Source | Notes | Provided |', '|---|---|---|---|');
  for (const f of s.data.files.slice(0, 60)) p(`| \`${mdEscape(f.rel)}\` | TODO | ${fmtSize(f.size)} | Yes |`);
  if (!s.data.files.length) p('| TODO | | | |');
  if (s.data.count > 60) p(`| … and ${s.data.count - 60} more files | | | |`);
  p('', '## Computational requirements', '', '### Software Requirements', '');
  for (const l of langs) {
    p(`- ${l}${ver[l] ? ` ${ver[l]} (the version on the machine that produced this draft; confirm)` : ' (TODO: version)'}`);
    const pk = s.packages[l] || [];
    if (pk.length) p(`  - ${l === 'Stata' ? 'Packages installed from SSC/net' : 'Packages'}: ${pk.slice(0, 60).map((x) => `\`${x}\``).join(', ')}${pk.length > 60 ? ', …' : ''}`);
  }
  if (!langs.length) p('- TODO: software and version');
  if (s.deps.length) p('', `Dependencies are recorded in ${s.deps.map((d) => `\`${d}\``).join(', ')}.`);
  p('', '### Controlled Randomness', '');
  if (s.rng.seeds.length) p(`- [x] Random seed is set at line ${s.rng.seeds[0].line || '?'} of program \`${s.rng.seeds[0].rel}\`${s.rng.seeds.length > 1 ? ` (and ${s.rng.seeds.length - 1} more place${s.rng.seeds.length > 2 ? 's' : ''})` : ''}.`);
  else if (s.rng.count) p('- [ ] Random seed is set at line ___ of program ___ (TODO: the code draws random numbers but no seed was found).');
  else p('- [x] The analysis uses no pseudo-random number generator.');
  p('', '### Memory, Runtime, Storage Requirements', '', 'TODO: time to reproduce on a standard desktop machine, and the machine used (OS, CPU, memory).', '', `Approximate storage space needed: ${s.bucket} (the package folder is ${fmtSize(s.total)}).`, '');
  p('## Description of programs/code', '');
  for (const c of s.code.slice(0, 80)) p(`- \`${c.rel}\`: TODO`);
  if (!s.code.length) p('TODO');
  p('', '### License for Code', '', s.license ? `See \`${s.license}\`.` : 'TODO: add a LICENSE file (for example MIT for code and CC-BY 4.0 for data you own).', '');
  p('## Instructions to Replicators', '', s.masters.length ? `- Run \`${s.masters[0]}\` from the root of this package. It runs all programs in order.` : '- TODO: the order in which to run the programs, or a master script that runs all of them.', s.absCount ? `- TODO: ${s.absCount} absolute path${s.absCount > 1 ? 's' : ''} in the code (first: \`${s.absPaths[0].rel}:${s.absPaths[0].line || '?'}\`); make them relative to the package root before depositing.` : '- Paths are relative to the package root: no file paths need to be changed.', '');
  p('## List of tables and programs', '', 'The provided code reproduces:', '', '- [ ] All numbers provided in text in the paper', '- [ ] All tables and figures in the paper', '', '| Figure/Table | Program | Output file | Note |', '|---|---|---|---|');
  for (const x of s.exhibits) p(`| TODO: ${x.kind === 'figure' ? 'Figure' : 'Table'} | ${x.by.length ? x.by.map((b) => `\`${mdEscape(b)}\``).join(', ') : 'TODO'} | \`${mdEscape(x.rel)}\` | |`);
  if (!s.exhibits.length) p('| TODO | | | |');
  p('', '## References', '', 'TODO: cite every data source, in the same form as in the paper.', '');
  p('---', '', `Structure follows the Social Science Data Editors' template README (https://social-science-data-editors.github.io/template_README/).${journal && journal.readmePdf ? ' This journal asks for the README as a PDF: export it before submitting.' : ''}`, '');
  return L.join('\n');
}

export function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

// Writes the draft next to the package root without overwriting a README.
export function saveReadme(root, text) {
  const target = fs.existsSync(path.join(root, 'README.md')) ? 'README-rascunho.md' : 'README.md';
  const file = path.join(root, target);
  if (fs.existsSync(file)) throw new Error(`${target} já existe: apague ou renomeie antes de gerar outro.`);
  fs.writeFileSync(file, text);
  return file;
}
