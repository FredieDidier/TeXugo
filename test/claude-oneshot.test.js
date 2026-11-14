// The one-shot run of Claude Code (selection actions, Parecer, Resposta aos
// pareceristas) with a stand-in `claude` first on the PATH that prints what
// Claude Code 2.1.321 prints: an expired login comes as a JSON result with
// is_error, not as text on stderr.
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
const { claude } = await import('../server/agents/claude.js');
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
