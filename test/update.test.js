// Item 6: the new-version check against a fake GitHub Releases on localhost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isNewer, pickAsset, UpdateChecker } from '../server/update.js';

test('version comparison', () => {
  assert.equal(isNewer('0.2.0', '0.1.0'), true);
  assert.equal(isNewer('v0.1.10', '0.1.9'), true);
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
  assert.equal(isNewer('0.1.0', '0.2.0'), false);
  assert.equal(isNewer('0.2.0-beta', '0.2.0'), false);
  assert.equal(isNewer('0.2.0', '0.2.0-beta'), true);
  assert.equal(isNewer('garbage', '0.1.0'), false);
});

test('installer for this system', () => {
  const a = (name) => ({ name, browser_download_url: 'https://github.com/x/' + name, size: 1 });
  const assets = [a('TeXugo-0.2.0-arm64.dmg'), a('TeXugo-0.2.0-x64.dmg'), a('TeXugo-Setup-0.2.0.exe'), a('TeXugo-0.2.0.AppImage'), a('latest-mac.yml')];
  assert.equal(pickAsset(assets, 'darwin', 'arm64').name, 'TeXugo-0.2.0-arm64.dmg');
  assert.equal(pickAsset(assets, 'darwin', 'x64').name, 'TeXugo-0.2.0-x64.dmg');
  assert.equal(pickAsset(assets, 'win32', 'x64').name, 'TeXugo-Setup-0.2.0.exe');
  assert.equal(pickAsset(assets, 'linux', 'x64').name, 'TeXugo-0.2.0.AppImage');
  assert.equal(pickAsset([a('TeXugo-universal.dmg')], 'darwin', 'x64').name, 'TeXugo-universal.dmg');
  assert.equal(pickAsset([a('notes.txt')], 'darwin', 'arm64'), null);
});

test('checker: newer, cached for a day, 404, offline', async () => {
  let hits = 0;
  let reply = { status: 200, body: { tag_name: 'v0.3.0', html_url: 'https://github.com/o/r/releases/tag/v0.3.0', body: 'Notes', assets: [] } };
  const srv = http.createServer((req, res) => {
    hits++;
    assert.match(req.headers['user-agent'], /^TeXugo\/0\.1\.0 /);
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/latest`;
  try {
    const c = new UpdateChecker({ current: '0.1.0', url });
    const r = await c.check();
    assert.equal(r.newer, true);
    assert.equal(r.latest, '0.3.0');
    assert.equal(r.page, 'https://github.com/o/r/releases/tag/v0.3.0');
    await c.check();
    assert.equal(hits, 1, 'second check within a day uses the cache');
    reply = { status: 200, body: { tag_name: 'v0.4.0', prerelease: true, html_url: 'https://evil.example/x' } };
    const pre = await c.check({ force: true });
    assert.equal(pre.newer, false, 'pre-releases are not offered');
    assert.equal(pre.page, null, 'only github.com links');
    reply = { status: 404, body: {} };
    assert.equal((await c.check({ force: true })).newer, false);
  } finally {
    srv.close();
  }
  const off = new UpdateChecker({ current: '0.1.0', url: 'http://127.0.0.1:1/none' });
  assert.ok((await off.check()).error);
});
