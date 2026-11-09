import test from 'node:test';
import assert from 'node:assert/strict';
import { setField, parseBib } from '../server/bibparse.js';
import { compareEntry, titleSimilarity } from '../server/refcheck.js';

const BIB = `@article{a,
  author  = {Card, David and
             Dahl, Gordon B.},
  title   = {Family Violence and Football},
  journal = {Quarterly Journal of Economics},
  year    = {2010},
  number  = {1--2}
}
@article{b, title={X}, year=2000}
`;

test('setField replaces a field in place and adds a missing one', () => {
  let t = setField(BIB, 'a', 'year', '2011');
  assert.match(t, /year {4}= \{2011\},\n {2}number/);
  t = setField(t, 'a', 'doi', '10.1093/qje/qjr001');
  assert.match(t, /number {2}= \{1--2\},\n {2}doi {5}= \{10\.1093\/qje\/qjr001\}\n\}/);
  t = setField(t, 'b', 'year', '2001');
  assert.match(t, /@article\{b, title=\{X\}, year=\{2001\}\}/);
  assert.equal(setField(t, 'zzz', 'year', '1'), null);
  const [a] = parseBib(t);
  assert.equal(a.fields.author, 'Card, David and\n             Dahl, Gordon B.');
});

test('compareEntry: ignores dash style, reports real differences and a missing DOI', () => {
  const [e] = parseBib(BIB);
  const m = { type: 'journal-article', DOI: '10.1093/qje/qjr001', 'container-title': ['The Quarterly Journal of Economics'], issued: { 'date-parts': [[2011]] }, issue: '1-2', page: '103-143', volume: '126' };
  const d = compareEntry(e, m);
  assert.deepEqual(d.map((x) => x.field), ['year', 'volume', 'pages', 'doi']);
  assert.ok(titleSimilarity('Family Violence and Football', 'Family violence and football: the effect') > 0.5);
});
