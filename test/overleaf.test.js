// The round trip with a coauthor on Overleaf's free plan: the ZIP to
// upload compiles as Overleaf compiles it (latexmk, BibTeX from the .bib),
// it is marked as sent, and the ZIP Overleaf gives back is read against
// that mark: only the coauthor's edits show, the paths fixed in the copies
// do not, and the files that moved inside the ZIP are read from there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildManager } from '../server/build.js';
import { overleafZip, recentDownloads, zipName } from '../server/overleaf.js';
import * as sent from '../server/sent.js';
import { run } from '../server/util.js';
import { zipCommand, unzipCommand } from '../server/platform.js';

function buildOnce(mgr, root, docs) {
  return new Promise((resolve) => {
    const onEv = (e) => {
      if (e.type === 'build:done') {
        mgr.off('event', onEv);
        resolve(e);
      }
    };
    mgr.on('event', onEv);
    mgr.request(root, docs);
  });
}

const FIG = '\\documentclass{standalone}\\begin{document}X\\end{document}\n';

test('ZIP name: the project folder, or its parent for a generic folder name', () => {
  assert.equal(zipName('/a/Cafes Study', '/a/Cafes Study/main.tex'), 'Cafes-Study.zip');
  assert.equal(zipName('/a/CafesStudy/latex', '/a/CafesStudy/latex/main.tex'), 'CafesStudy.zip');
});

test('Overleaf round trip: ZIP out, edits back, read against what was sent', { timeout: 300000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-ol-'));
  const paper = path.join(root, 'paper');
  fs.mkdirSync(paper);
  fs.mkdirSync(path.join(root, 'analysis'));
  fs.mkdirSync(path.join(root, 'tables'));
  fs.writeFileSync(path.join(root, 'analysis', 'fig.tex'), FIG);
  const mgr = new BuildManager();
  await buildOnce(mgr, root, [path.join(root, 'analysis', 'fig.tex')]);
  fs.writeFileSync(path.join(root, 'tables', 't1.tex'), 'Cafes open early near stations.\n');
  fs.writeFileSync(path.join(paper, 'refs.bib'), '@article{k1, author={A. B}, title={T}, journal={J}, year={2020}}\n');
  const main = path.join(paper, 'main.tex');
  fs.writeFileSync(
    main,
    [
      '\\documentclass{article}',
      '\\usepackage{graphicx}',
      '\\graphicspath{{../analysis/}}',
      '\\begin{document}',
      'Cafes cluster near universities, as \\cite{k1} shows.',
      '',
      '\\input{../tables/t1.tex}',
      '\\includegraphics[width=1cm]{fig}',
      '\\bibliographystyle{plain}',
      '\\bibliography{refs}',
      '\\end{document}',
      '',
    ].join('\n'),
  );
  const res = await buildOnce(mgr, root, [main]);
  assert.equal(res.docs[0].status, 'ok', JSON.stringify(res.docs[0].errors));
  assert.ok(fs.existsSync(path.join(paper, 'main.bbl')));

  const out = await overleafZip(root, main, { to: 'Ana' });
  assert.ok(out.check.ok, JSON.stringify(out.check));
  assert.ok(out.zip.startsWith(path.join(paper, '.texugo', 'overleaf')));
  assert.ok(out.files.includes('refs.bib'), out.files.join(','));
  assert.ok(!out.files.includes('main.bbl'), 'Overleaf runs BibTeX: the .bbl stays out');
  assert.ok(out.files.includes('tables/t1.tex'));
  assert.ok(out.files.includes('analysis/fig.pdf'));
  assert.equal(out.tooMany, false);
  assert.equal(out.mark.to, 'Ana');
  assert.deepEqual(out.mark.zipPaths, { '../tables/t1.tex': 'tables/t1.tex' });
  assert.equal(sent.list(root).length, 1);

  // On Overleaf: Ana edits the main text and the table, then downloads the
  // project as a ZIP.
  const ana = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-ol-ana-'));
  assert.equal((await run(...unzipCommand(out.zip, ana))).code, 0);
  const anaMain = path.join(ana, 'main.tex');
  assert.match(fs.readFileSync(anaMain, 'utf8'), /\\input\{tables\/t1\.tex\}/);
  fs.writeFileSync(anaMain, fs.readFileSync(anaMain, 'utf8').replace('near universities', 'near large universities'));
  fs.writeFileSync(path.join(ana, 'tables', 't1.tex'), 'Cafes open very early near stations.\n');
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-ol-dl-'));
  const back = path.join(downloads, 'paper.zip');
  assert.equal((await run(...zipCommand(back, ['main.tex', 'refs.bib', 'tables/t1.tex', 'analysis/fig.pdf']), { cwd: ana })).code, 0);
  assert.deepEqual(recentDownloads({ dir: downloads }).map((f) => f.name), ['paper.zip']);

  // Meanwhile the paper changed here, away from Ana's edits.
  fs.writeFileSync(main, fs.readFileSync(main, 'utf8').replace('\\end{document}', 'A new closing line.\n\\end{document}'));
  const fb = await sent.feedback(root, main, { kind: 'path', path: back }, { from: 'Ana' });
  assert.equal(fb.base.kind, 'sent');
  const what = fb.items.map((s) => `${path.basename(s.file)}:${s.status}:${s.theirs.trim()}`).sort();
  assert.deepEqual(what, ['main.tex:aplica:near large universities', 't1.tex:aplica:open very early'], what.join(' | '));
});
