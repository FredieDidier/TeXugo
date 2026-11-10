// Grammar and spelling through LanguageTool.
//
// Local by default: TeXugo starts the languagetool-server installed by
// Homebrew (brew install languagetool) on a free port the first time a check
// is asked for, and stops it when the app closes. A LanguageTool already
// listening on the default port 8081 (brew services) is reused. Nothing
// leaves the machine unless the user picks the online server in
// Preferências, which sends the paragraphs to api.languagetool.org.
//
// The page sends plain paragraphs (LaTeX already stripped, see
// web/src/grammar/text.js). Paragraphs of the same language are joined into
// one request (fewer round trips; the public API allows 20 per minute) and
// the matches are split back by offset. Results are cached per paragraph.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { toolEnv, which, sha1 } from './util.js';

const ONLINE = 'https://api.languagetool.org';
const SEP = '\n\n';
const MAX_BATCH = { local: 60000, online: 18000 }; // characters per request
// Rules that misfire on text that came out of LaTeX.
const DISABLED = [
  'WHITESPACE_RULE', 'COMMA_PARENTHESIS_WHITESPACE', 'EN_QUOTES', 'DASH_RULE', 'TYPOGRAPHY_SPACE',
  'PUNCTUATION_PARAGRAPH_END', 'SENTENCE_WHITESPACE', 'UNPAIRED_BRACKETS', 'EN_UNPAIRED_BRACKETS',
  'FRENCH_WHITESPACE', 'DOUBLE_PUNCTUATION', 'ARROWS', 'MULTIPLICATION_SIGN', 'PLUS_MINUS',
];

// In the strict mode ("rigoroso", the default) we also turn on the grammar
// rules LanguageTool ships switched off (default="off"/"temp_off" in its
// grammar.xml), except a few that flag correct text.
const NEVER = /E_PRIME|PASSIVE|SENT_START_COMMA_CONJUNCTION/;

const CANDIDATES = [
  '/opt/homebrew/opt/languagetool/bin/languagetool-server',
  '/usr/local/opt/languagetool/bin/languagetool-server',
];
const CONFIGS = ['/opt/homebrew/etc/languagetool/server.properties', '/usr/local/etc/languagetool/server.properties'];

