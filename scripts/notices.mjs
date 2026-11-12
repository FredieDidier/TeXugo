// THIRD-PARTY-NOTICES.txt: the license text of every package that ships in
// the app, either copied into the bundle (dependencies, Electron) or
// embedded in dist/app.js by esbuild. `node scripts/notices.mjs` rewrites
// the file; test/notices.test.js fails when a shipped package is missing.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const NOTICES = path.join(root, 'THIRD-PARTY-NOTICES.txt');

// Package name from a path inside node_modules (the innermost one).
function pkgOf(file) {
  const parts = file.split(/[\\/]/);
  const i = parts.lastIndexOf('node_modules');
  if (i < 0) return null;
  return parts[i + 1]?.startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
}

// Packages esbuild puts into dist/app.js.
export async function bundledPackages() {
  const esbuild = await import('esbuild');
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'web', 'src', 'main.js')],
    bundle: true,
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
    external: ['canvas', 'path2d-polyfill', 'fs', 'url', 'http', 'https', 'zlib'],
  });
  return [...new Set(Object.keys(r.metafile.inputs).map(pkgOf).filter(Boolean))];
}

// Packages copied as they are: runtime dependencies, Electron, and pdf.js
// (its worker, CMaps and fonts are copied to dist/ besides the bundle).
export function copiedPackages() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return [...Object.keys(pkg.dependencies || {}), 'electron', 'pdfjs-dist'];
}

export async function shippedPackages() {
  return [...new Set([...copiedPackages(), ...(await bundledPackages())])].sort();
}

function licenseText(dir, meta) {
  const f = fs.readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.|$)/i.test(n));
  if (f) return fs.readFileSync(path.join(dir, f), 'utf8').trim();
  const author = typeof meta.author === 'string' ? meta.author : meta.author?.name;
  return `License: ${meta.license || 'see package'}${author ? `\nCopyright (c) ${author}` : ''}`;
}

export async function writeNotices() {
  const names = await shippedPackages();
  let out = 'TeXugo includes the following third-party software.\n' +
    'Chromium\'s own notices ship with the app as LICENSES.chromium.html.\n';
  for (const name of names) {
    const dir = path.join(root, 'node_modules', name);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    out += `\n${'='.repeat(72)}\n${name} ${meta.version} (${meta.license || '?'})\n${'='.repeat(72)}\n\n${licenseText(dir, meta)}\n`;
  }
  fs.writeFileSync(NOTICES, out);
  return names;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = await writeNotices();
  console.log(`THIRD-PARTY-NOTICES.txt: ${names.length} pacotes`);
}
