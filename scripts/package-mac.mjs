// Builds out/TeXugo.app from the Electron binary in node_modules, without
// electron-builder: copy the bundle, drop our app in Resources/app, set the
// name, identifier and icon, and sign ad hoc so macOS runs it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, 'out');
const appDir = path.join(out, 'TeXugo.app');
const src = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');

fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync('ditto', [src, appDir]);

const res = path.join(appDir, 'Contents', 'Resources');
fs.rmSync(path.join(res, 'default_app.asar'), { force: true });
const dest = path.join(res, 'app');
fs.mkdirSync(dest, { recursive: true });
const copy = (rel) => fs.cpSync(path.join(root, rel), path.join(dest, rel), { recursive: true });
['electron', 'server', 'dist', 'build'].forEach(copy);
fs.rmSync(path.join(dest, 'dist', 'app.js.map'), { force: true });
fs.mkdirSync(path.join(dest, 'node_modules'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules', 'ws'), path.join(dest, 'node_modules', 'ws'), { recursive: true });
// node-pty (terminals): its JavaScript and the prebuilt N-API binary for
// this Mac, which works in Electron as it does in Node. The helper it spawns
// through must be executable.
{
  const src = path.join(root, 'node_modules', 'node-pty');
  const dst = path.join(dest, 'node_modules', 'node-pty');
  for (const rel of ['package.json', 'lib', 'LICENSE']) fs.cpSync(path.join(src, rel), path.join(dst, rel), { recursive: true });
  for (const arch of ['arm64', 'x64']) {
    const pre = path.join(src, 'prebuilds', `darwin-${arch}`);
    if (!fs.existsSync(pre)) continue;
    fs.cpSync(pre, path.join(dst, 'prebuilds', `darwin-${arch}`), { recursive: true });
    fs.chmodSync(path.join(dst, 'prebuilds', `darwin-${arch}`, 'spawn-helper'), 0o755);
  }
}
const slim = { name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, type: pkg.type, dependencies: pkg.dependencies };
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(slim, null, 2));

fs.copyFileSync(path.join(root, 'build', 'icon.icns'), path.join(res, 'electron.icns'));
const plist = path.join(appDir, 'Contents', 'Info.plist');
const set = (key, value) => execFileSync('plutil', ['-replace', key, '-string', value, plist]);
set('CFBundleName', 'TeXugo');
set('CFBundleDisplayName', 'TeXugo');
set('CFBundleIdentifier', 'br.fredie.texugo');
set('CFBundleShortVersionString', pkg.version);
set('CFBundleVersion', pkg.version);
set('CFBundleIconFile', 'electron.icns');
// The main executable gives the process its name in Activity Monitor.
fs.renameSync(path.join(appDir, 'Contents', 'MacOS', 'Electron'), path.join(appDir, 'Contents', 'MacOS', 'TeXugo'));
set('CFBundleExecutable', 'TeXugo');
execFileSync('xattr', ['-cr', appDir]);
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'inherit' });
console.log('Pronto:', appDir);

// Keep the copy in /Applications current, so opening TeXugo from the Dock
// or Launchpad never runs an old build.
const installed = '/Applications/TeXugo.app';
if (fs.existsSync(installed)) {
  fs.rmSync(installed, { recursive: true, force: true });
  execFileSync('ditto', [appDir, installed]);
  // The copy picks up extended attributes again (Finder info, provenance),
  // which break the signature and keep Finder from opening the app: clean
  // and re-sign it in place, then make sure it verifies.
  execFileSync('xattr', ['-cr', installed]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', installed], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', installed], { stdio: 'inherit' });
  console.log('Atualizado:', installed);
}
