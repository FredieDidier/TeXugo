// Runs the TeXugo server without Electron, for development in a browser.
import { createServer } from './index.js';

const port = Number(process.env.PORT || 4777);
const token = process.env.TEXUGO_TOKEN || (process.argv.includes('--dev') ? 'dev' : undefined);
const s = await createServer({ port, token });
console.log(`TeXugo em ${s.url}`);
