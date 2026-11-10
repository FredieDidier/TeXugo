// Rules of TeXugo's own that run next to LanguageTool.
//
// Verbal agreement in Portuguese: LanguageTool catches "Os dados indica"
// but not "Os resultados mostra", because "mostra" is also a noun ("a
// mostra") and its tagger gives up. A plural subject (plural determiner +
// noun, optionally plural adjectives or an adverb) followed right away by a
// third-person-singular verb form is flagged, with the plural form as fix.
// Same shape LanguageTool returns, so the editor treats both alike.

const PLURAL_DET = new Set([
  'os', 'as', 'estes', 'estas', 'esses', 'essas', 'aqueles', 'aquelas', 'nossos', 'nossas', 'seus', 'suas', 'meus', 'minhas',
  'teus', 'tuas', 'muitos', 'muitas', 'vários', 'várias', 'alguns', 'algumas', 'poucos', 'poucas', 'tantos', 'tantas', 'outros',
  'outras', 'ambos', 'ambas', 'diversos', 'diversas', 'certos', 'certas', 'quaisquer', 'todos', 'todas',
]);
// Words ending in -s that are not plural nouns or adjectives.
const NOT_PLURAL = new Set(['mais', 'menos', 'pois', 'depois', 'antes', 'através', 'apenas', 'jamais', 'atrás', 'após', 'demais', 'nós', 'vós', 'eles', 'elas', 'lhes', 'nos', 'vos', 'os', 'as', 'dos', 'das', 'nas', 'pelos', 'pelas', 'aos', 'às', 'seus', 'suas', 'estes', 'estas', 'esses', 'essas', 'tais', 'quais', 'cujos', 'cujas', 'outros', 'outras', 'todos', 'todas']);
const ADVERBS = new Set(['também', 'ainda', 'não', 'já', 'sempre', 'só', 'apenas', 'claramente', 'nunca', 'raramente', 'geralmente', 'frequentemente', 'realmente', 'certamente', 'provavelmente', 'efetivamente']);
// Words ending like a singular verb that are not verbs.
const NOT_VERB = new Set([
  'a', 'e', 'à', 'da', 'na', 'de', 'se', 'que', 'pela', 'para', 'sobre', 'entre', 'como', 'até', 'contra', 'conforme', 'durante',
  'mediante', 'perante', 'desde', 'segundo', 'cada', 'toda', 'essa', 'esta', 'aquela', 'uma', 'nesta', 'desta', 'dessa', 'nessa',
  'numa', 'duma', 'sua', 'nossa', 'minha', 'este', 'esse', 'aquele', 'deste', 'neste', 'desse', 'nesse', 'daquele', 'naquele',
  'daquela', 'naquela', 'ante', 'me', 'te', 'lhe', 'nele', 'dele', 'dela', 'nela', 'cuja', 'outra', 'mesma', 'própria', 'grande',
  'presente', 'seguinte', 'onde', 'ora', 'logo', 'tampouco', 'sequer', 'nenhuma', 'alguma', 'qualquer', 'tanto', 'quanto',
  'inclusive', 'exclusive', 'abaixo', 'acima', 'fora', 'dentro', 'perto', 'longe', 'agora', 'hoje', 'sempre', 'ainda', 'então',
  'já', 'nunca', 'também', 'não', 'só', 'mesmo', 'ou', 'nem', 'mas', 'porque', 'pois', 'embora', 'enquanto', 'caso', 'quando',
]);
const IRREGULAR = {
  'é': 'são', foi: 'foram', tem: 'têm', 'está': 'estão', era: 'eram', fez: 'fizeram', teve: 'tiveram', vem: 'vêm', veio: 'vieram',
  'pôde': 'puderam', deu: 'deram', traz: 'trazem', faz: 'fazem', diz: 'dizem', 'há': null, estava: 'estavam', seria: 'seriam',
  'será': 'serão', 'terá': 'terão', 'estará': 'estarão', 'irá': 'irão', 'vai': 'vão', 'dá': 'dão', 'vê': 'veem', 'lê': 'leem',
  esteve: 'estiveram', houve: null, 'põe': 'põem', 'pôs': 'puseram', quis: 'quiseram', soube: 'souberam', trouxe: 'trouxeram',
  produz: 'produzem', reduz: 'reduzem', induz: 'induzem', conduz: 'conduzem',
};

