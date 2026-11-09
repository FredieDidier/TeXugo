import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBib, bibSummary, texToText } from '../server/bibparse.js';

const BIB = `@article{ivandicetal2024,
  author  = {Ivandi\\'c, Ria and Kirchmaier, Tom and Saeidi, Ali and
             Torres-Blas, Neus},
  title   = {Football, Alcohol, and Domestic Abuse},
  journal = {Journal of Public Economics},
  year    = {2024},
  volume  = {230},
  pages   = {105031}
}

@string{jpe = "Journal of Political Economy"}
@article{arabepereda2026,
  author  = {Arabe, Isadora and Pereda, Paula},
  title   = {Own Goal: {Impact} of Soccer Matches on Domestic Violence in {Brazil}},
  journal = {Economic Development and Cultural Change},
  year    = 2026,
  doi     = {https://doi.org/10.1086/741819}
}
@misc{x, title = "A \\"quoted\\" {B}title", journal = jpe # { (special)}, author={M{\\"u}ller, Hans}}
`;

test('a multi-line author never runs into the next entry', () => {
  const [a, b, c] = parseBib(BIB).map((e) => bibSummary(e, 'r.bib'));
  assert.equal(a.key, 'ivandicetal2024');
  assert.equal(a.author, 'Ivandić, Ria and Kirchmaier, Tom and Saeidi, Ali and Torres-Blas, Neus');
  assert.equal(a.venue, 'Journal of Public Economics');
  assert.equal(a.doi, undefined);
  assert.equal(a.line, 1);
  assert.equal(b.author, 'Arabe, Isadora and Pereda, Paula');
  assert.equal(b.title, 'Own Goal: Impact of Soccer Matches on Domestic Violence in Brazil');
  assert.equal(b.year, '2026');
  assert.equal(b.doi, '10.1086/741819');
  assert.equal(b.line, 12);
  assert.equal(c.venue, 'Journal of Political Economy (special)');
  assert.equal(c.author, 'Müller, Hans');
});

test('ordinals and unknown commands', () => {
  assert.equal(texToText('Lei n\\textsuperscript{o} 6.015 e 1\\textsuperscript{a} \\url{x.org} \\textcolor{red}{Red}'), 'Lei nº 6.015 e 1ª x.org redRed');
});

test('LaTeX accents become Unicode', () => {
  assert.equal(texToText("Desch{\\^e}nes and Gon\\c{c}alves and {\\o}stergaard and Garc\\'{\\i}a"), 'Deschênes and Gonçalves and østergaard and García');
});
