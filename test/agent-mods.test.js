import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSession, claudeFlags } from '../server/agents/claude.js';

test('model and effort flags default to Opus 5.5, medium', () => {
  assert.deepEqual(claudeFlags({}), ['--model', 'claude-opus-5-5', '--effort', 'medium']);
  assert.deepEqual(claudeFlags({ model: 'claude-sonnet-5-5', effort: 'xhigh' }), ['--model', 'claude-sonnet-5-5', '--effort', 'xhigh']);
  assert.deepEqual(claudeFlags({ model: 'x; rm -rf ~', effort: 'huge' }), ['--model', 'claude-opus-5-5', '--effort', 'medium']);
});

test('mod lines (jev-model-router) and an outdated CLI reach the panel', () => {
  const out = [];
  const s = new ClaudeSession('/p', {}, (e) => out.push(e));
  s.line(JSON.stringify({ type: 'system', subtype: 'ui_status', plugin: 'jev-model-router@skills-dir', text: 'jev · fast 0.87 → haiku/low' }));
  s.line(JSON.stringify({ type: 'system', subtype: 'ui_log', plugin: 'jev-model-router@skills-dir', text: '[jev-model-router] main loop → effort low' }));
  s.line(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required' }] } }));
  assert.equal(out[0].kind, 'mod-status');
  assert.equal(out[0].text, 'jev · fast 0.87 → haiku/low');
  assert.equal(out[1].kind, 'mod-log');
  assert.equal(out[2].kind, 'error');
  assert.match(out[2].text, /claude update/);
});
