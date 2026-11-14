// The agent interface (server/agents) with a stand-in agent that speaks ACP
// (test/fixtures/fake-acp-agent.mjs): text, model and effort, approval
// cards with the whole value, refusal, cancel, login, switching agents. No
// real agent and no account are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpSession, choices, applyUnified } from '../server/agents/acp.js';
import { Agents } from '../server/agents/adapter.js';
import { opencode, codex, gemini, safeId } from '../server/agents/others.js';
import { spawnTool } from '../server/agents/proc.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-acp-agent.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-agents-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function fake(extraEnv = {}) {
  const log = path.join(tmp, `log-${Math.random().toString(36).slice(2)}.jsonl`);
  const agent = { id: 'fake', name: 'Fake', product: 'Fake Agent', login: 'Run "fake login".', acp: { bin: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: log, ...extraEnv } } };
  agent.Session = class extends AcpSession {
    constructor(root, opts, emit) {
      super(root, opts, emit, agent);
    }
  };
  return { agent, log, sent: () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) };
}

async function session(extraEnv) {
  const root = fs.mkdtempSync(path.join(tmp, 'p-'));
  const f = fake(extraEnv);
  const events = [];
  const s = new f.agent.Session(root, {}, (e) => events.push(e));
  await s.start();
  // Waits for an event; a turn that never ends fails the test in 10 s
  // instead of holding it.
  const wait = (get, what) =>
    new Promise((resolve, reject) => {
      const end = Date.now() + 10000;
      const t = setInterval(() => {
        const v = get();
        if (v) clearInterval(t), resolve(v);
        else if (Date.now() > end) clearInterval(t), reject(new Error('no ' + what));
      }, 10);
    });
  // The turn ends: status running: false after a send.
  const turn = () =>
    wait(() => {
      const i = events.findLastIndex((e) => e.kind === 'status' && e.running === false);
      const j = events.findLastIndex((e) => e.kind === 'status' && e.running === true);
      return i > j && j >= 0;
    }, 'end of turn');
  const until = (pred) => wait(() => events.find(pred), 'event');
  return { root, s, events, turn, until, sent: f.sent };
}

test('a turn: text chunks become one message, models and efforts come from the agent', async () => {
  const { s, events, turn, sent } = await session();
  const init = events.find((e) => e.kind === 'init');
  assert.deepEqual(init.models, [{ id: 'fast-1', label: 'Fast 1' }, { id: 'deep-2', label: 'Deep 2' }]);
  assert.deepEqual(init.efforts, [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }]);
  await s.send('hello');
  await turn();
  assert.deepEqual(events.filter((e) => e.kind === 'text').map((e) => e.text), ['Hello.']);
  assert.equal(events.find((e) => e.kind === 'result').ok, true);
  // The TeXugo instructions go with the first message only.
  await s.send('hello again');
  await turn();
  const prompts = sent().filter((m) => m.method === 'session/prompt').map((m) => m.params.prompt[0].text);
  assert.match(prompts[0], /<texugo-instructions>[\s\S]*hello$/);
  assert.doesNotMatch(prompts[1], /texugo-instructions/);
  assert.deepEqual(sent().find((m) => m.method === 'initialize').params.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  s.close();
});

test('the model and effort chosen in the panel are set on the conversation', async () => {
  const { s, events, turn, sent } = await session();
  await s.send('status', { model: 'deep-2', effort: 'high' });
  await turn();
  assert.equal(events.filter((e) => e.kind === 'text').pop().text, 'model deep-2, level high');
  // An id the agent does not offer is not sent.
  await s.send('status', { model: 'x; rm -rf ~' });
  await turn();
  assert.equal(sent().filter((m) => m.method === 'session/set_config_option').length, 2);
  s.close();
});

