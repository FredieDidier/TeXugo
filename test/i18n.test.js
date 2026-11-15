// I9: the English interface must not show Portuguese. The UI is written in
// Portuguese and translated by web/src/i18n.js (exact sentences, then
// patterns for sentences built with numbers and names). This test reads
// every string literal of web/src, server and electron that looks
// Portuguese, fills template holes with sample values, and fails on those
// tr() leaves as they are. What never reaches the screen, or is translated
// another way, is listed below with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.document = { documentElement: {} };
const { tr, setLang } = await import('../web/src/i18n.js');
setLang('en');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Whole files that are not UI text, or translate themselves.
const SKIP_FILES = new Set([
  'web/src/i18n.js', // the dictionary itself
  'web/src/vicios/rules.js', // the writing-tic catalogue: Portuguese patterns and sources
  'web/src/vicios/core.js',
  'web/src/grammar/rules.js',
  'web/src/grammar/text.js', // LaTeX-to-prose conversion: Portuguese words it recognises
  'web/src/sent.js', // L(pt, en) everywhere
  'web/src/overleaf.js', // L(pt, en) everywhere
  'web/src/replication.js', // L(pt, en) everywhere
  'server/replication-journals.js', // journal data with L(pt, en) notes
  'server/academic-words.js', // word list for the speller
  'server/templates.js', // writes Portuguese templates on purpose
  'server/lang.js',
  'web/src/grammar/local.js', // word lists of the Portuguese agreement rule (its one message is in i18n.js)
]);
// Folders whose files are document content, not UI.
const SKIP_DIRS = ['server/templates/', 'web/src/vicios/', 'test/'];

// Single literals that are not UI text: Portuguese inside prompts to the
// model, rule ids, regular expressions, file names, keywords for search.
const SKIP_TEXT = [
  /^(?:pt|en|pt-BR|en-US|en-GB)$/,
  /<nota>|<texugo>|<estilo>|<antes>|<depois>/, // prompt tags
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.some((d) => (rel + '/').startsWith(d))) walk(rel, out);
    } else if (/\.(m?js|cjs)$/.test(e.name) && !SKIP_FILES.has(rel)) out.push(rel);
  }
  return out;
}

// String literals with their position: '…', "…" and `…${}…` (holes kept as
// markers). Comments and regular expression literals are skipped.
export function literals(src) {
  const out = [];
  let i = 0;
  let prev = ''; // last significant character, to tell a regex from a division
  const regexBefore = /[(,=:[!&|?{};+\-*%<>~^]|^$/;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 2;
      if (i < 2) break;
      continue;
    }
    if (c === '/' && (regexBefore.test(prev) || /\b(?:return|typeof|case|in|of)$/.test(src.slice(Math.max(0, i - 7), i).trimEnd()))) {
      // regex literal
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') j += 2;
        else {
          if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          else if (src[j] === '/' && !cls) break;
          j++;
        }
      }
      i = j + 1;
      while (/[a-z]/.test(src[i] || '')) i++;
      prev = 'x';
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') {
          const n = src[j + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' ? String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)) : n;
          j += n === 'u' ? 6 : 2;
        } else s += src[j++];
      }
      out.push({ text: s, at: i, kind: 'plain' });
      i = j + 1;
      prev = 'x';
      continue;
    }
    if (c === '`') {
      const r = template(src, i);
      out.push({ text: r.text, at: i, kind: 'template', holes: r.holes });
      for (const inner of r.inner) out.push(...literals(inner.code).map((x) => ({ ...x, at: inner.from + x.at, src: x.src })));
      i = r.end;
      prev = 'x';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// A template literal from `start`; holes become \u0001.
function template(src, start) {
  let j = start + 1;
  let text = '';
  let holes = 0;
  const inner = [];
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\') {
      const n = src[j + 1];
      text += n === 'n' ? '\n' : n;
      j += 2;
    } else if (src[j] === '$' && src[j + 1] === '{') {
      let depth = 1;
      let k = j + 2;
      const from = k;
      while (k < src.length && depth) {
        if (src[k] === '`') {
          k = template(src, k).end;
          continue;
        }
        if (src[k] === "'" || src[k] === '"') {
          const q = src[k];
          k++;
          while (k < src.length && src[k] !== q) k += src[k] === '\\' ? 2 : 1;
          k++;
          continue;
        }
        if (src[k] === '{') depth++;
        else if (src[k] === '}') depth--;
        k++;
      }
      inner.push({ code: src.slice(from, k - 1), from });
      text += '\u0001';
      holes++;
      j = k;
    } else text += src[j++];
  }
  return { text, holes, inner, end: j + 1 };
}

