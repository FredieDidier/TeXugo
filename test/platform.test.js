import test from 'node:test';
import assert from 'node:assert/strict';
import { appDataDir, extraPaths, openCommand, revealCommand, zipCommand, unzipCommand, userShell } from '../server/platform.js';
import { basename, dirname, joinPath, relPath, relParts, isUnder } from '../web/src/dom.js';
import { keyLabel } from '../web/src/i18n.js';

test('data folder and tool paths for each system', () => {
  assert.equal(appDataDir('TeXugo', { platform: 'darwin', home: '/Users/ana' }), '/Users/ana/Library/Application Support/TeXugo');
  assert.match(appDataDir('TeXugo', { platform: 'win32', env: { APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' }, home: 'C:\\Users\\ana' }), /Roaming[\\/]TeXugo$/);
  assert.equal(appDataDir('TeXugo', { platform: 'linux', env: {}, home: '/home/ana' }), '/home/ana/.config/TeXugo');
  assert.ok(extraPaths({ platform: 'darwin', home: '/Users/ana' }).includes('/Library/TeX/texbin'));
  // The Codex that comes with the ChatGPT app, last, so one installed by hand wins.
  const mac = extraPaths({ platform: 'darwin', home: '/Users/ana' });
  assert.equal(mac.at(-1), '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin');
  assert.ok(extraPaths({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, home: 'C:\\Users\\ana' }).some((p) => /MiKTeX/.test(p)));
  assert.deepEqual(openCommand('/a.pdf', 'linux'), ['xdg-open', ['/a.pdf']]);
  assert.deepEqual(revealCommand('C:\\p\\a.pdf', 'win32'), ['explorer.exe', ['/select,C:\\p\\a.pdf']]);
  assert.equal(zipCommand('o.zip', ['a'], 'win32')[0], 'tar.exe');
  assert.equal(unzipCommand('o.zip', 'd', 'darwin')[0], 'unzip');
  assert.equal(userShell('win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }).shell, 'C:\\Windows\\system32\\cmd.exe');
});

test('UI path helpers take Windows and POSIX paths', () => {
  const root = 'C:\\Users\\ana\\paper';
  const f = 'C:\\Users\\ana\\paper\\sections\\intro.tex';
  assert.equal(basename(f), 'intro.tex');
  assert.equal(dirname(f), 'C:\\Users\\ana\\paper\\sections');
  assert.equal(relPath(root, f), 'sections\\intro.tex');
  assert.deepEqual(relParts(root, f), ['sections', 'intro.tex']);
  assert.ok(isUnder(root, f) && !isUnder(root, 'C:\\Users\\ana\\paper2\\a.tex'));
  assert.equal(joinPath('C:\\Users\\ana\\paper\\sections', '../figs/a.png'), 'C:\\Users\\ana\\paper\\figs\\a.png');
  assert.equal(joinPath('/Users/ana/paper/sections', '../figs/a.png'), '/Users/ana/paper/figs/a.png');
  assert.equal(joinPath('/Users/ana/paper', '/tmp/x.tex'), '/tmp/x.tex');
  assert.equal(relPath('/Users/ana/paper', '/Users/ana/paper/a.tex'), 'a.tex');
});

test('Mac key symbols become Ctrl/Alt/Shift elsewhere', () => {
  assert.equal(keyLabel('⌥⌘B', false), 'Ctrl+Alt+B');
  assert.equal(keyLabel('⌘⇧↵', false), 'Ctrl+Shift+↵');
  assert.equal(keyLabel('⌘-clique no comentário', false), 'Ctrl-clique no comentário');
  assert.equal(keyLabel('Compilar (⌘↵)', false), 'Compilar (Ctrl+↵)');
  assert.equal(keyLabel('⌥⌘B', true), '⌥⌘B');
});

test('MiKTeX tools without Perl say so before failing (I17)', async () => {
  const { perlProblemFor } = await import('../server/util.js');
  const miktex = 'C:\\Users\\a\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64\\latexdiff.exe';
  assert.match(perlProblemFor({ tool: 'latexdiff', toolPath: miktex, perlPath: null, platform: 'win32' }), /Strawberry Perl/);
  assert.equal(perlProblemFor({ tool: 'latexdiff', toolPath: miktex, perlPath: 'C:\\Strawberry\\perl\\bin\\perl.exe', platform: 'win32' }), null);
  assert.equal(perlProblemFor({ tool: 'latexmk', toolPath: 'C:\\texlive\\2026\\bin\\windows\\latexmk.exe', perlPath: null, platform: 'win32' }), null);
  assert.equal(perlProblemFor({ tool: 'latexmk', toolPath: '/usr/bin/latexmk', perlPath: null, platform: 'linux' }), null);
});
