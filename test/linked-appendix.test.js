// Parecer and Resposta aos pareceristas read the online appendix linked to
// the paper by \externaldocument (the "Artigo + apêndice" template), not only
// the files the paper inputs: its text goes to the agent, its changes are in
// the diff, and a change in it gets its page from the appendix's own PDF.
// The agent is a stand-in `claude` first on the PATH that keeps the prompt
// and prints a fixed answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-linked-'));
process.env.TEXUGO_DATA_DIR = path.join(tmp, 'data');
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
const out = path.join(tmp, 'out.json');
const seen = path.join(tmp, 'prompt.txt');
fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\ncat > "${seen}"\ncat "${out}"\n`, { mode: 0o755 });
process.env.PATH = bin + path.delimiter + process.env.PATH;
const { makeRefereeProject } = await import('./fixtures/referees/make.mjs');
const { review } = await import('../server/review.js');
const { respond } = await import('../server/rr.js');
const { which } = await import('../server/util.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const answer = (data) => fs.writeFileSync(out, JSON.stringify({ type: 'result', is_error: false, result: `<texugo>${JSON.stringify(data)}</texugo>` }));
const skip = process.platform === 'win32' ? 'the stand-in is a shell script' : false;
const QUOTE = 'Moving every opening one year earlier, to months in which no dock existed';

test('Parecer: the linked appendix goes to the agent, and a point on it lands in appendix.tex', { skip }, async () => {
  const { proj, doc } = await makeRefereeProject(fs.mkdtempSync(path.join(tmp, 'r-')));
  answer({ summary: 'S.', recommendation: 'minor revision', points: [{ kind: 'minor', title: 'Placebo', comment: 'C.', suggestion: '', file: 'appendix.tex', line: 1, quote: QUOTE }] });
  const rep = await review({ root: proj, doc, agent: 'claude' });
  const prompt = fs.readFileSync(seen, 'utf8');
  assert.match(prompt, /<file path="appendix\.tex">\n1\| /);
  assert.ok(prompt.includes(QUOTE));
  assert.equal(rep.points[0].file, path.join(proj, 'appendix.tex'));
  assert.equal(rep.points[0].exact, true);
});

test('Resposta: the appendix is in the diff and the current text, and its change gets the appendix page', { skip }, async () => {
  const { proj, doc, submitted } = await makeRefereeProject(fs.mkdtempSync(path.join(tmp, 'p-')));
  const tex = await which('latexmk');
  if (tex) for (const d of ['appendix.tex', 'paper.tex', 'appendix.tex']) execFileSync('latexmk', ['-pdf', '-synctex=1', '-interaction=nonstopmode', d], { cwd: proj, stdio: 'ignore' });
  answer({ intro: 'Thanks.', main_changes: [], sections: [{ who: 'Referee 2', comments: [{ comment: 'A placebo test.', status: 'addressed', reply: 'Done.', changes: [{ what: 'Placebo added.', file: 'appendix.tex', line: 1, quote: QUOTE }] }] }] });
  const r = await respond({ root: proj, doc, reports: 'Referee 2\n\n1. A placebo test would strengthen the design.', source: { kind: 'git', rev: submitted, label: 'the submitted version' }, lang: 'en', agent: 'claude' });
  const prompt = fs.readFileSync(seen, 'utf8');
  assert.match(prompt, /<diff file="appendix\.tex">/);
  assert.match(prompt, /<file path="appendix\.tex">\n1\| /);
  assert.ok(r.changedFiles.includes('appendix.tex'), r.changedFiles);
  const letter = fs.readFileSync(r.file, 'utf8');
  assert.match(letter, /\\change\{Placebo added\. \(Online Appendix, Section ``Placebo timing''/);
  assert.match(letter, /% appendix\.tex:42$/m);
  if (tex) assert.match(letter, /Section ``Placebo timing'', p\.~1\)\}/);
});