async function findServer() {
  for (const c of CANDIDATES) if (fs.existsSync(c)) return c;
  return which('languagetool-server');
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function alive(base) {
  try {
    const r = await fetch(base + '/v2/languages', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// Ids of the switched-off grammar rules of a language ('pt', 'en'), read
// from the rule files next to the installed server.
export function offRules(bin, lang) {
  if (!bin) return [];
  let root;
  try {
    root = path.join(path.dirname(fs.realpathSync(bin)), '..', 'libexec', 'org', 'languagetool', 'rules', lang);
  } catch {
    return [];
  }
  const files = [path.join(root, 'grammar.xml')];
  if (lang === 'pt') files.push(path.join(root, 'pt-BR', 'grammar.xml'));
  const ids = new Set();
  for (const f of files) {
    let s;
    try {
      s = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const m of s.matchAll(/<(?:rulegroup|rule)\b([^>]*)>/g)) {
      if (!/default=['"](?:off|temp_off)['"]/.test(m[1])) continue;
      const id = (m[1].match(/id=['"]([^'"]+)/) || [])[1];
      if (id && !NEVER.test(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

export class Grammar {
  constructor(broadcast = () => {}) {
    this.broadcast = broadcast;
    this.child = null;
    this.base = null; // URL of the local server once up
    this.starting = null;
    this.cache = new Map(); // sha1(lang + text) -> matches
    this.installing = null;
    this.off = new Map(); // 'pt' | 'en' -> rule ids
  }

  async offFor(ltLang) {
    const lang = ltLang.slice(0, 2);
    if (!this.off.has(lang)) this.off.set(lang, offRules(await findServer(), lang));
    return this.off.get(lang);
  }

  async status() {
    const bin = await findServer();
    const brew = await which('brew');
    return { installed: !!bin, running: !!this.base, brew: !!brew, installing: !!this.installing };
  }

  // Starts (or finds) the local server; resolves with its base URL.
  async local() {
    if (this.base && (await alive(this.base))) return this.base;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (await alive('http://127.0.0.1:8081')) return (this.base = 'http://127.0.0.1:8081');
      const bin = await findServer();
      if (!bin) {
        const err = new Error('O LanguageTool não está instalado.');
        err.code = 'NOT_INSTALLED';
        throw err;
      }
      const port = await freePort();
      const args = ['--port', String(port)];
      const conf = CONFIGS.find((c) => fs.existsSync(c));
      if (conf) args.unshift('--config', conf);
      const child = spawn(bin, args, { env: toolEnv(), stdio: 'ignore', detached: true });
      this.child = child;
      child.on('close', () => {
        if (this.child === child) {
          this.child = null;
          this.base = null;
        }
      });
      const base = `http://127.0.0.1:${port}`;
      // Java takes a few seconds to come up.
      for (let k = 0; k < 120; k++) {
        if (await alive(base)) return (this.base = base);
        if (!this.child) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      this.stop();
      throw new Error('O LanguageTool não respondeu. Tente de novo ou veja se o Java está instalado.');
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  stop() {
    if (!this.child) return;
    try {
      process.kill(-this.child.pid, 'SIGTERM');
    } catch {
      this.child.kill('SIGTERM');
    }
    this.child = null;
    this.base = null;
  }

  // paras: [{ text, lang }] with lang a LanguageTool code (pt-BR, en-US).
  // Returns, for each paragraph, [{ offset, length, message, short, rule,
  // category, type, replacements }].
  async check(paras, { server = 'local', disabledRules = [], level = 'picky' } = {}) {
    const base = server === 'online' ? ONLINE : await this.local();
    const max = MAX_BATCH[server === 'online' ? 'online' : 'local'];
    const out = paras.map(() => null);
    const disabled = [...new Set([...DISABLED, ...disabledRules])];
    const key = (p) => sha1(p.lang + '\u0000' + level + '\u0000' + disabled.join(',') + '\u0000' + p.text);
    // Batches of uncached paragraphs, one language each.
    const batches = [];
    const open = new Map();
    paras.forEach((p, i) => {
      const k = key(p);
      if (this.cache.has(k)) return (out[i] = this.cache.get(k));
      let b = open.get(p.lang);
      if (!b || b.size + p.text.length > max) {
        b = { lang: p.lang, items: [], size: 0 };
        batches.push(b);
        open.set(p.lang, b);
      }
      b.items.push(i);
      b.size += p.text.length + SEP.length;
    });
    const runBatch = async (b) => {
      let text = '';
      const starts = [];
      for (const i of b.items) {
        if (text) text += SEP;
        starts.push(text.length);
        text += paras[i].text;
      }
      const body = new URLSearchParams({ text, language: b.lang, disabledRules: disabled.join(','), level: level === 'default' ? 'default' : 'picky' });
      if (level !== 'default') {
        const on = (await this.offFor(b.lang)).filter((id) => !disabled.includes(id));
        if (on.length) body.set('enabledRules', on.join(','));
      }
      const r = await fetch(base + '/v2/check', { method: 'POST', body, signal: AbortSignal.timeout(120000) });
      if (r.status === 429) throw new Error('O servidor online do LanguageTool recusou: limite de consultas por minuto. Espere um pouco.');
      if (!r.ok) throw new Error(`LanguageTool respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const data = await r.json();
      const per = b.items.map(() => []);
      for (const m of data.matches || []) {
        // Which paragraph does this match fall in?
        let k = starts.length - 1;
        while (k > 0 && starts[k] > m.offset) k--;
        const off = m.offset - starts[k];
        if (off + m.length > paras[b.items[k]].text.length) continue; // spans the separator
        per[k].push({
          offset: off,
          length: m.length,
          message: m.message,
          short: m.shortMessage || '',
          rule: m.rule && m.rule.id,
          ruleDesc: m.rule && m.rule.description,
          category: m.rule && m.rule.category && m.rule.category.name,
          type: (m.rule && m.rule.issueType) || '',
          replacements: (m.replacements || []).slice(0, 5).map((x) => x.value),
        });
      }
      b.items.forEach((i, k) => {
        out[i] = per[k];
        this.cache.set(key(paras[i]), per[k]);
      });
    };
    // A few batches at a time.
    const queue = [...batches];
    const workers = Array.from({ length: server === 'online' ? 1 : 3 }, async () => {
      while (queue.length) await runBatch(queue.shift());
    });
    await Promise.all(workers);
    if (this.cache.size > 5000) this.cache.clear();
    return out;
  }

  // brew install languagetool, with the output streamed to the page.
  install() {
    if (this.installing) return this.installing;
    this.installing = (async () => {
      const brew = await which('brew');
      if (!brew) throw new Error('Homebrew não encontrado. Instale em https://brew.sh e tente de novo.');
      const code = await new Promise((resolve) => {
        const child = spawn(brew, ['install', 'languagetool'], { env: { ...toolEnv(), HOMEBREW_NO_AUTO_UPDATE: '1' } });
        const send = (d) => this.broadcast({ type: 'grammar:install', text: d.toString() });
        child.stdout.on('data', send);
        child.stderr.on('data', send);
        child.on('error', () => resolve(-1));
        child.on('close', (c) => resolve(c == null ? -1 : c));
      });
      if (code !== 0) throw new Error('A instalação pelo Homebrew falhou (veja a saída).');
      return true;
    })();
    return this.installing.finally(() => (this.installing = null));
  }
}

export { DISABLED };
