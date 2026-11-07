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
