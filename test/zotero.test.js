import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { library, addItems, importBib } from '../server/zotero.js';

const sqlite = await import('node:sqlite').catch(() => null);

// A tiny library with Zotero's own schema (the tables TeXugo reads).
function fakeZotero() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-zot-'));
  const db = path.join(dir, 'zotero.sqlite');
  const sql = `
CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT, libraryID INT, key TEXT);
CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value);
CREATE TABLE itemData (itemID INT, fieldID INT, valueID INT);
CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT);
CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
CREATE TABLE itemCreators (itemID INT, creatorID INT, creatorTypeID INT, orderIndex INT);
CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
INSERT INTO itemTypes VALUES (1,'journalArticle'),(2,'attachment'),(3,'report');
INSERT INTO items VALUES (1,1,1,'AAAA1111'),(2,2,1,'PDF00001'),(3,3,1,'WP000001'),(4,1,1,'TRASH001');
INSERT INTO fields VALUES (1,'title'),(2,'publicationTitle'),(3,'date'),(4,'volume'),(5,'pages'),(6,'DOI'),(7,'institution'),(8,'reportNumber');
INSERT INTO itemDataValues VALUES (1,'Football, Alcohol, and Domestic Abuse'),(2,'Journal of Public Economics'),(3,'2024-02-00 2024-02'),(4,'230'),(5,'105031'),(6,'10.1016/j.jpubeco.2023.105031'),
  (7,'Climate Change, Mortality, and Adaptation'),(8,'2007'),(9,'National Bureau of Economic Research'),(10,'13178'),(11,'Deleted paper');
INSERT INTO itemData VALUES (1,1,1),(1,2,2),(1,3,3),(1,4,4),(1,5,5),(1,6,6),(3,1,7),(3,3,8),(3,7,9),(3,8,10),(4,1,11);
INSERT INTO creators VALUES (1,'Ria','Ivandić',0),(2,'Tom','Kirchmaier',0),(3,'Olivier','Deschênes',0),(4,'','World Bank',1);
INSERT INTO creatorTypes VALUES (1,'author'),(2,'editor'),(3,'contributor');
INSERT INTO itemCreators VALUES (1,1,1,0),(1,2,1,1),(3,3,1,0),(3,4,1,1);
INSERT INTO deletedItems VALUES (4);`;
  // Windows has no sqlite3 program; Node's own SQLite writes the same file.
  if (sqlite) {
    const d = new sqlite.DatabaseSync(db);
    d.exec(sql);
    d.close();
  } else execFileSync('sqlite3', [db], { input: sql });
  return { dir, db };
}

test('reads a Zotero library and writes BibTeX entries', async () => {
  const { dir, db } = fakeZotero();
  const lib = await library({ db });
  assert.equal(lib.source, 'sqlite');
  assert.deepEqual(lib.items.map((i) => i.zkey).sort(), ['AAAA1111', 'WP000001']);
  const art = lib.items.find((i) => i.zkey === 'AAAA1111');
  assert.equal(art.type, 'article');
  assert.equal(art.year, '2024');
  assert.deepEqual(art.authors[0], { family: 'Ivandić', given: 'Ria' });
  const wp = lib.items.find((i) => i.zkey === 'WP000001');
  assert.equal(wp.type, 'techreport');
  assert.equal(wp.number, '13178');
  const bib = path.join(dir, 'refs.bib');
  const r = addItems(bib, [art, wp, art]);
  assert.deepEqual(r.map((x) => x.key), ['ivandic2024football', 'deschenes2007climate', 'ivandic2024football']);
  assert.equal(r[2].existed, true);
  const text = fs.readFileSync(bib, 'utf8');
  assert.match(text, /author\s+= \{Deschênes, Olivier and \{World Bank\}\}/);
  assert.match(text, /institution = \{National Bureau of Economic Research\}/);
});

test('importBib merges an exported .bib without duplicates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-imp-'));
  const target = path.join(dir, 'refs.bib');
  const src = path.join(dir, 'export.bib');
  fs.writeFileSync(target, '@article{a, title={One}, doi={10.1/a}}\n');
  fs.writeFileSync(src, '@comment{x}\n@article{b, title={Two}}\n@article{dup, title={Other}, doi={10.1/A}}\n@article{c,\n  title = {One}\n}\n@book{d, title={Four}}\n');
  const r = importBib(target, src);
  assert.deepEqual(r, { added: ['b', 'd'], skipped: ['dup', 'c'] });
  assert.match(fs.readFileSync(target, 'utf8'), /^@article\{a, title=\{One\}, doi=\{10\.1\/a\}\}\n\n@article\{b, title=\{Two\}\}\n\n@book\{d, title=\{Four\}\}\n$/);
});
