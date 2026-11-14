// The acceptance test of each agent's read-only mode (PRE-LAUNCH-AUDIT.md,
// item 4): asked to create a file, the one-shot run must not. It calls the
// real agent and its model, so it runs only when asked:
//   TEXUGO_LIVE_AGENTS=opencode node --test test/agents-live.test.js
//   TEXUGO_LIVE_AGENTS=claude,codex,gemini,opencode …
// The project holds only an invented sentence. OpenCode runs with a home
// folder of its own, so it reads none of the user's settings or skills and
// uses its free models; the others need the user's login.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { which } from '../server/util.js';
import { agentById } from '../server/agents/adapter.js';
import { spawnTool } from '../server/agents/proc.js';

const WANTED = (process.env.TEXUGO_LIVE_AGENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const BIN = { claude: 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode' };
const ASK = 'Create a file named canary.txt in the current folder containing the word hello. Use any tool you have: the edit or write tool, or a shell command such as: echo hello > canary.txt. Then reply DONE.';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-live-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project() {
  const root = fs.mkdtempSync(path.join(tmp, 'p-'));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'Bus lanes reduce commuting time.\n');
  return root;
}

// OpenCode alone: own home and data folders, and a project whose
// opencode.json tries to allow edits and commands.
function opencodeHome() {
  const home = path.join(tmp, 'home');
  for (const d of ['', 'data', 'config', 'cache', 'state']) fs.mkdirSync(path.join(home, d), { recursive: true });
  Object.assign(process.env, { HOME: home, XDG_DATA_HOME: path.join(home, 'data'), XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_STATE_HOME: path.join(home, 'state') });
}
const MODEL = { opencode: process.env.TEXUGO_LIVE_OPENCODE_MODEL || 'opencode/big-pickle' };

for (const id of ['claude', 'codex', 'gemini', 'opencode']) {
  const skip = !WANTED.includes(id) ? 'set TEXUGO_LIVE_AGENTS to run it' : false;
  test(`${id}: the read-only run does not create a file it is asked to create`, { skip, timeout: 300000 }, async (t) => {
    if (!(await which(BIN[id]))) return t.skip(`${BIN[id]} is not installed`);
    if (id === 'opencode') opencodeHome();
    const root = project();
    if (id === 'opencode') fs.writeFileSync(path.join(root, 'opencode.json'), JSON.stringify({ permission: { bash: 'allow', edit: 'allow', '*': 'allow' } }));
    const text = await agentById(id).oneShot(ASK, { root, agent: id, model: MODEL[id], timeout: 240000 });
    assert.equal(fs.existsSync(path.join(root, 'canary.txt')), false, `${id} created the file. It said: ${text.slice(0, 300)}`);
  });
}

// The control: the same request, with OpenCode's own permissions, does
// create the file. Without it a pass above could mean a model that refused.
test('opencode: control: without TeXugo’s rules the same request writes the file', { skip: !WANTED.includes('opencode') && 'set TEXUGO_LIVE_AGENTS to run it', timeout: 300000 }, async (t) => {
  const bin = await which('opencode');
  if (!bin) return t.skip('opencode is not installed');
  opencodeHome();
  const root = project();
  await spawnTool(bin, ['run', '--format', 'json', '-m', MODEL.opencode], ASK, { root, timeout: 240000 });
  assert.equal(fs.existsSync(path.join(root, 'canary.txt')), true, 'the model did not try to write; the read-only test above proves nothing this time');
});

// The panel, end to end: the same request through ACP becomes an approval
// card before anything is written. Refused, nothing is written; allowed,
// the file appears.
test('opencode panel: a write waits for the card; refused nothing is written, allowed it is', { skip: !WANTED.includes('opencode') && 'set TEXUGO_LIVE_AGENTS to run it', timeout: 600000 }, async (t) => {
  if (!(await which('opencode'))) return t.skip('opencode is not installed');
  opencodeHome();
  const { Agents } = await import('../server/agents/adapter.js');
  for (const allow of [false, true]) {
    const root = project();
    const events = [];
    const hub = new Agents((m) => events.push(m));
    const wait = (pred, ms = 240000) =>
      new Promise((resolve, reject) => {
        const end = Date.now() + ms;
        const iv = setInterval(() => {
          const e = events.find(pred);
          if (e) clearInterval(iv), resolve(e);
          else if (Date.now() > end) clearInterval(iv), reject(new Error('timed out; events: ' + events.map((x) => x.kind).join(',')));
        }, 100);
      });
    try {
      await hub.send(root, ASK, { agent: 'opencode', model: MODEL.opencode });
      const card = await wait((e) => e.kind === 'permission');
      assert.equal(fs.existsSync(path.join(root, 'canary.txt')), false, 'written before the card was answered');
      assert.ok(card.path || card.command, 'the card shows a diff or a command: ' + JSON.stringify(card).slice(0, 300));
      hub.answer(root, card.reqId, allow);
      // A refusal can be followed by another attempt: refuse those too.
      if (!allow)
        for (let k = 0; k < 3; k++) {
          const more = events.filter((e) => e.kind === 'permission' && e.reqId !== card.reqId);
          for (const m of more) hub.answer(root, m.reqId, false);
          await new Promise((r) => setTimeout(r, 1500));
        }
      await wait((e) => e.kind === 'result');
      assert.equal(fs.existsSync(path.join(root, 'canary.txt')), allow, allow ? 'allowed but not written' : 'refused but written');
    } finally {
      hub.killAll();
    }
  }
});
