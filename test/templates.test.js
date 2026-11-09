// Every template must compile cleanly: no errors, no ??.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildManager } from '../server/build.js';
import { createFromTemplate, listTemplates } from '../server/templates.js';
import { listDocuments } from '../server/project.js';

for (const [tpl, lang] of listTemplates().flatMap((t) => [[t, 'pt'], ...(t.mainEn ? [[t, 'en']] : [])])) {
  test(`template ${tpl.id} (${lang}) compiles`, { timeout: 120000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `texugo-${tpl.id}-`));
    createFromTemplate(tpl.id, dir, { title: 'Título & teste', author: 'Fulano', institution: 'UFBA' }, lang);
    const docs = listDocuments(dir);
    assert.ok(docs.length >= 1);
    const mgr = new BuildManager();
    const res = await new Promise((resolve) => {
      mgr.on('event', (e) => e.type === 'build:done' && resolve(e));
      mgr.request(dir, [path.join(dir, lang === 'en' && tpl.mainEn ? tpl.mainEn : tpl.main)]);
    });
    for (const d of res.docs) {
      assert.deepEqual(d.errors.map((e) => e.message), [], `${tpl.id}/${d.name}`);
      assert.equal(d.undefinedRefs.length + d.undefinedCites.length, 0, `${tpl.id}/${d.name} has ??`);
      assert.ok(d.pdf, `${tpl.id}/${d.name} pdf`);
    }
  });
}
