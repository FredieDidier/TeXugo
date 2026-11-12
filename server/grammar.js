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
import { toolEnv, which, sha1, dataDir } from './util.js';
import { ACADEMIC_WORDS } from './academic-words.js';
import { killTree } from './platform.js';
import { Ngrams } from './ngrams.js';

const ONLINE = 'https://api.languagetool.org';
const SEP = '\n\n';
const MAX_BATCH = { local: 60000, online: 18000 }; // characters per request
// Rules that misfire on text that came out of LaTeX.
const DISABLED = [
  'WHITESPACE_RULE', 'COMMA_PARENTHESIS_WHITESPACE', 'EN_QUOTES', 'DASH_RULE', 'TYPOGRAPHY_SPACE',
  'PUNCTUATION_PARAGRAPH_END', 'SENTENCE_WHITESPACE', 'UNPAIRED_BRACKETS', 'EN_UNPAIRED_BRACKETS',
  'FRENCH_WHITESPACE', 'DOUBLE_PUNCTUATION', 'ARROWS', 'MULTIPLICATION_SIGN', 'PLUS_MINUS',
];

// Rules that, run over 30 real academic documents (papers, appendices,
// CVs, a thesis and a report, in English and Portuguese, about 1,700
// flags), were wrong in every case we read, or only gave style opinions on
// correct text: "a comma before every and", "missing article" in "per
// outcome", "an offset" taken as an error, the Oxford comma, the straight
// apostrophe that LaTeX prints curly, "nº", "de um" -> "dum", CEP numbers,
// a heading without a period. Off in both modes.
// Re-audited 10/11/2026 over 37 files: FEWER_LESS ("less observations")
// gave one false alarm and ERRO_DE_CONCORDNCIA_DO_GÉNERO_FEMININO_A ("a
// impacto") none, so both are back on.
const AUDITED = [
  'TYPOGRAPHICAL_APOSTROPHE', 'COMMA_BEFORE_AND', 'ARTICLE_MISSING', 'TOO_LONG_SENTENCE', 'ENGLISH_WORD_REPEAT_BEGINNING_RULE',
  'ARTICLE_UNNECESSARY', 'COMMA_WHICH', 'SERIAL_COMMA_ON', 'SERIAL_COMMA_OFF', 'REP_PASSIVE_VOICE', 'DID_FOUND_AMBIGUOUS', 'NOUN_AROUND_IT',
  'PRP_COMMA', 'AFTERWARDS_US', 'ONES', 'SO_AS_TO', 'WHETHER', 'SMALL_NUMBER_OF', 'OF_ANY_OF', 'MISSING_COMMA_AFTER_INTRODUCTORY_PHRASE',
  'POSSESSIVE_APOSTROPHE', 'APOS_ARE', 'RELATIVE_CLAUSE_AGREEMENT', 'THE_WORSE_OF', 'A_INFINITIVE', 'PCT_SINGULAR_NOUN_PLURAL_VERB_AGREEMENT',
  'GRADUATE_FROM', 'COLLECTIVE_NOUN_VERB_AGREEMENT_VBP', 'OUR_OUT', 'THE_MOST', 'THE_SUPERLATIVE', 'PRP_JJ',
  'AGREEMENT_SENT_START_2', 'ADVERB_WORD_ORDER', 'SENTENCE_FRAGMENT', 'A_INSTALL', 'AT_IN_THE_MORNING', 'CONCENTRATE_WITH_ON', 'GETS_WORST',
  'MISSING_COMMA_AFTER_YEAR', 'ARE_WE_HAVE', 'ADVERB_OR_HYPHENATED_ADJECTIVE', 'WHAT_VBZ', 'COMMA_COMPOUND_SENTENCE', 'COMMA_COMPOUND_SENTENCE_2',
  'EN_COMPOUNDS_BIRTH_DATE', 'EN_COMPOUNDS_BIRTH_DATES', 'PLURAL_THAT_AGREEMENT', 'PRP_HAVE_VB',
  'NUMBER_ABREVIATION', 'CONTRACAO_DUM', 'EM_QUE_ONDE_NO_QUAL', 'ERRO_DE_CONCORDNCIA_DO_NMERO_DO_VERBO_3P-2',
  'PERCENT_WITH_SPACE', 'GENERAL_NUMBER_FORMAT', 'FINAL_STOPS', 'DASH_ENUMERATION_NO_SPACE_RULE', 'SENT_START_NUM',
];
// Families of rules with many ids: "this word was used in a nearby
// sentence" (EN_REPEATEDWORDS_AFFECT, ..._WHOLE, ...).
// "Oxford spelling" (-ize in British English) is a style choice, not an
// error.
const AUDITED_FAMILY = /^(?:EN_REPEATEDWORDS_|CONTRACAO_D|OXFORD_SPELLING_)/;

