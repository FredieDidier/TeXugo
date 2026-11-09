import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { escapeTex, toLatex, parseJson } from '../server/rr.js';

test('referee text is escaped; replies and changes land in the template macros', () => {
  assert.equal(escapeTex('50% of $x_i & y\n\nnext'), '50\\% of \\$x\\_i \\& y\\par next');
  const data = parseJson('<texugo>{"intro":"Thanks.","main_changes":["A"],"sections":[{"who":"Referee 1","comments":[{"comment":"Use 5% level","status":"addressed","reply":"Done.","changes":[{"what":"New table","where":"Section ``Results\\u0027\\u0027, p.~3","loc":"sections/body.tex:12"}]},{"comment":"Test displacement","status":"todo","reply":"Not yet.","changes":[]}]}]}</texugo>');
  const tex = toLatex(data, { title: 'Heat & Crime' });
  assert.match(tex, /``Heat \\& Crime''/);
  assert.match(tex, /\\referee\{Use 5\\% level\}\nDone\.\n\\change\{New table \(Section ``Results'', p\.~3\)\} % sections\/body\.tex:12/);
  assert.match(tex, /\\referee\{Test displacement\}\nNot yet\.\n\\todo\{Revise the paper to address this comment\.\}/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-rr-'));
  fs.writeFileSync(path.join(dir, 'response.tex'), tex);
  execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'response.tex'], { cwd: dir, stdio: 'ignore' });
  assert.ok(fs.existsSync(path.join(dir, 'response.pdf')));
});
