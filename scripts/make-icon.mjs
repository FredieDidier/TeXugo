// Renders web/assets/logo.svg to build/icon.png and build/icon.icns (macOS
// tools only: qlmanage, sips, iconutil).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'build');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-icon-'));
fs.mkdirSync(out, { recursive: true });
execFileSync('qlmanage', ['-t', '-s', '1024', '-o', tmp, path.join(root, 'web', 'assets', 'logo.svg')], { stdio: 'ignore' });
const png = path.join(out, 'icon.png');
fs.copyFileSync(path.join(tmp, 'logo.svg.png'), png);
const set = path.join(tmp, 'icon.iconset');
fs.mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  execFileSync('sips', ['-z', String(s), String(s), png, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
  execFileSync('sips', ['-z', String(s * 2), String(s * 2), png, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(out, 'icon.icns')]);
console.log('build/icon.png, build/icon.icns');
