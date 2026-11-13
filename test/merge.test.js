// B3: "Juntar as duas" in the save-conflict dialog. A three-way merge keeps
// both sides when they changed different passages and reports the passages
// both changed. Long accented texts come back byte for byte, which also
// checks that run() decodes a command's output as one UTF-8 stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { mergeText } = await import('../server/git.js');
const { run } = await import('../server/util.js');

const para = (i) => `Parágrafo ${i}: ação, reação e opções de política pública, com ênfase em “efeitos” médios.`;
const base = Array.from({ length: 6000 }, (_, i) => para(i)).join('\n') + '\n';

test('different passages: both changes kept, nothing else touched', async () => {
  const mine = base.replace(para(10), para(10) + ' Frase minha.');
  const theirs = base.replace(para(5900), para(5900) + ' Frase do coautor.');
  const r = await mergeText(base, mine, theirs);
  assert.equal(r.conflicts, 0);
  assert.equal(r.text, base.replace(para(10), para(10) + ' Frase minha.').replace(para(5900), para(5900) + ' Frase do coautor.'));
});

test('the same passage changed on both sides: counted, not merged', async () => {
  const mine = base.replace(para(10), 'Versão minha.').replace(para(3000), 'Minha de novo.');
  const theirs = base.replace(para(10), 'Versão do coautor.').replace(para(3000), 'Do coautor de novo.');
  const r = await mergeText(base, mine, theirs);
  assert.equal(r.conflicts, 2);
});

test('the same change on both sides is no conflict', async () => {
  const both = base.replace(para(42), 'Igual dos dois lados.');
  const r = await mergeText(base, both, both);
  assert.deepEqual(r, { text: both, conflicts: 0 });
});

test('run() keeps accented letters across output chunks', async () => {
  const r = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1].repeat(20000))', 'Ação e reação: é só começar. ']);
  assert.equal(r.stdout, 'Ação e reação: é só começar. '.repeat(20000));
});
