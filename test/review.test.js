import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchor, parseReport, toMarkdown } from '../server/review.js';

test('a point lands on the line of its quote, even when Claude gets the line wrong', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-rev-'));
  fs.mkdirSync(path.join(dir, 'sections'));
  const main = path.join(dir, 'paper.tex');
  const body = path.join(dir, 'sections', 'body.tex');
  fs.writeFileSync(main, '\\documentclass{article}\n\\begin{document}\n\\input{sections/body}\n\\end{document}\n');
  fs.writeFileSync(body, 'Intro text.\nWe estimate a 48 log point increase in\ncrash deaths after abolition.\n');
  const files = [main, body];
  assert.deepEqual(anchor({ file: 'sections/body.tex', line: 9, quote: '48 log point increase' }, files, dir), { file: body, line: 2, exact: true });
  // Quote across a line break, file given wrong.
  assert.deepEqual(anchor({ file: 'paper.tex', line: 1, quote: 'increase in crash deaths' }, files, dir), { file: body, line: 2, exact: true });
  assert.deepEqual(anchor({ file: 'sections/body.tex', line: 3, quote: 'not in the text at all' }, files, dir), { file: body, line: 3, exact: false });
});

test('the reply is read even with a code fence around the JSON', () => {
  const r = parseReport('Here it is\n<texugo>\n```json\n{"summary":"S","recommendation":"major revision","points":[{"kind":"major","title":"T","comment":"C","file":"paper.tex","line":3,"quote":"q"}]}\n```\n</texugo>');
  assert.equal(r.points.length, 1);
  assert.throws(() => parseReport('no json here'), /formato/);
  const md = toMarkdown({ doc: '/p/paper.tex', date: '2026-11-09T12:00:00Z', journal: 'JDE', recommendation: 'minor revision', summary: 'S', points: [{ kind: 'major', title: 'T', comment: 'C', suggestion: 'D', file: '/p/paper.tex', line: 3 }] }, '/p');
  assert.match(md, /## Comentários principais\n\n1\. \*\*T\*\* \(paper\.tex:3\) C\n {3}\*Sugestão:\* D/);
});