// Plural form of a 3rd-person-singular verb, or null when `w` does not
// look like one.
export function pluralVerb(w) {
  const lw = w.toLowerCase();
  if (Object.hasOwn(IRREGULAR, lw)) return IRREGULAR[lw];
  if (NOT_VERB.has(lw) || lw.length < 3) return null;
  if (/ou$/.test(lw)) return lw.slice(0, -2) + 'aram';
  if (/[^ou]eu$/.test(lw)) return lw.slice(0, -2) + 'eram';
  if (/[aeu]iu$/.test(lw)) return lw.slice(0, -2) + 'íram'; // concluiu -> concluíram, caiu -> caíram
  if (/iu$/.test(lw)) return lw.slice(0, -2) + 'iram';
  if (/ria$/.test(lw) && lw.length > 5) return lw + 'm'; // conditional: mostraria
  if (/[^aeiouáéíóúãõ]a$|[^aeiouáéíóúãõ]e$|ia$|ui$/.test(lw)) return /ui$/.test(lw) ? lw.slice(0, -1) + 'em' : lw + 'm';
  return null;
}

const keepCase = (orig, rep) => (orig[0] === orig[0].toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep);

export function ptAgreement(text) {
  const toks = [...text.matchAll(/[\p{L}]+/gu)].map((m) => ({ w: m[0], lw: m[0].toLowerCase(), from: m.index, to: m.index + m[0].length }));
  const out = [];
  // Only spaces between the words of the pattern (no comma, period, dash).
  const joined = (a, b) => /^[  ]+$/.test(text.slice(a.to, b.from));
  for (let i = 0; i < toks.length; i++) {
    if (!PLURAL_DET.has(toks[i].lw)) continue;
    let k = i + 1;
    // "todos os resultados": the second determiner.
    if ((toks[i].lw === 'todos' || toks[i].lw === 'todas') && toks[k] && /^(os|as)$/.test(toks[k].lw) && joined(toks[i], toks[k])) k++;
    // Noun plus up to two plural adjectives ("os principais resultados obtidos").
    let n = 0;
    while (toks[k] && n < 3 && joined(toks[k - 1], toks[k]) && /s$/.test(toks[k].lw) && toks[k].lw.length > 2 && !NOT_PLURAL.has(toks[k].lw)) {
      k++;
      n++;
    }
    if (!n) continue;
    if (toks[k] && ADVERBS.has(toks[k].lw) && joined(toks[k - 1], toks[k])) k++;
    const v = toks[k];
    if (!v || !joined(toks[k - 1], v)) continue;
    // A capitalized word mid-sentence is a name, not a verb.
    if (v.w[0] !== v.w[0].toLowerCase()) continue;
    const plural = pluralVerb(v.w);
    if (!plural) continue;
    const subject = text.slice(toks[i].from, toks[k - 1].to);
    out.push({
      offset: v.from,
      length: v.to - v.from,
      message: `Concordância verbal: o sujeito “${subject}” está no plural, então o verbo também: “${plural}”.`,
      short: 'Concordância verbal',
      rule: 'TEXUGO_CONCORDANCIA_VERBAL',
      ruleDesc: 'Sujeito no plural com verbo no singular (regra do TeXugo)',
      category: 'Gramática',
      type: 'grammar',
      replacements: [keepCase(v.w, plural)],
    });
    i = k;
  }
  return out;
}

// Local matches for a paragraph, minus agreement errors LanguageTool
// already flagged at the same words.
export function localMatches(para, ltMatches = []) {
  if (para.lang !== 'pt') return [];
  const agreement = ltMatches.filter((x) => /AGREEMENT|CONCORD/.test(x.rule || ''));
  return ptAgreement(para.text).filter((m) => !agreement.some((x) => x.offset < m.offset + m.length && x.offset + x.length > m.offset));
}
