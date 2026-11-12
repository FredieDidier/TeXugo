// Submission ZIP: files outside the document folder are pulled in with their
// paths fixed in the copies, and the ZIP compiles alone (as arXiv runs it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildManager } from '../server/build.js';
import { exportZip, rewritePaths, zipLayout } from '../server/submission.js';

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

// A 1x1 PDF figure made by pdflatex itself, so the test needs no other tool.
const FIG = '\\documentclass{standalone}\\begin{document}X\\end{document}\n';

test('ZIP pulls in ../ files, fixes paths, and compiles alone', { timeout: 240000 }, async () => {
  // Inside a folder named tex/: the old name rule dropped every file here.
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-sub-')), 'tex');
  fs.mkdirSync(root);
  const paper = path.join(root, 'paper');
  fs.mkdirSync(paper);
  fs.mkdirSync(path.join(root, 'analysis', 'out'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tables'));
  fs.writeFileSync(path.join(root, 'analysis', 'out', 'fig.tex'), FIG);
  const mgr = new BuildManager();
  await buildOnce(mgr, root, [path.join(root, 'analysis', 'out', 'fig.tex')]);
  assert.ok(fs.existsSync(path.join(root, 'analysis', 'out', 'fig.pdf')));
  fs.writeFileSync(path.join(root, 'tables', 't1.tex'), 'Table body \\label{tab:one}\\includegraphics[width=1cm]{../analysis/out/fig}\n');
  fs.writeFileSync(path.join(paper, 'refs.bib'), '@article{k1, author={A. B}, title={T}, journal={J}, year={2020}}\n');
  const main = path.join(paper, 'main.tex');
  fs.writeFileSync(
    main,
    [
      '\\documentclass{article}',
      '\\usepackage{graphicx}',
      '\\graphicspath{{../analysis/out/}}',
      '\\begin{document}',
      'See \\ref{tab:one} and \\cite{k1}.',
      '\\input{../tables/t1.tex}',
      '\\includegraphics[width=1cm]{fig}',
      `\\includegraphics[width=1cm]{${path.join(root, 'analysis', 'out', 'fig.pdf')}}`,
      '\\bibliographystyle{plain}',
      '\\bibliography{refs}',
      '\\end{document}',
      '',
    ].join('\n'),
  );
  const res = await buildOnce(mgr, root, [main]);
  assert.equal(res.docs[0].status, 'ok', JSON.stringify(res.docs[0].errors));
  const before = fs.readFileSync(main, 'utf8');

  const r = await exportZip(main);
  assert.ok(r.files.includes('main.tex') && r.files.includes('main.bbl'));
  assert.ok(!r.files.includes('refs.bib'), '.bbl replaces .bib');
  assert.ok(r.files.includes('analysis/out/fig.pdf'), r.files.join(','));
  assert.ok(r.files.includes('tables/t1.tex'), r.files.join(','));
  assert.ok(r.files.every((f) => !f.startsWith('..')));
  assert.equal(r.check.ok, true, JSON.stringify(r.check));
  assert.equal(r.check.pages, r.check.origPages);
  assert.equal(fs.readFileSync(main, 'utf8'), before, 'original sources untouched');
});

test('rewritePaths only touches paths to moved files', () => {
  const dir = '/p/paper';
  const files = ['/p/paper/main.tex', '/p/analysis/out/fig.pdf', '/p/fig2.png'];
  for (const f of files) assert.ok(f);
  const { target } = zipLayout('/p/paper/main.tex', files);
  const src = [
    '\\graphicspath{{../analysis/out/}{../}}',
    '\\includegraphics{../analysis/out/fig}',
    '\\includegraphics{/p/analysis/out/fig.pdf}',
    '\\includegraphics{../fig2}',
    '\\input{../other/x.tex} see https://example.org/a/b and/or',
  ].join('\n');
  const { text } = rewritePaths(src, dir, target);
  assert.equal(
    text,
    [
      '\\graphicspath{{analysis/out/}{./}}',
      '\\includegraphics{analysis/out/fig}',
      '\\includegraphics{analysis/out/fig.pdf}',
      '\\includegraphics{fig2}',
      '\\input{../other/x.tex} see https://example.org/a/b and/or',
    ].join('\n'),
  );
});
