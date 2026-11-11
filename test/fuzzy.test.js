import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, bestScore } from '../web/src/fuzzy.js';

test('palette: scattered letters are not a match', () => {
  assert.equal(fuzzyScore('Biblioteca de papers (ler e buscar no texto) biblioteca library papers pdf', 'body'), -1);
  assert.equal(fuzzyScore('Importar do Zotero (ou .bib do Mendeley, Paperpile)', 'body'), -1);
  assert.ok(fuzzyScore('sections/body.tex', 'body') > 0);
  assert.ok(fuzzyScore('Compilar tudo', 'cmpl') > 0);
});

test('palette: substring beats subsequence, word start beats middle', () => {
  assert.ok(fuzzyScore('Compilar tudo', 'comp') > fuzzyScore('Recompilar', 'comp'));
  assert.ok(fuzzyScore('Recompilar', 'comp') > fuzzyScore('Colar tabela mais perto', 'comp'));
});

test('palette: abbreviations and paths still match', () => {
  assert.ok(fuzzyScore('sections/body.tex', 'sbt') > 0);
  assert.ok(fuzzyScore('Git: commit, pull, push', 'gcp') > 0);
  assert.equal(fuzzyScore('paper.tex', 'xyz'), -1);
  assert.equal(fuzzyScore('anything', ''), 0);
});

test('palette: best of several texts', () => {
  assert.ok(bestScore(['Contar palavras', 'Count words', 'texcount'], 'count') > 100);
  assert.equal(bestScore(['Salvar', null, undefined], 'zzz'), -1);
});
