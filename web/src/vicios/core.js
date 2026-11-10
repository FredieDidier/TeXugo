// Writing-tic detector: pure functions, no DOM, so the editor, the report
// and the tests all run the same code.
//
// detect(text, { kind, lang }) -> { hits, stats }
//   kind: 'tex' | 'md' | 'txt'; lang: 'auto' | 'pt' | 'en'.
//   hits: [{ from, to, id, cat, lang, pt, en, fix, fixEn, src, era }]
// Offsets are into `text`, so they map straight onto the editor document.
import { layersFor } from './prose.js';
import { RULES, CATEGORIES, VERSION, SOURCES } from './rules.js';

export { CATEGORIES, VERSION, SOURCES, RULES };

const PT_MARK = new Set(['não', 'que', 'para', 'com', 'uma', 'os', 'das', 'dos', 'é', 'são', 'também', 'mais', 'pelo', 'pela', 'ao', 'à', 'em', 'do', 'da', 'no', 'na', 'se', 'como', 'mas', 'foi', 'entre', 'sobre', 'quando', 'muito', 'nos', 'já', 'está', 'pelos', 'pelas', 'isso', 'esta', 'este', 'essa', 'esse']);
const EN_MARK = new Set(['the', 'and', 'of', 'to', 'is', 'are', 'that', 'with', 'for', 'this', 'which', 'not', 'be', 'by', 'on', 'from', 'we', 'our', 'it', 'was', 'were', 'these', 'than', 'have', 'has', 'their', 'at', 'an', 'or', 'but', 'when', 'its', 'can', 'more']);
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

function guessLang(s) {
  let pt = 0;
  let en = 0;
  for (const m of s.matchAll(WORD_RE)) {
    const w = m[0].toLowerCase();
    if (PT_MARK.has(w)) pt++;
    if (EN_MARK.has(w)) en++;
  }
  if (pt + en >= 3) return pt >= en ? 'pt' : 'en';
  return null;
}

// Too few function words to tell: Portuguese prose almost never goes a
// sentence without an accent or a cedilla.
function fallbackLang(s) {
  return /[ãõçáéíóúâêôà]/i.test(s) ? 'pt' : 'en';
}

// Paragraphs of the words layer: [{ from, to, lang }].
export function paragraphs(words, forced) {
  const out = [];
  const re = /\n[ \t]*\n/g;
  let last = 0;
  let m;
  const push = (from, to) => {
    if (/\S/.test(words.slice(from, to))) out.push({ from, to, lang: forced || guessLang(words.slice(from, to)) });
  };
  while ((m = re.exec(words))) {
    push(last, m.index);
    last = m.index + m[0].length;
  }
  push(last, words.length);
  // Short paragraphs (headings, one-liners) take the document's language.
  const doc = forced || guessLang(words) || fallbackLang(words);
  for (const p of out) p.lang = p.lang || doc;
  return { paras: out, doc };
}

const ABBREV = /(?:^|[\s(])(?:e\.g|i\.e|et al|cf|vs|Fig|Figs|Eq|Eqs|Sec|Secs|Tab|Ref|Refs|No|Nos|Dr|Prof|Mr|Ms|Mrs|approx|resp|ex|p|pp|Sr|Sra|art|arts|cap|vol|n|nº|Inc|Ltd|Jr|St)\.$/;

// Sentences inside one paragraph: [{ from, to }] (absolute offsets).
function sentences(words, p) {
  const s = words.slice(p.from, p.to);
  const out = [];
  let begin = 0;
  const re = /[.!?]+["'”’)]?(?=\s+["“(]?[\p{Lu}\d]|\s*$)/gu;
  let m;
  while ((m = re.exec(s))) {
    const end = m.index + m[0].length;
    if (ABBREV.test(s.slice(Math.max(0, m.index - 8), m.index + 1))) continue;
    push(begin, end);
    begin = end;
  }
  push(begin, s.length);
  function push(a, b) {
    while (a < b && /\s/.test(s[a])) a++;
    while (b > a && /\s/.test(s[b - 1])) b--;
    if (b > a && /[\p{L}]/u.test(s.slice(a, b))) out.push({ from: p.from + a, to: p.from + b });
  }
  return out;
}

const countWords = (s) => (s.match(WORD_RE) || []).length;
const quantile = (xs, q) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);