test('an edit is a card with the whole diff; refusing it leaves the file alone', async () => {
  const { root, s, events, turn, until } = await session();
  await s.send('edit');
  const card = await until((e) => e.kind === 'permission');
  assert.equal(card.path, path.join(root, 'notes.txt'));
  assert.equal(card.isNew, true);
  assert.equal(card.oldText, '');
  assert.equal(card.newText, 'new text\n');
  assert.equal(card.noteable, false);
  assert.equal(s.answer(card.reqId, false), true);
  await turn();
  assert.equal(fs.existsSync(path.join(root, 'notes.txt')), false);
  assert.equal(events.find((e) => e.kind === 'tool-result').error, true);
  s.close();
});

test('allowing an edit allows it once, never for the rest of the session', async () => {
  const { root, s, turn, until, sent } = await session();
  fs.writeFileSync(path.join(root, 'notes.txt'), 'old text\n');
  await s.send('edit');
  const card = await until((e) => e.kind === 'permission');
  assert.equal(card.isNew, false);
  assert.equal(card.oldText, 'old text\n');
  s.answer(card.reqId, true);
  await turn();
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'new text\n');
  const reply = sent().find((m) => m.result && m.result.outcome);
  assert.deepEqual(reply.result.outcome, { outcome: 'selected', optionId: 'yes' });
  s.close();
});

test('a command is a card with the whole command and its raw input', async () => {
  const { s, events, turn, until } = await session();
  await s.send('run');
  const card = await until((e) => e.kind === 'permission');
  assert.equal(card.tool, 'Bash');
  assert.equal(card.command, 'latexmk -pdf paper.tex');
  assert.deepEqual(card.input.command, ['latexmk', '-pdf', 'paper.tex']);
  assert.ok(card.input.cwd);
  s.answer(card.reqId, true);
  await turn();
  assert.equal(events.filter((e) => e.kind === 'text').pop().text, 'choice: a');
  s.close();
});

test('Parar cancels the turn and answers the open card as cancelled', async () => {
  const { s, events, turn, until } = await session();
  await s.send('wait');
  const card = await until((e) => e.kind === 'permission');
  assert.equal(s.interrupt(), true);
  await turn();
  assert.ok(events.some((e) => e.kind === 'permission-closed' && e.reqId === card.reqId));
  assert.equal(events.filter((e) => e.kind === 'text').pop().text, 'after cancel: cancelled');
  assert.equal(s.answer(card.reqId, true), false);
  s.close();
});

test('an agent that needs a login says how to log in', async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'p-'));
  const f = fake({ FAKE_ACP_AUTH: '1' });
  const s = new f.agent.Session(root, {}, () => {});
  await assert.rejects(() => s.start(), /Fake Agent não está logado\. Run "fake login"\./);
});

test('the hub keeps one conversation per project and starts another for another agent', async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'p-'));
  const a = fake().agent;
  const b = { ...fake().agent, id: 'other', product: 'Other Agent' };
  b.Session = class extends AcpSession {
    constructor(r, o, e) {
      super(r, o, e, b);
    }
  };
  const out = [];
  const hub = new Agents((m) => out.push(m), { agents: [a, b] });
  await hub.send(root, 'hello', { agent: 'fake' });
  const first = hub.sessions.get(root);
  await hub.send(root, 'hello', { agent: 'fake' });
  assert.equal(hub.sessions.get(root), first);
  await hub.send(root, 'hello', { agent: 'other' });
  assert.notEqual(hub.sessions.get(root), first);
  assert.equal(hub.sessions.get(root).agentId, 'other');
  assert.ok(out.every((m) => m.type === 'agent:event' && m.root === root));
  assert.ok(out.some((m) => m.agent === 'other'));
  hub.killAll();
});