// Spelling rule of each language, and the languages a word flagged in one
// is looked up in before it counts as a mistake: research writing mixes
// American and British spelling, and English and Portuguese.
const SPELLER = { 'en-US': 'MORFOLOGIK_RULE_EN_US', 'en-GB': 'MORFOLOGIK_RULE_EN_GB', 'pt-BR': 'MORFOLOGIK_RULE_PT_BR' };
const OTHERS = { 'en-US': ['en-GB', 'pt-BR'], 'en-GB': ['en-US', 'pt-BR'], 'pt-BR': ['en-US', 'en-GB'] };

// In the strict mode ("rigoroso", the default) we also turn on the grammar
// rules LanguageTool ships switched off (default="off"/"temp_off" in its
// grammar.xml), except a few that flag correct text.
const NEVER = /E_PRIME|PASSIVE|SENT_START_COMMA_CONJUNCTION/;
const isSpeller = (id) => /^(MORFOLOGIK_RULE_|HUNSPELL_RULE)/.test(id || '');
const isAudited = (id) => AUDITED.includes(id) || AUDITED_FAMILY.test(id);

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
      if (id && !NEVER.test(id) && !isAudited(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

// The server we started is recorded here, so a session that ended without
// cleaning up (crash, forced quit, interrupted npm run serve) does not leave
// a JVM behind for good: the next start reuses it or ends it.
const pidFile = () => path.join(dataDir(), 'languagetool.pid');
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function readPid() {
  try {
    const { pid, port, lm } = JSON.parse(fs.readFileSync(pidFile(), 'utf8'));
    return pid ? { pid, port, lm: lm || null } : null;
  } catch {
    return null;
  }
}
function endPid(pid) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
}
const live = new Set();
process.on('exit', () => {
  for (const g of live) g.stop();
});

// Arguments of the local server: the port, Homebrew's config file when there
// is one, and the n-gram folder once the advanced English data is ready.
export function serverArgs({ port, conf = null, lm = null }) {
  const args = ['--port', String(port)];
  if (conf) args.unshift('--config', conf);
  if (lm) args.push('--languageModel', lm);
  return args;
}

export class Grammar {
  constructor(broadcast = () => {}, { ngrams } = {}) {
    this.broadcast = broadcast;
    this.ngrams = ngrams || new Ngrams({ broadcast });
    this.lm = null; // n-gram folder the running server was started with
    this.child = null;
    this.base = null; // URL of the local server once up
    this.starting = null;
    this.cache = new Map(); // sha1(lang + text) -> matches
    this.installing = null;
    this.off = new Map(); // 'pt' | 'en' -> rule ids
    this.known = new Map(); // `${lang}|${word}` -> the speller of lang accepts it
  }

  // Which of `words` the speller of `lang` accepts (one request).
  async accepts(base, lang, words) {
    const todo = [...new Set(words)].filter((w) => !this.known.has(`${lang}|${w}`));
    if (todo.length && SPELLER[lang]) {
      const text = todo.join('\n\n');
      const body = new URLSearchParams({ text, language: lang, enabledOnly: 'true', enabledRules: SPELLER[lang] });
      const bad = new Set();
      try {
        const r = await fetch(base + '/v2/check', { method: 'POST', body, signal: AbortSignal.timeout(60000) });
        if (r.ok) for (const m of (await r.json()).matches || []) bad.add(text.slice(m.offset, m.offset + m.length));
        else return new Set();
      } catch {
        return new Set();
      }
      for (const w of todo) this.known.set(`${lang}|${w}`, !bad.has(w));
      if (this.known.size > 20000) this.known.clear();
    }
    return new Set(words.filter((w) => this.known.get(`${lang}|${w}`)));
  }

  // Drops spelling flags on words another variant or language knows, and on
  // hyphenated compounds whose parts are all known words.
  async keepRealTypos(base, lang, paras, per) {
    const flagged = [];
    // Only the speller's own flags: LanguageTool also files grammar rules
    // such as EN_A_VS_AN ("a instrumental"), THEIR_IS and IT_IS under
    // "misspelling", and their words ("a", "their") are real words.
    per.forEach((ms, k) => ms.forEach((m) => m.type === 'misspelling' && flagged.push({ m, k, w: paras[k].text.slice(m.offset, m.offset + m.length) })));
    if (!flagged.length) return per;
    const words = flagged.map((f) => f.w).filter((w) => /^[\p{L}'’-]+$/u.test(w));
    const parts = words.flatMap((w) => (w.includes('-') ? w.split('-').filter(Boolean) : []));
    const ok = new Set();
    for (const other of OTHERS[lang] || []) for (const w of await this.accepts(base, other, [...words, ...parts])) ok.add(w);
    for (const w of await this.accepts(base, lang, parts)) ok.add(w);
    const known = (w) => ok.has(w) || ACADEMIC_WORDS.has(w.toLowerCase());
    const drop = new Set(flagged.filter((f) => known(f.w) || (f.w.includes('-') && f.w.split('-').filter(Boolean).every(known))).map((f) => f.m));
    return per.map((ms) => ms.filter((m) => !drop.has(m)));
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
    const lm = this.ngrams.languageModelDir();
    // The n-gram data came or went since the server started: restart it.
    if (this.base && this.lm !== lm) this.stop(), (this.base = null);
    if (this.base && (await alive(this.base))) return this.base;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      // A LanguageTool already on 8081 (brew services) has no TeXugo n-grams:
      // with them installed, TeXugo runs its own server.
      if (!lm && (await alive('http://127.0.0.1:8081'))) return (this.lm = null), (this.base = 'http://127.0.0.1:8081');
      const prev = readPid();
      if (prev && isAlive(prev.pid)) {
        const b = `http://127.0.0.1:${prev.port}`;
        if (prev.port && (prev.lm || null) === lm && (await alive(b))) return (this.lm = lm), (this.base = b);
        endPid(prev.pid);
      }
      const bin = await findServer();
      if (!bin) {
        const err = new Error('O LanguageTool não está instalado.');
        err.code = 'NOT_INSTALLED';
        throw err;
      }
      const port = await freePort();
      const args = serverArgs({ port, conf: CONFIGS.find((c) => fs.existsSync(c)) || null, lm });
      const child = spawn(bin, args, { env: toolEnv(), stdio: 'ignore', detached: true });
      this.child = child;
      this.lm = lm;
      live.add(this);
      try {
        fs.writeFileSync(pidFile(), JSON.stringify({ pid: child.pid, port, lm }));
      } catch {}
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
    live.delete(this);
    try {
      if (readPid()?.pid === this.child.pid) fs.rmSync(pidFile());
    } catch {}
    killTree(this.child);
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
    const disabled = [...new Set([...DISABLED, ...AUDITED, ...disabledRules])];
    // Results with and without the n-gram data differ: the key says which.
    const lmTag = server === 'online' ? 'online' : this.lm ? 'ngrams' : '';
    const key = (p) => sha1(p.lang + '\u0000' + level + '\u0000' + lmTag + '\u0000' + disabled.join(',') + '\u0000' + p.text);
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
        if (m.rule && isAudited(m.rule.id)) continue;
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
          // Grammar rules LanguageTool files as "misspelling" are grammar here.
          type: m.rule && m.rule.issueType === 'misspelling' && !isSpeller(m.rule.id) ? 'grammar' : (m.rule && m.rule.issueType) || '',
          replacements: (m.replacements || []).slice(0, 5).map((x) => x.value),
        });
      }
      const kept = await this.keepRealTypos(base, b.lang, b.items.map((i) => paras[i]), per);
      b.items.forEach((i, k) => {
        out[i] = kept[k];
        this.cache.set(key(paras[i]), kept[k]);
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
      if (!brew && process.platform !== 'darwin')
        throw new Error('No Windows e no Linux, instale o Java e o LanguageTool (https://languagetool.org/download/) com o languagetool-server no PATH, ou escolha o servidor online em Preferências.');
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

export { DISABLED, AUDITED };