const STRUCT = {
  longa: {
    cat: 'ritmo', src: 'S',
    pt: 'Frase longa e encadeada: mais de 45 palavras e três ou mais emendas (; , e , mas , que…). O defeito não é o tamanho, é o leitor ter de segurar vários fatos de uma vez.',
    en: 'Long and chained sentence: over 45 words and three or more joins (; , and , so , which…). Length is not the defect; holding several facts at once is.',
    fix: 'Quebre na emenda e dê sujeito próprio à segunda parte.', fixEn: 'Split at the join and give the second half its own subject.',
  },
  curta: {
    cat: 'ritmo', src: 'SU',
    pt: 'Parágrafo abrindo com frase de duas a quatro palavras. Funciona uma vez; a partir da terceira vira maneirismo.',
    en: 'Paragraph opening with a two-to-four word sentence. It works once; by the third it is a mannerism.',
    fix: 'Junte à frase seguinte ou escreva uma oração completa.', fixEn: 'Merge it with the next sentence or write a full clause.',
  },
  mesma: {
    cat: 'ritmo', src: 'SU',
    pt: 'Duas frases seguidas começando com a mesma palavra.',
    en: 'Two consecutive sentences starting with the same word.',
    fix: 'Reordene uma das frases.', fixEn: 'Reorder one of them.',
  },
  clivada: {
    cat: 'ritmo', src: 'S',
    pt: 'Pseudoclivada (“O que X mostra é…” / “What X shows is…”).',
    en: 'Pseudo-cleft (“What X shows is…”).',
    fix: 'Escreva direto: “X mostra…”.', fixEn: 'Write it directly: “X shows…”.',
  },
  triade: {
    cat: 'ritmo', src: 'WSU', min: 3,
    pt: 'Tríade reflexa: listas de exatamente três itens curtos, repetidas. Uma é normal; o acúmulo é tique.',
    en: 'Reflexive triad: repeated lists of exactly three short items. One is normal; the pile-up is a tic.',
    fix: 'Use dois, quatro ou um item, conforme o que existe.', fixEn: 'Use two, four or one, whatever there really is.',
  },
  titulo: {
    cat: 'pontuacao', src: 'WP',
    pt: 'Título com Todas as Palavras em Maiúscula: padrão do inglês que a IA traz para o português.',
    en: 'Title Case heading: an English convention AI carries into Portuguese.',
    fix: 'Em português, só a primeira palavra e nomes próprios levam maiúscula.', fixEn: 'In Portuguese, capitalize only the first word and proper nouns.',
  },
};
// Repeated openers that are normal: articles, and the roadmap of a paper
// (Section 2 describes... Section 3 presents...).
const ARTICLES = new Set(['the', 'a', 'an', 'o', 'os', 'as', 'um', 'uma', 'in', 'em', 'no', 'na', 'section', 'sections', 'seção', 'seções', 'secção', 'table', 'tabela', 'figure', 'figura', 'appendix', 'apêndice', 'panel', 'painel', 'column', 'coluna']);
const JOIN = {
  en: /;|,\s+(?:and|so|but|which|because|while|whereas|although)(?![\p{L}])/gu,
  pt: /;|,\s+(?:e|mas|que|porque|pois|enquanto|o que|embora|já que)(?![\p{L}])/gu,
};
const TRIAD = /(?<![\p{L}\p{N}])[\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2},\s+[\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2},?\s+(?:and|or|e|ou)\s+[\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2}(?=[\s.,;:!?)]|$)/gu;
const SMALL_WORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas', 'o', 'a', 'os', 'as', 'um', 'uma', 'para', 'por', 'com', 'sem', 'sob', 'entre', 'ao', 'à', 'aos', 'às', 'pelo', 'pela', 'ou']);

