// A stand-in agent that speaks ACP v1 on stdio, for the tests of
// server/agents/acp.js. It answers by the first word of the prompt's last
// line:
//   hello  two text chunks, end_turn
//   edit   asks to write notes.txt (a diff); writes it only if allowed
//   write  asks to create new.txt the way OpenCode does (unified diff)
//   run    asks to run a command; reports what the client chose
//   wait   keeps the turn open until session/cancel
//   auth   fails as an agent that needs a login
// It records every message it receives in $FAKE_ACP_LOG, one JSON per line.
import fs from 'node:fs';
import path from 'node:path';

const LOG = process.env.FAKE_ACP_LOG;
let cwd = process.cwd();
let next = 1000;
const waiting = new Map(); // our request id -> resolve
let cancel = null;
let model = 'fast-1';
let level = 'low';

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } });
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = ++next;
    waiting.set(id, resolve);
    send({ id, method, params });
  });
const config = () => [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model, options: [{ value: 'fast-1', name: 'Fast 1' }, { value: 'deep-2', name: 'Deep 2' }] },
  { id: 'reasoning', name: 'Reasoning', category: 'thought_level', type: 'select', currentValue: level, options: [{ group: 'g', name: 'Levels', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] }] },
];

async function prompt(id, { sessionId, prompt }) {
  const text = prompt.map((b) => b.text || '').join('');
  const word = text.trim().split('\n').pop().trim().split(/\s+/)[0];
  if (word === 'hello') {
    update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Hel' } });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'lo.' } });
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  if (word === 'edit') {
    const file = path.join(cwd, 'notes.txt');
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write notes.txt', kind: 'edit', status: 'pending', locations: [{ path: file }], content: [{ type: 'diff', path: file, oldText: old, newText: 'new text\n' }] });
    const r = await ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'c1' },
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'always', name: 'Always', kind: 'allow_always' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    });
    const ok = r.outcome && r.outcome.outcome === 'selected' && r.outcome.optionId !== 'no';
    if (ok) fs.writeFileSync(file, 'new text\n');
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: ok ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: ok ? 'written' : 'rejected by the user' } }] });
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  if (word === 'write') {
    // OpenCode's write: no diff block, a unified diff in the raw input.
    const file = path.join(cwd, 'new.txt');
    const r = await ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'c4', title: file, kind: 'edit', rawInput: { filepath: file, diff: `Index: ${file}\n===\n--- ${file}\n+++ ${file}\n@@ -0,0 +1,2 @@\n+first\n+second\n` } },
      options: [{ optionId: 'a', name: 'Allow', kind: 'allow_once' }, { optionId: 'r', name: 'Reject', kind: 'reject_once' }],
    });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `choice: ${r.outcome.optionId}` } });
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  if (word === 'run') {
    const r = await ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'c2', title: 'Run the build', kind: 'execute', rawInput: { command: ['latexmk', '-pdf', 'paper.tex'], cwd } },
      options: [
        { optionId: 'a', name: 'Allow', kind: 'allow_once' },
        { optionId: 'r', name: 'Reject', kind: 'reject_once' },
      ],
    });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `choice: ${r.outcome.optionId || r.outcome.outcome}` } });
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  if (word === 'wait') {
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'c3', title: 'Delete old.txt', kind: 'delete', status: 'pending' });
    const pending = ask('session/request_permission', { sessionId, toolCall: { toolCallId: 'c3' }, options: [{ optionId: 'a', name: 'Allow', kind: 'allow_once' }] });
    await new Promise((r) => (cancel = r));
    const r = await pending;
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `after cancel: ${r.outcome.outcome}` } });
    return send({ id, result: { stopReason: 'cancelled' } });
  }
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `model ${model}, level ${level}` } });
  send({ id, result: { stopReason: 'end_turn' } });
}

let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (LOG) fs.appendFileSync(LOG, JSON.stringify(m) + '\n');
    if (m.id != null && !m.method) {
      const r = waiting.get(m.id);
      waiting.delete(m.id);
      if (r) r(m.result);
    } else if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [], agentInfo: { name: 'fake', version: '0' } } });
    else if (m.method === 'session/new') {
      if (process.env.FAKE_ACP_AUTH) send({ id: m.id, error: { code: -32000, message: 'Authentication required' } });
      else {
        cwd = m.params.cwd;
        send({ id: m.id, result: { sessionId: 'S1', configOptions: config() } });
      }
    } else if (m.method === 'session/set_config_option') {
      if (m.params.configId === 'model') model = m.params.value;
      if (m.params.configId === 'reasoning') level = m.params.value;
      send({ id: m.id, result: { configOptions: config() } });
    } else if (m.method === 'session/prompt') prompt(m.id, m.params);
    else if (m.method === 'session/cancel') cancel && cancel();
    else if (m.id != null) send({ id: m.id, error: { code: -32601, message: 'unknown' } });
  }
});