// Words only Portuguese has (not "as", "do", "no", "on", which English has too).
const PT_WORDS = /(?<![\p{L}])(?:não|você|está|são|já|também|até|então|só|arquivo|arquivos|pasta|projeto|abrir|salvar|compilar|nenhum|nenhuma|para|com|uma|dos|das|nos|nas|que|ao|pelo|pela|isso|esse|essa|este|esta|aqui|agora|depois|antes|ainda|mais|sem|mas|quando|onde|como|porque|seu|sua|seus|suas|foi|tem|há|linha|linhas|página|versão|aos|atalhos|comandos|resposta|parecer|pareceristas|mostrar|esconder|buscar|novo|nova)(?![\p{L}])/giu;
const EN_WORDS = /\b(?:the|and|of|to|is|are|you|your|with|for|this|that|not|it|be|from|or)\b/gi;
function looksPortuguese(s) {
  if (/^\s*(?:SELECT|INSERT|UPDATE|WITH)\b/.test(s)) return false; // SQL
  if (/^\s*\\(?:begin|section)\{/.test(s)) return false; // LaTeX snippets
  const en = (s.match(EN_WORDS) || []).length;
  const pt = new Set((s.match(PT_WORDS) || []).map((w) => w.toLowerCase())).size;
  const accents = /[ãõçáéíóúâêôà]/i.test(s);
  if (en >= 3 && en > pt * 2) return false; // English prose with a Portuguese word in it
  return accents || pt >= 2 || (pt === 1 && s.trim().split(/\s+/).length >= 2);
}

// Values tried in template holes: a plural ending, a number, a file, a
// name. Every combination is tried for up to four holes, so a sentence such
// as `${n} referência${n > 1 ? 's' : ''}` meets its pattern.
const SAMPLES = ['', 's', '2', 'paper.tex', 'Ana', 'ão', 'ões', 'es'];
const SHORT = SAMPLES.slice(0, 5);
function fills(text) {
  const parts = text.split('\u0001');
  if (parts.length === 1) return [text];
  const holes = parts.length - 1;
  const set = holes <= 3 ? SAMPLES : SHORT;
  const combos = holes <= 4 ? set.length ** holes : set.length;
  const out = [];
  for (let c = 0; c < combos; c++) {
    let s = parts[0];
    let k = c;
    for (let h = 1; h < parts.length; h++) {
      s += (holes <= 4 ? set[k % set.length] : set[c]) + parts[h];
      k = Math.floor(k / set.length);
    }
    out.push(s);
  }
  return out;
}
// A literal that opens a sentence ("Arquivo não encontrado: " + path) is
// tried with a value after it, which is how it reaches the screen.
function translated(text) {
  for (const s of fills(text)) {
    if (tr(s) !== s) return true;
    if (/[:(]\s*$|\s$/.test(s) && ['/x/paper.tex', '2', 'erro'].some((v) => tr(s + v) !== s + v)) return true;
  }
  return false;
}

// A template that is only a hole between fragments ("${a} · ${b}") has no
// sentence of its own; its parts are literals checked on their own.
const onlyGlue = (text) => text.replace(/\u0001/g, '').replace(/[\s·:,;.()\-–—/|+%?!]/g, '').length < 3;

// Is the literal shown to the user? Skips keys and arguments that are code:
// object keys, kw: search words, import paths, property names, classes.
function codeContext(src, at, len) {
  const before = src.slice(Math.max(0, at - 40), at);
  const after = src.slice(at + len, at + len + 3);
  if (/\bkw:\s*$/.test(before)) return true; // palette search keywords
  if (/\b(?:class|id|lang|role|data-[\w-]+|kind|type|name|key|rule|icon|i)\s*:\s*$/.test(before)) return true;
  if (/^\s*:/.test(after) && /[{,]\s*$/.test(before)) return true; // object key
  if (/\b(?:import|from|require)\s*\(?\s*$/.test(before)) return true;
  if (/\bnew RegExp\(\s*$/.test(before)) return true;
  if (/\b(?:querySelector(?:All)?|closest|matches|getAttribute|setAttribute|classList\.\w+|startsWith|endsWith|includes|split|join|replace)\(\s*$/.test(before)) return true;
  if (/\bL\(\s*$/.test(before)) return true; // L(pt, en): the pair is the translation
  return false;
}

const files = [...walk('web/src'), ...walk('server')];

test('every Portuguese UI string has an English translation', () => {
  const missing = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const lit of literals(src)) {
      const t = lit.text;
      // A word ending on its own ("ões" of "alteraç${n > 1 ? 'ões' : 'ão'}") is
      // part of a sentence checked as a whole.
      if (t.length < 4 || !/\s/.test(t.trim()) && t.length < 6 && !/^[A-Z]/.test(t)) continue;
      if (!looksPortuguese(t) || onlyGlue(t)) continue;
      if (SKIP_TEXT.some((re) => re.test(t))) continue;
      if (lit.kind === 'plain' && codeContext(src, lit.at, t.length + 2)) continue;
      if (translated(t)) continue;
      const line = src.slice(0, lit.at).split('\n').length;
      missing.push(`${rel}:${line}  ${JSON.stringify(t.replace(/\u0001/g, '${…}'))}`);
    }
  }
  const allow = new Set(fs.readFileSync(path.join(ROOT, 'test', 'i18n-allow.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  const left = missing.filter((m) => !allow.has(m.replace(/^[^ ]+:\d+ {2}/, '')));
  assert.deepEqual(left, [], `${left.length} strings without English (add them to web/src/i18n.js, or to test/i18n-allow.txt when they never reach the screen):\n${left.join('\n')}`);
});

// Sentences as they reach the screen, built in code from pieces the scan
// above lets through (test/i18n-allow.txt), and one-word labels the scan
// does not see. Each must come out in English, with no Portuguese left.
const RUNTIME = [
  'paper.tex linha 3', 'paper.tex linhas 3–5',
  '2 de 5 em aberto · sem SyncTeX: linhas aproximadas pelo texto',
  '2 referências saem como ?? no PDF.', '1 referência sai como ?? no PDF.',
  '2026-11-12 · Ana · Fix typo (último commit)',
  'paper.tex vai para o Lixo do macOS (dá para recuperar de lá).', 'paper.tex vai para a lixeira do sistema (dá para recuperar de lá).',
  '3 linhas coladas na tabela. ⌘Z desfaz.', 'Tabela 3×4 colada em LaTeX. ⌘Z desfaz. Falta \\usepackage{booktabs} no preâmbulo.',
  'A prévia parou na linha 12: Undefined control sequence. O PDF mostra a última versão boa.',
  '2 commits novos no remoto, ainda não baixados.', 'Parecer pronto: 1 ponto.', 'Parecer pronto: 12 pontos.', '1 entrada nova em refs.bib.', '3 entradas novas em refs.bib; 2 já estavam lá (mesma chave, DOI ou título).', '1 commit novo no remoto, ainda não baixado.', '2 commits no remoto, ainda não baixados',
  'Não instalado. Download de 9,0 GB; ocupa 15,4 GB depois de descompactado.', 'Baixar (9,0 GB)', 'Pausado em 40% de 9,0 GB.', 'Baixando: 12% de 9,0 GB.',
  'Instalado (15,4 GB no disco). O corretor usa os n-gramas em textos em inglês.',
  ' · cópia de 12/11/2026, 13:07 · o arquivo não existe mais no disco',
  '2 correções gravadas em refs.bib. ⌘Z não desfaz: use o Git ou edite o .bib.', '1 correção gravada em refs.bib. ⌘Z não desfaz: use o Git ou edite o .bib.',
  ' O Claude está lendo paper.tex e escrevendo o parecer… 1:05  ',
  '2 em aberto · último: Ana há 5 min',
  ' O Claude está lendo os pareceres e as mudanças… 0:42. Pode fechar esta janela; o arquivo abre quando ficar pronto. ',
  'response.tex: 12 comentários, 3 ainda a fazer (em vermelho). Compile o paper pelo TeXugo para as mudanças ganharem a página. ⌘-clique no comentário % arquivo:linha abre a mudança.',
  ' Testado: o ZIP compila sozinho, sem nada de fora (12 páginas). Atenção: 12 páginas no teste, 13 no PDF original.',
  '2 arquivos de fora da pasta do documento entraram no ZIP, e os caminhos foram ajustados só nas cópias (seus arquivos não mudaram):',
  '1 arquivo de fora da pasta do documento entrou no ZIP, e os caminhos foram ajustados só nas cópias (seus arquivos não mudaram):',
  '3 adicionadas a refs.bib; 1 já estava lá. Chaves: a, b.', '2 entradas novas em refs.bib; 2 já estavam lá (mesma chave, DOI ou título).',
  'O Claude Code parou (código 1).', 'O Claude Code falhou: código 2', 'O latexdiff falhou: código 3',
  'Falta espaço em disco: são precisos 25,4 GB livres e há 3,1 GB.',
  'O DOI é de um working paper, não do artigo publicado.', 'O DOI é de outro tipo de registro, não do artigo publicado.',
  'Sem permissão para clonar. Repositório privado? Entre na conta pelo GitHub Desktop ou use o endereço SSH. (fatal: denied)',
  'latexmk não encontrado. Instale o MacTeX (https://tug.org/mactex/) ou adicione /Library/TeX/texbin ao PATH.',
  'Não verificada: Sem conexão com a internet',
  'Sem conexão com a internet: o servidor online do LanguageTool não responde. O servidor local, em Preferências, funciona sem rede.\nClique para tentar de novo.',
  'Sincronizar', 'Sincronizando…', 'Sincronizado: commit “Update paper.tex”, pull, push.', 'Enviar', 'Permitir', 'Resolvido', 'Parecer', 'Adicionar', 'Aplicar',
  'Buscar', 'Buscando…', 'Adicionar e citar', 'Conferir', 'Gerar parecer', 'Novo parecer', 'Escrever a resposta', 'Verificar de novo', 'Instalar', 'Instalando…',
  'Achar qualquer coisa', 'Escrever', 'Revisar e submeter', 'Importar',
  'Todas 12', 'Sugestões 3', 'citada 2×',
  'Você e a outra versão mudaram os mesmos trechos (3 lugares), e juntar sozinho não resolve. Veja as diferenças e escolha uma versão.',
  'paper.tex mudou de novo no disco enquanto as versões eram juntadas. Salve outra vez.', 'paper.tex: as suas alterações e as que chegaram de fora foram juntadas e salvas.',
  'Clonar', 'Clonando…', 'Tentar de novo', 'Montando o PDF…', 'Procurando os PDFs anexados no Zotero…', 'Instalar amsmath, booktabs', 'Lendo o texto: paper.pdf (faltam 3)', 'Dicionário e regras zerados.',
  'Leu', 'Buscou', 'Listou', 'Listou arquivos', 'Editou', 'Escreveu', 'Rodou', 'Abriu', 'Carregou a skill',
];

test('sentences built in code come out in English', () => {
  const bad = RUNTIME.filter((s) => {
    const t = tr(s);
    return t === s || /[ãõçáéíóúâêô]|\b(?:não|você|arquivo|linha|página|referência)\b/i.test(t);
  }).map((s) => `${JSON.stringify(s)} -> ${JSON.stringify(tr(s))}`);
  assert.deepEqual(bad, []);
});

// The native menus and dialogs of electron/main.js translate through MENU_EN.
test('every native menu and dialog label has an English entry', () => {
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const block = src.slice(src.indexOf('const MENU_EN'), src.indexOf('};', src.indexOf('const MENU_EN')));
  const keys = new Set([...block.matchAll(/'((?:[^'\\]|\\.)*)':/g)].map((m) => m[1]));
  const used = new Set([...src.matchAll(/\b(?:L|item)\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]));
  const left = [...used].filter((k) => !keys.has(k));
  assert.deepEqual(left, [], 'labels without MENU_EN: ' + left.join(', '));
});
