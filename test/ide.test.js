// Claude Code bridge: the protocol Claude Code speaks to IDEs (auth, MCP
// handshake, tools), with a fake page standing in for the editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { IdeBridge } from '../server/ide.js';

test('bridge: auth, initialize, selection, diagnostics, openDiff', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-home-'));
  const realHome = process.env.HOME;
  process.env.HOME = home; // keep the lock file out of the real ~/.claude
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-proj-'));
  const file = path.join(root, 'paper.tex');
  fs.writeFileSync(file, 'It is worth noting that we use logs.\n');
  const asked = [];
  const ide = new IdeBridge({
    broadcast: () => {},
    askUi: async (type, payload) => (asked.push({ type, payload }), type === 'ide:openDiff' ? { accepted: true } : {}),
    diagnostics: () => [{ file, line: 1, severity: 'Error', message: 'Undefined control sequence.' }],
    allowed: (p) => p.startsWith(root),
  });
  try {
    const port = await ide.start();
    ide.setFolders([root]);
    const lock = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'ide', `${port}.lock`), 'utf8'));
    assert.equal(lock.ideName, 'TeXugo');
    assert.deepEqual(lock.workspaceFolders, [root]);
    assert.match(lock.authToken, /^[0-9a-f]{32}$/);

    await assert.rejects(new Promise((res, rej) => {
      const bad = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { 'x-claude-code-ide-authorization': '0'.repeat(32) } });
      bad.on('open', res);
      bad.on('error', rej);
    }));

    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { 'x-claude-code-ide-authorization': lock.authToken } });
    await new Promise((r) => ws.on('open', r));
    let id = 0;
    const waiting = new Map();
    const notes = [];
    ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d.id && waiting.has(d.id)) waiting.get(d.id)(d);
      else notes.push(d);
    });
    const rpc = (method, params = {}) => new Promise((r) => (waiting.set(++id, r), ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))));
    const tool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result.content;

    const init = await rpc('initialize', { clientInfo: { name: 'claude-code' }, capabilities: {} });
    assert.equal(init.result.serverInfo.name, 'texugo');
    const names = (await rpc('tools/list')).result.tools.map((t) => t.name);
    for (const n of ['openDiff', 'getCurrentSelection', 'getDiagnostics', 'getOpenEditors', 'openFile']) assert.ok(names.includes(n), n);

    ide.setTabs([{ path: file, active: true, dirty: false, lines: 2 }]);
    ide.setSelection({ filePath: file, text: 'It is worth noting', start: { line: 0, character: 0 }, end: { line: 0, character: 18 }, isEmpty: false });
    const sel = JSON.parse((await tool('getCurrentSelection'))[0].text);
    assert.equal(sel.text, 'It is worth noting');
    assert.equal(sel.selection.end.character, 18);
    assert.ok(notes.some((n) => n.method === 'selection_changed'));

    const diag = JSON.parse((await tool('getDiagnostics'))[0].text);
    assert.equal(diag[0].diagnostics[0].severity, 'Error');

    const content = await tool('openDiff', { old_file_path: file, new_file_path: file, new_file_contents: 'We use logs.\n', tab_name: 't' });
    assert.equal(content[0].text, 'FILE_SAVED');
    assert.equal(content[1].text, 'We use logs.\n');
    const shown = asked.find((a) => a.type === 'ide:openDiff').payload;
    assert.equal(shown.oldText, 'It is worth noting that we use logs.\n');

    // A file with unsaved changes in TeXugo is refused, so nothing is lost.
    ide.setTabs([{ path: file, active: true, dirty: true, lines: 2 }]);
    const refused = await rpc('tools/call', { name: 'openDiff', arguments: { old_file_path: file, new_file_path: file, new_file_contents: 'x', tab_name: 'u' } });
    assert.match(refused.error.message, /unsaved changes/);
    // Outside the open project: refused.
    const outside = await rpc('tools/call', { name: 'openDiff', arguments: { old_file_path: '/etc/hosts', new_file_path: '/etc/hosts', new_file_contents: 'x', tab_name: 'v' } });
    assert.ok(outside.error);
    ws.close();
  } finally {
    ide.wss && ide.wss.close();
    ide.removeLock();
    process.env.HOME = realHome;
  }
});
