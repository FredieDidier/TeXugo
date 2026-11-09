// Runs the TeXugo server without Electron, for development in a browser.
import os from 'node:os';
import path from 'node:path';

// --dev keeps its own settings and recent projects, so testing never
// touches the ones of the installed app.
if (process.argv.includes('--dev') && !process.env.TEXUGO_DATA_DIR) {
  process.env.TEXUGO_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'TeXugo-dev');
}
const { createServer } = await import('./index.js');

const port = Number(process.env.PORT || 4777);
const token = process.env.TEXUGO_TOKEN || (process.argv.includes('--dev') ? 'dev' : undefined);
const s = await createServer({ port, token });
console.log(`TeXugo em ${s.url}`);
