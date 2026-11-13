// Runs the unit tests, all of them or only those that do not need a TeX
// installation (`--no-tex`), so the CI can run the fast part on every system
// and the TeX part where TeX Live is installed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// These compile documents (latexmk, latexdiff, biber) and fail without TeX.
export const NEEDS_TEX = ['build', 'compare', 'live', 'rr', 'sent', 'submission', 'templates'];

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test');
const noTex = process.argv.includes('--no-tex');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !noTex || !NEEDS_TEX.includes(f.replace(/\.test\.js$/, '')))
  .sort()
  .map((f) => path.join('test', f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