export function detect(text, { kind = 'tex', lang = 'auto' } = {}) {
  const layers = layersFor(text, kind);
  const forced = lang === 'pt' || lang === 'en' ? lang : null;
  const { paras, doc } = paragraphs(layers.words, forced);
  const langAt = (pos) => {
    for (const p of paras) if (pos >= p.from && pos < p.to) return p.lang;
    return doc;
  };
  const words = countWords(layers.words);
  const hits = [];
  const add = (from, to, r, id = r.id) => hits.push({ from, to, id, cat: r.cat, lang: langAt(from), pt: r.pt, en: r.en, fix: r.fix, fixEn: r.fixEn, src: r.src, era: r.era || null });

  // Pattern rules.
  const byRule = new Map();
  for (const r of RULES) {
    if (r.kinds && !r.kinds.includes(kind)) continue;
    const src = layers[r.layer || 'words'];
    r.re.lastIndex = 0;
    const found = [];
    for (const m of src.matchAll(r.re)) {
      if (!m[0]) continue;
      let from = m.index;
      let to = m.index + m[0].length;
      while (from < to && (r.keepComma ? /\s/ : /[\s,;]/).test(src[from])) from++;
      while (to > from && /\s/.test(src[to - 1])) to--;
      if (r.lang !== '*' && langAt(from) !== r.lang) continue;
      found.push([from, to]);
    }
    const key = r.id;
    byRule.set(key, (byRule.get(key) || []).concat(found.map((f) => [...f, r])));
  }
  for (const list of byRule.values()) {
    if (!list.length) continue;
    const r = list[0][2];
    if (r.per && list.length <= words / r.per) continue;
    if (r.min && list.length < r.min) continue;
    for (const [from, to, rr] of list) add(from, to, rr);
  }

  // Sentence rules.
  const lengths = [];
  const triads = [];
  const shortOpen = [];
  for (const p of paras) {
    const sents = sentences(layers.words, p);
    let prevFirst = null;
    sents.forEach((s, k) => {
      const t = layers.words.slice(s.from, s.to);
      const n = countWords(t);
      lengths.push(n);
      const L = p.lang;
      if (n > 45 && (t.match(JOIN[L]) || []).length >= 3) add(s.from, s.to, { id: 'longa', ...STRUCT.longa });
      if (k === 0 && n >= 2 && n <= 4 && /\.$/.test(t) && sents.length > 1) shortOpen.push([s.from, s.to]);
      const first = (t.match(WORD_RE) || [''])[0].toLowerCase();
      if (first && first === prevFirst && !ARTICLES.has(first)) {
        const at = s.from + t.search(/[\p{L}\p{N}]/u);
        add(at, at + first.length, { id: 'mesma', ...STRUCT.mesma });
      }
      prevFirst = first;
      if (!/\?$/.test(t) && (L === 'en' ? /^What(?:\s+\S+){1,6}\s+(?:is|was|does|did|matters|makes|explains|shows)\s/i : /^O que(?:\s+\S+){1,6}\s+(?:é|foi|faz|importa|explica|mostra)\s/).test(t)) {
        add(s.from, s.from + Math.max(7, t.indexOf(' ', 8)), { id: 'clivada', ...STRUCT.clivada });
      }
      for (const m of t.matchAll(TRIAD)) triads.push([s.from + m.index, s.from + m.index + m[0].length]);
    });
  }
  if (shortOpen.length >= 3) for (const [a, b] of shortOpen) add(a, b, { id: 'curta', ...STRUCT.curta });
  // Triads are counted, not underlined: in academic prose most of them are
  // real enumerations, and only an unusual density says anything.

  // Title Case headings in Portuguese.
  const headRe = kind === 'md' ? /^#{1,6}[ \t]+(.+)$/gm : /\\(?:sub){0,2}section\*?\s*(?:\[[^\]]*\])?\{([^{}]+)\}/g;
  for (const m of layers.punct.matchAll(headRe)) {
    const from = m.index + m[0].indexOf(m[1]);
    if (langAt(from) !== 'pt') continue;
    const ws = m[1].trim().split(/\s+/).slice(1).filter((w) => /^\p{L}/u.test(w) && !SMALL_WORDS.has(w.toLowerCase()) && w.length >= 3);
    if (ws.length >= 3 && ws.every((w) => /^\p{Lu}/u.test(w)) && !ws.every((w) => w === w.toUpperCase())) add(from, from + m[1].length, { id: 'titulo', ...STRUCT.titulo });
  }

  hits.sort((a, b) => a.from - b.from || b.to - a.to);
  // A hit inside a longer one of the same kind of problem ("crucial" inside
  // "plays a crucial role") says nothing new: keep the longer one.
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (h.cat === 'ritmo' || h.cat === 'travessao') continue;
    if (hits.some((o, j) => j !== i && o.cat !== 'ritmo' && o.cat !== 'travessao' && o.from <= h.from && o.to >= h.to && o.to - o.from > h.to - h.from)) hits.splice(i, 1);
  }
  const sorted = [...lengths].sort((a, b) => a - b);
  const byCat = {};
  for (const h of hits) byCat[h.cat] = (byCat[h.cat] || 0) + 1;
  return {
    hits,
    stats: {
      lang: doc,
      words,
      sentences: lengths.length,
      median: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      p95: quantile(sorted, 0.95),
      over55: lengths.filter((n) => n > 55).length,
      lengths,
      triads: triads.length,
      triadsPer1000: words ? (triads.length * 1000) / words : 0,
      per1000: words ? (hits.length * 1000) / words : 0,
      byCat,
    },
  };
}

export function kindOf(path) {
  if (/\.(tex|ltx)$/i.test(path)) return 'tex';
  if (/\.(md|markdown|qmd|rmd)$/i.test(path)) return 'md';
  if (/\.txt$/i.test(path)) return 'txt';
  return null;
}
