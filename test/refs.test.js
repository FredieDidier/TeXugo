import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, makeKey, toBibtex, addToBib, bibsOf } from '../server/refs.js';

test('classify DOI, arXiv and title', () => {
  assert.deepEqual(classify('https://doi.org/10.1257/app.3.4.152.'), { kind: 'doi', id: '10.1257/app.3.4.152' });
  assert.deepEqual(classify('https://arxiv.org/abs/2312.00752v2'), { kind: 'arxiv', id: '2312.00752' });
  assert.deepEqual(classify('arXiv:1706.03762'), { kind: 'arxiv', id: '1706.03762' });
  assert.equal(classify('Climate change and mortality').kind, 'title');
});

const ref = { type: 'article', title: 'The Effect of Heat & Crime', authors: [{ family: 'Deschênes', given: 'Olivier' }], year: '2011', venue: 'AEJ: Applied', pages: '152–185', doi: '10.1/x' };

test('key and BibTeX', () => {
  assert.equal(makeKey(ref), 'deschenes2011effect');
  assert.equal(makeKey(ref, new Set(['deschenes2011effect'])), 'deschenes2011effecta');
  const b = toBibtex(ref, 'k');
  assert.match(b, /title\s+= \{The Effect of Heat \\& Crime\}/);
  assert.match(b, /pages\s+= \{152--185\}/);
  assert.match(b, /journal\s+= \{AEJ: Applied\}/);
});

test('addToBib reuses an existing DOI and finds the document .bib', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-refs-'));
  const bib = path.join(dir, 'r.bib');
  fs.writeFileSync(bib, '@article{old, doi = {10.1/X}}\n');
  assert.deepEqual(addToBib(bib, ref), { key: 'old', existed: true });
  const r = addToBib(bib, { ...ref, doi: '10.2/y' });
  assert.equal(r.key, 'deschenes2011effect');
  assert.match(fs.readFileSync(bib, 'utf8'), /\n\n@article\{deschenes2011effect,/);
  fs.writeFileSync(path.join(dir, 'm.tex'), '\\bibliography{r, sub/other}\n% \\bibliography{no}\n');
  assert.deepEqual(bibsOf(path.join(dir, 'm.tex')), [bib, path.join(dir, 'sub/other.bib')]);
});
