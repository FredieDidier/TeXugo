// Live preview: an unsaved buffer reaches the PDF, the files on disk and the
// real build outputs stay untouched, and a half-typed command keeps the last
// good preview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveManager, liveDirs, overlayPath, realPath, showable } from '../server/live.js';
import { run } from '../server/util.js';

function liveOnce(mgr, root, doc, buffers, opts) {
  return new Promise((resolve) => {
    const onEv = (e) => {
      if (e.type === 'live:done' && e.doc === doc) {
        mgr.off('event', onEv);
        resolve(e);
      }
    };
    mgr.on('event', onEv);
    mgr.request(root, doc, buffers, opts);
  });
}

const pdfText = async (pdf) => (await run('pdftotext', [pdf, '-'])).stdout;

test('overlay paths map both ways and stay inside the document folder', () => {
  const doc = '/p/paper/main.tex';
  const dirs = liveDirs('/p', doc);
  const o = overlayPath(dirs, doc, '/p/paper/sections/a.tex');
  assert.equal(o, path.join(dirs.src, 'sections/a.tex'));
  assert.equal(realPath(dirs, doc, o), '/p/paper/sections/a.tex');
  assert.equal(overlayPath(dirs, doc, '/p/other/b.tex'), null);
  assert.equal(realPath(dirs, doc, '/usr/x.sty'), '/usr/x.sty');
});

test('a broken pass keeps the last good preview unless the document already had errors', () => {
  assert.equal(showable({ pdfExists: true, errors: [] }), true);
  assert.equal(showable({ pdfExists: true, errors: [{}] }), false);
  assert.equal(showable({ pdfExists: true, errors: [{}], tolerate: true }), true);
  assert.equal(showable({ pdfExists: false, errors: [] }), false);
});

test('live pass compiles unsaved buffers without touching the disk', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-live-'));
  fs.mkdirSync(path.join(dir, 'sections'));
  const doc = path.join(dir, 'paper.tex');
  const main = '\\documentclass{article}\n\\begin{document}\n\\section{Intro}\\label{s:intro}\nSee Section~\\ref{s:body}.\n\\input{sections/body}\n\\end{document}\n';
  fs.writeFileSync(doc, main);
  const body = path.join(dir, 'sections', 'body.tex');
  fs.writeFileSync(body, 'Disk words here. \\section{Body}\\label{s:body}\n');
  const mgr = new LiveManager();

  // Unsaved edit in an \input file.
  const edited = [{ path: body, text: 'Zebra typed live. \\section{Body}\\label{s:body}\n' }];
  let e = await liveOnce(mgr, dir, doc, edited);
  assert.equal(e.ok, true, JSON.stringify(e.errors));
  assert.equal(e.shown, true);
  let txt = await pdfText(e.pdf);
  assert.match(txt, /Zebra typed live/);
  assert.doesNotMatch(txt, /Disk words/);
  assert.equal(fs.readFileSync(body, 'utf8'), 'Disk words here. \\section{Body}\\label{s:body}\n');
  for (const ext of ['.pdf', '.aux', '.log']) assert.equal(fs.existsSync(path.join(dir, 'paper' + ext)), false, ext);

  // A broken first pass of a fresh session must not cost the labels either.
  {
    const m2 = new LiveManager();
    const bad = await liveOnce(m2, dir, doc, [...edited, { path: doc, text: main.replace('See Section', '\\emph{See Section') }]);
    assert.equal(bad.shown, false);
  }

  // Second pass reads the labels of the first: the reference resolves.
  e = await liveOnce(mgr, dir, doc, edited);
  txt = await pdfText(e.pdf);
  assert.match(txt, /See Section 2/);

  // SyncTeX of the live PDF points at the overlay copy.
  const ov = mgr.overlayFor(e.pdf);
  assert.ok(ov && fs.existsSync(overlayPath(ov.dirs, ov.doc, body)));

  // Unsaved main file with a half-typed command: error, previous PDF stays.
  const before = fs.statSync(e.pdf).mtimeMs;
  e = await liveOnce(mgr, dir, doc, [...edited, { path: doc, text: main.replace('See Section', '\\textbf{See Section') }]);
  assert.equal(e.ok, false);
  assert.equal(e.shown, false);
  assert.ok(e.errors.length);
  assert.equal(fs.statSync(path.join(liveDirs(dir, doc).show, 'paper.pdf')).mtimeMs, before);

  // The pass after the broken one still has the labels of the good one.
  e = await liveOnce(mgr, dir, doc, edited);
  assert.match(await pdfText(e.pdf), /See Section 2/);

  // Errors in an unsaved file point at the real file, not the overlay copy.
  e = await liveOnce(mgr, dir, doc, [{ path: body, text: 'Text.\n\nauthorTypo \\undefinedmacro here.\n' }]);
  assert.equal(e.shown, false);
  assert.equal(e.errors[0].file, body);
  assert.equal(e.errors[0].line, 3);
});
