// Bundles the UI into dist/ and copies the static files pdf.js needs.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist');
fs.mkdirSync(dist, { recursive: true });

function copyStatic() {
  fs.copyFileSync(path.join(root, 'web', 'index.html'), path.join(dist, 'index.html'));
  fs.copyFileSync(path.join(root, 'web', 'styles.css'), path.join(dist, 'styles.css'));
  for (const f of fs.readdirSync(path.join(root, 'web', 'assets'))) fs.copyFileSync(path.join(root, 'web', 'assets', f), path.join(dist, f));
  fs.copyFileSync(path.join(pdfjs, 'build', 'pdf.worker.min.mjs'), path.join(dist, 'pdf.worker.min.mjs'));
  fs.copyFileSync(path.join(pdfjs, 'web', 'pdf_viewer.css'), path.join(dist, 'pdf_viewer.css'));
  for (const d of ['cmaps', 'standard_fonts']) fs.cpSync(path.join(pdfjs, d), path.join(dist, d), { recursive: true });
}

const opts = {
  entryPoints: [path.join(root, 'web', 'src', 'main.js')],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outfile: path.join(dist, 'app.js'),
  sourcemap: true,
  minify: !process.argv.includes('--watch'),
  logLevel: 'info',
  // pdf.js references Node modules behind runtime checks; not needed here.
  external: ['canvas', 'path2d-polyfill', 'fs', 'url', 'http', 'https', 'zlib'],
};

copyStatic();
if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  fs.watch(path.join(root, 'web'), { recursive: true }, (_e, f) => f && !f.startsWith('src') && copyStatic());
} else {
  await esbuild.build(opts);
}
