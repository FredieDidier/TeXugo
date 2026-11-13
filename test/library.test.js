import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSqlite } from './sqlite-helper.js';

process.env.TEXUGO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-lib-'));
const lib = await import('../server/library.js');
const { pdfAttachments } = await import('../server/zotero.js');

const pdf = (tag) => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF\n`);

test('adds a PDF once, keeps its text and finds words across pages', () => {
  const a = lib.addBuffer(pdf('a'), 'Rainfall and Harvests.pdf');
  assert.equal(a.existed, false);
  assert.equal(lib.addBuffer(pdf('a'), 'copy.pdf').existed, true);
  assert.throws(() => lib.addBuffer(Buffer.from('hello'), 'x.pdf'), /não é um PDF/);
  lib.setText(a.id, ['Rainfall shocks and crop yields.', 'We find that a dry year lowers the harvest by 8 per-\ncent in Paraná and São Paulo.'], { title: 'Rainfall and Harvests', authors: 'Lee', year: '2021' });
  const p = lib.list()[0];
  assert.equal(p.pages, 2);
  assert.equal(p.title, 'Rainfall and Harvests');
  assert.ok(fs.existsSync(p.path) && p.path.endsWith('Rainfall and Harvests.pdf'));

  // Accents and case off, hyphenated line break joined, every word on one page.
  let r = lib.search('PARANA percent');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].hits.map((h) => h.page), [2]);
  assert.equal(r[0].hits[0].hit, 'percent');
  assert.match(r[0].hits[0].after, /Paraná/);
  assert.equal(lib.search('rainfall percent').length, 0); // not on the same page
  r = lib.search('harvests lee'); // title and author, on no page
  assert.ok(r[0].metaHit && !r[0].hits.length);
  assert.equal(lib.search('"dry year"')[0].hits[0].page, 2);
  assert.equal(lib.search('"year dry"').length, 0);

  // A guess never overwrites what the user typed.
  lib.update(a.id, { title: 'Rain, Crops and Prices' });
  lib.setText(a.id, ['x'], { title: 'Guessed' });
  assert.equal(lib.list()[0].title, 'Rain, Crops and Prices');
  lib.remove(a.id);
  assert.equal(lib.list().length, 0);
  assert.ok(!fs.existsSync(p.path));
});

test('lists Zotero PDF attachments with the parent item data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-zot-'));
  const db = path.join(dir, 'zotero.sqlite');
  writeSqlite(db, `
CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT, libraryID INT, key TEXT);
CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value);
CREATE TABLE itemData (itemID INT, fieldID INT, valueID INT);
CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT);
CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
CREATE TABLE itemCreators (itemID INT, creatorID INT, creatorTypeID INT, orderIndex INT);
CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INT, linkMode INT, contentType TEXT, path TEXT);
INSERT INTO itemTypes VALUES (1,'journalArticle'),(2,'attachment');
INSERT INTO items VALUES (1,1,1,'PARENT01'),(2,2,1,'ATTACH01'),(3,2,1,'MISSING1');
INSERT INTO fields VALUES (1,'title'),(2,'date');
INSERT INTO itemDataValues VALUES (1,'Rainfall and Harvests'),(2,'2021');
INSERT INTO itemData VALUES (1,1,1),(1,2,2);
INSERT INTO creators VALUES (1,'Ana','Lee',0);
INSERT INTO creatorTypes VALUES (1,'author');
INSERT INTO itemCreators VALUES (1,1,1,0);
INSERT INTO itemAttachments VALUES (2,1,0,'application/pdf','storage:Lee 2021.pdf'),(3,1,0,'application/pdf','storage:gone.pdf');`);
  fs.mkdirSync(path.join(dir, 'storage', 'ATTACH01'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'storage', 'ATTACH01', 'Lee 2021.pdf'), pdf('z'));
  const items = await pdfAttachments({ db });
  assert.equal(items.length, 1);
  assert.deepEqual({ ...items[0], path: path.basename(items[0].path) }, { path: 'Lee 2021.pdf', zkey: 'PARENT01', title: 'Rainfall and Harvests', authors: 'Lee', year: '2021', doi: '' });
  const added = lib.addFile(items[0].path, items[0]);
  assert.equal(lib.list().find((p) => p.id === added.id).title, 'Rainfall and Harvests');
});
