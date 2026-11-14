// An expired login of Claude Code, in the one-shot run (selection actions,
// Parecer, Resposta aos pareceristas) and in the panel's conversation, with a
// stand-in `claude` first on the PATH that prints what Claude Code 2.1.321
// prints: a JSON result with is_error, not text on stderr; in the panel, also
// an assistant message of its own (model "<synthetic>") with the same text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-oneshot-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
const out = path.join(tmp, 'out.json');
fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\ncat > /dev/null\ncat "${out}"\n`, { mode: 0o755 });
process.env.PATH = bin + path.delimiter + process.env.PATH;
const { claude, ClaudeSession } = await import('../server/agents/claude.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const result = (fields) => fs.writeFileSync(out, JSON.stringify({ type: 'result', subtype: 'success', num_turns: 1, ...fields }));
const skip = process.platform === 'win32' ? 'the stand-in is a shell script' : false;

test('an expired login says the Claude Code is not logged in, in the UI language', { skip }, async () => {
  result({ is_error: true, terminal_reason: 'api_error', result: 'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again, or use `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN for unattended jobs' });
  await assert.rejects(() => claude.oneShot('prompt', { root: tmp }), (err) => err.message === 'O Claude Code não está logado. Abra o Terminal, rode "claude" e entre na sua conta.');
});

test('another error from Claude Code is passed on as it came', { skip }, async () => {
  result({ is_error: true, result: 'Reached the maximum number of turns.' });
  await assert.rejects(() => claude.oneShot('prompt', { root: tmp }), /^Error: O Claude Code respondeu com erro: Reached the maximum number of turns\.$/);
});

test('a good run returns the text', { skip }, async () => {
  result({ is_error: false, result: '<texugo>{}</texugo>' });
  assert.equal(await claude.oneShot('prompt', { root: tmp }), '<texugo>{}</texugo>');
});

const EXPIRED = 'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again.';
const NOT_LOGGED = 'O Claude Code não está logado. Rode "claude" no Terminal (ou no terminal do TeXugo) e entre na sua conta.';
// One panel turn: the stand-in prints its lines once the message is sent.
async function panelTurn(lines) {
  fs.writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const events = [];
  const s = new ClaudeSession(tmp, {}, (e) => events.push(e));
  await s.start();
  s.running = true;
  s.child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Hi' }] } }) + '\n');
  await new Promise((r) => s.child.on('close', r));
  return events.filter((e) => ['text', 'error', 'result'].includes(e.kind));
}

test('panel: an expired login is the Portuguese notice, not a reply from Claude', { skip }, async () => {
  const ev = await panelTurn([
    { type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: EXPIRED }] } },
    { type: 'result', subtype: 'success', is_error: true, result: EXPIRED, num_turns: 1 },
  ]);
  assert.deepEqual(ev.map((e) => [e.kind, e.text]), [['error', NOT_LOGGED], ['result', NOT_LOGGED]]);
});

test('panel: a reply of the model that talks about logins stays a reply', { skip }, async () => {
  const text = 'The login page should say that authentication failed.';
  const ev = await panelTurn([
    { type: 'assistant', message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }] } },
    { type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 1 },
  ]);
  assert.deepEqual(ev.map((e) => [e.kind, e.text]), [['text', text], ['result', null]]);
});