test('grouped and plain config choices read the same', () => {
  assert.deepEqual(choices({ options: [{ value: 'a', name: 'A' }, { group: 'g', options: [{ value: 'b', name: 'B' }] }] }), [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
});

test('model and effort ids reach a command line only when plain', () => {
  assert.equal(safeId('opencode/big-pickle'), 'opencode/big-pickle');
  assert.equal(safeId('gpt-5.5'), 'gpt-5.5');
  for (const bad of ['x; rm -rf ~', '$(id)', 'a b', '"q"', '', null, 'a&b']) assert.equal(safeId(bad), null);
  assert.deepEqual(codex.tui({ model: 'x;y', effort: 'high' }), ['codex', '-c', 'model_reasoning_effort=high']);
  assert.deepEqual(gemini.tui({ model: 'gemini-3-pro' }), ['gemini', '-m', 'gemini-3-pro']);
});

test('OpenCode: the panel asks before every change; the one-shot has only reading tools', () => {
  const panel = JSON.parse(opencode.acp.env.OPENCODE_CONFIG_CONTENT).permission;
  const ro = JSON.parse(opencode.readOnlyEnv.OPENCODE_CONFIG_CONTENT).permission;
  for (const k of ['edit', 'bash', 'webfetch', 'websearch', 'task', 'external_directory']) {
    assert.equal(panel[k], 'ask', k);
    assert.equal(ro[k], 'deny', k);
  }
  assert.equal(panel['*'], 'ask');
  assert.equal(ro['*'], 'deny');
  assert.equal(ro.read, 'allow');
  // Codex starts in its read-only mode; Gemini in the mode that asks.
  assert.equal(codex.acp.env.INITIAL_AGENT_MODE, 'read-only');
  assert.deepEqual(gemini.acp.args, ['--acp', '--approval-mode', 'default']);
});

test('an agent program gets PWD set to the project, not to where TeXugo started', async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'p-'));
  const out = await spawnTool(process.execPath, ['-e', 'process.stdout.write(process.env.PWD + "|" + process.cwd())'], '', { root });
  assert.equal(out.stdout, `${root}|${fs.realpathSync(root)}`);
});

test('a new file sent as a unified diff (OpenCode) is a card with the whole new text', async () => {
  const { root, s, turn, until } = await session();
  await s.send('write');
  const card = await until((e) => e.kind === 'permission');
  assert.equal(card.path, path.join(root, 'new.txt'));
  assert.equal(card.isNew, true);
  assert.equal(card.newText, 'first\nsecond\n');
  s.answer(card.reqId, false);
  await turn();
  s.close();
});

test('a unified diff applies to the old text, or not at all', () => {
  assert.equal(applyUnified('Bus lanes.\n', '--- f\n+++ f\n@@ -1,1 +1,1 @@\n-Bus lanes.\n+Tram lanes.\n'), 'Tram lanes.\n');
  assert.equal(applyUnified('a\nb\nc\nd\n', '--- f\n+++ f\n@@ -2,2 +2,2 @@\n b\n-c\n+C\n'), 'a\nb\nC\nd\n');
  assert.equal(applyUnified('', '@@ -0,0 +1,1 @@\n+hello\n\\ No newline at end of file\n'), 'hello');
  assert.equal(applyUnified('other\n', '--- f\n+++ f\n@@ -1,1 +1,1 @@\n-Bus lanes.\n+Tram lanes.\n'), null);
  assert.equal(applyUnified('x', 'no hunks here'), null);
});

test('an agent whose program is missing says how to install it, without hanging', async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'p-'));
  const agent = { id: 'gone', name: 'Gone', product: 'Gone Agent', install: 'npm install -g gone-agent', login: '', acp: { bin: 'texugo-no-such-agent-program', args: [] } };
  const s = new AcpSession(root, {}, () => {}, agent);
  await assert.rejects(() => s.start(), /Gone Agent não encontrado\. Instale com: npm install -g gone-agent/);
});

test('OpenCode starts without the user’s Claude Code skills, in the panel, the one-shot and the terminal', () => {
  for (const env of [opencode.acp.env, opencode.readOnlyEnv, opencode.tuiEnv]) assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS, '1');
});
