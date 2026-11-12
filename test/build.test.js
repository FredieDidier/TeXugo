// End-to-end check of the build engine on the paper + appendix template:
// compiling only the paper must leave zero undefined references in both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildManager } from '../server/build.js';
import { createFromTemplate } from '../server/templates.js';
import { rootsFor } from '../server/project.js';

function buildOnce(mgr, root, docs, opts) {
  return new Promise((resolve) => {
    const onEv = (e) => {
      if (e.type === 'build:done') {
        mgr.off('event', onEv);
        resolve(e);
      }
    };
    mgr.on('event', onEv);
    mgr.request(root, docs, opts);
  });
}

test('paper + appendix: one click, zero ??', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-'));
  createFromTemplate('artigo-apendice', dir, { title: 'Test', author: 'A' });
  const paper = path.join(dir, 'paper.tex');
  const mgr = new BuildManager();
  const res = await buildOnce(mgr, dir, [paper]);
  assert.equal(res.docs.length, 2, 'appendix must be pulled into the build');
  for (const d of res.docs) {
    assert.equal(d.errors.length, 0, `${d.name} errors: ${JSON.stringify(d.errors)}`);
    assert.equal(d.undefinedRefs.length, 0, `${d.name} undefined: ${JSON.stringify(d.undefinedRefs)}`);
    assert.equal(d.undefinedCites.length, 0, `${d.name} cites: ${JSON.stringify(d.undefinedCites)}`);
    assert.ok(d.pdf, `${d.name} pdf`);
  }
  // Deleting the aux files (what broke the paper under Lattice) and building
  // again must still give zero ??.
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.aux') || f.endsWith('.fdb_latexmk')) fs.rmSync(path.join(dir, f));
  const res2 = await buildOnce(mgr, dir, [paper]);
  for (const d of res2.docs) assert.equal(d.undefinedRefs.length, 0, `${d.name} after aux wipe`);
  // The section file belongs to the paper.
  assert.deepEqual(rootsFor(dir, path.join(dir, 'sections', 'body.tex')), [paper]);
});

test('broken document reports file and line', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-'));
  const f = path.join(dir, 'main.tex');
  fs.writeFileSync(f, '\\documentclass{article}\n\\begin{document}\nHello \\foo{} world.\n\\end{document}\n');
  const mgr = new BuildManager();
  const res = await buildOnce(mgr, dir, [f]);
  const d = res.docs[0];
  assert.equal(d.status, 'error');
  assert.equal(d.errors[0].line, 3);
  assert.equal(d.errors[0].file, f);
  assert.match(d.errors[0].hint, /Comando desconhecido/);
});

// B4: a latexmkrc that does not set $pdf_mode must still give a PDF, and one
// that moves the output ($out_dir) must still have its log read.
function rcProject(rc, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-rc-'));
  fs.writeFileSync(path.join(dir, '.latexmkrc'), rc);
  fs.writeFileSync(path.join(dir, 'paper.tex'), `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`);
  return path.join(dir, 'paper.tex');
}

test('latexmkrc without $pdf_mode still gives a PDF', { timeout: 60000 }, async () => {
  const paper = rcProject('$bibtex_use = 2;\n', 'Hello.');
  const res = await buildOnce(new BuildManager(), path.dirname(paper), [paper]);
  assert.ok(res.docs[0].pdf, JSON.stringify(res.docs[0]));
  assert.equal(res.docs[0].status, 'ok');
});

test('latexmkrc with $out_dir: log read, ?? counted', { timeout: 60000 }, async () => {
  const paper = rcProject('$out_dir = "build";\n', 'See \\ref{missing}.');
  const res = await buildOnce(new BuildManager(), path.dirname(paper), [paper]);
  const d = res.docs[0];
  assert.ok(d.pdf && d.pdf.includes(`${path.sep}build${path.sep}`), JSON.stringify(d));
  assert.equal(d.undefinedRefs.length, 1);
  assert.notEqual(d.status, 'ok');
});
