// Builds the installers with electron-builder (config in electron-builder.yml):
// the page bundle, the third-party notices, then the targets for the system
// this runs on. Extra arguments go to electron-builder, e.g. `--mac --arm64`.
//
// The build happens in the system's temporary folder, and only the finished
// installers are copied to out/dist. A project inside an iCloud-synced
// folder (Documents, Desktop) gets Finder attributes added to every .app
// folder, which breaks the Mac signature.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNotices } from './notices.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(os.tmpdir(), 'texugo-dist');
const out = path.join(root, 'out', 'dist');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

run('npm', ['run', 'build:web']);
await writeNotices();
fs.rmSync(work, { recursive: true, force: true });
run('npx', ['electron-builder', `--config.directories.output=${work}`, ...process.argv.slice(2)]);

fs.mkdirSync(out, { recursive: true });
const made = fs.readdirSync(work).filter((f) => /\.(dmg|exe|AppImage)$/.test(f));
for (const f of made) fs.copyFileSync(path.join(work, f), path.join(out, f));
console.log(made.length ? `Instaladores em ${out}:\n  ${made.join('\n  ')}` : 'Nenhum instalador gerado.');
