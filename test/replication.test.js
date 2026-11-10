import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as replication from '../server/replication.js';
import { JOURNALS, journalById } from '../server/replication-journals.js';

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-repl-'));
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  w('README.md', '# Replication\n\n## Data Availability and Provenance Statements\n\nPublic.\n\n## Computational requirements\n\nR 4.4.\n\n## Instructions to Replicators\n\nRun main.R.\n');
  w('config/00_master_build.R', 'source("code/clean.R")\n');
  w('main.R', 'source("code/clean.R")\nsource("code/analysis.R")\n');
  w('code/clean.R', 'library(data.table)\nraw <- fread("/Users/someone/Dropbox/project/raw.csv")\n# setwd("/Users/someone/old") is only a comment\nfwrite(raw, "data/clean.csv")\n');
  w('code/analysis.R', 'library(fixest)\nset.seed(20261110)\nb <- sample(1:10)\nggplot2::ggsave("output/fig_trend.pdf")\nwriteLines(etable(m), "output/tab_main.tex")\n');
  w('code/boot.do', '* bootstrap without a seed\nbsample 100\nreg y x\ngraph export "$out/fig_event.pdf", replace\n');
  w('code/model.py', 'import numpy as np\nimport os\nx = np.random.normal(size=10)\n');
  w('data/clean.csv', 'a,b\n1,2\n');
  w('data/panel.dta', 'x'.repeat(2000));
  w('.DS_Store', '');
  w('latex/paper.tex', '\\documentclass{article}\\usepackage{graphicx}\\begin{document}\n\\includegraphics{../output/fig_trend}\n\\includegraphics{../output/fig_hand}\n\\input{../output/tab_main}\n\\bibliography{refs}\\end{document}\n');
  w('latex/refs.bib', '@misc{census2020, title={Census microdata 2020}, author={Office}, year={2020}}\n@article{paper1, title={A paper}, author={A}, journal={J}, year={2020}}\n');
  w('output/fig_trend.pdf', '%PDF-1.4');
  w('output/fig_hand.pdf', '%PDF-1.4');
  w('output/tab_main.tex', '\\begin{tabular}{lc}\\toprule a & b \\\\ \\bottomrule\\end{tabular}\n');
  return root;
}

test('the scan finds README sections, code, seeds, paths, data and exhibits', async () => {
  const root = project();
  const s = await replication.scan(root, { doc: path.join(root, 'latex/paper.tex') });
  assert.equal(s.readme.rel, 'README.md');
  assert.equal(s.readme.sections.availability, true);
  assert.equal(s.readme.sections.requirements, true);
  assert.equal(s.readme.sections.instructions, true);
  assert.equal(s.readme.sections.exhibits, false);
  assert.equal(s.license, null);
  assert.deepEqual(s.byLang, { R: 4, Stata: 1, Python: 1 });
  assert.deepEqual(s.masters.sort(), ['config/00_master_build.R', 'main.R']);
  // The absolute path in code counts; the one in a comment does not.
  assert.equal(s.absCount, 1);
  assert.equal(s.absPaths[0].rel, 'code/clean.R');
  assert.equal(s.absPaths[0].line, 2);
  // R seeds its draws; Stata and Python draw without a seed.
  assert.equal(s.rng.seeds.length, 1);
  assert.equal(s.rng.seeds[0].line, 2);
  assert.deepEqual(s.rng.uses.map((u) => u.rel).sort(), ['code/analysis.R', 'code/boot.do', 'code/model.py']);
  assert.deepEqual(s.rng.unseeded.sort(), ['code/boot.do', 'code/model.py']);
  assert.deepEqual(s.packages.R, ['data.table', 'fixest', 'ggplot2']);
  assert.deepEqual(s.packages.Python, ['numpy']);
  assert.equal(s.data.count, 2);
  assert.deepEqual(s.data.closed, ['data/panel.dta']);
  assert.deepEqual(s.junk, ['.DS_Store']);
  // Which script writes each table and figure of the paper.
  const by = Object.fromEntries(s.exhibits.map((x) => [x.rel, x.by]));
  assert.deepEqual(by['output/fig_trend.pdf'], ['code/analysis.R']);
  assert.deepEqual(by['output/tab_main.tex'], ['code/analysis.R']);
  assert.deepEqual(by['output/fig_hand.pdf'], []);
  assert.equal(s.exhibits.find((x) => x.rel === 'output/tab_main.tex').kind, 'table');
  assert.deepEqual(s.dataCites.map((c) => c.key), ['census2020']);
});

test('the README draft fills what the folder shows and is never written over a README', async () => {
  const root = project();
  const text = await replication.draftReadme(root, { doc: path.join(root, 'latex/paper.tex'), title: 'Cafés and Commutes', authors: 'Ana Silva', journal: journalById('es') });
  assert.match(text, /^# Replication package for: Cafés and Commutes/);
  assert.match(text, /master script `(main\.R|config\/00_master_build\.R)`/);
  assert.match(text, /Random seed is set at line 2 of program `code\/analysis.R`/);
  assert.match(text, /\| `code\/analysis.R` \| `output\/fig_trend.pdf`/);
  assert.match(text, /`data.table`, `fixest`, `ggplot2`/);
  assert.match(text, /as a PDF/);
  const file = replication.saveReadme(root, text);
  assert.equal(path.basename(file), 'README-rascunho.md');
  assert.throws(() => replication.saveReadme(root, text), /já existe/);
});

test('ticks and journal are saved, and anything odd is dropped', () => {
  const root = project();
  const st = replication.saveState(root, { journal: 'qje', manual: { rights: 'ok', ethics: 'na', bad: 'yes', '../x': 'ok' } });
  assert.deepEqual(st, { journal: 'qje', manual: { rights: 'ok', ethics: 'na' } });
  assert.deepEqual(replication.loadState(root), st);
  assert.ok(JOURNALS.every((j) => j.id && j.name && j.repo && j.repoUrl.startsWith('https://') && j.when));
  assert.equal(replication.bucketOf(10e6), '< 25 MB');
  assert.equal(replication.bucketOf(3e9), '2 GB – 25 GB');
});
