// From LanguageTool's matches to the flags shown in the editor: TeXugo's own
// rules added, matches mapped back to the source, and the ones that are not
// the user's mistake dropped. Pure, so the app, the tests and audits on real
// documents run the same code.
import { mapMatch, DUMMY } from './text.js';
import { localMatches } from './local.js';
import { ACADEMIC_WORDS } from '../../../server/academic-words.js';

// matchesOf(para) -> LanguageTool matches of that paragraph.
export function hitsFor(paras, matchesOf, { words = [], disabledRules = [] } = {}) {
  const dict = new Set(words.map((w) => w.toLowerCase()));
  const hits = [];
  for (const p of paras) {
    const lt = matchesOf(p) || [];
    for (const m of [...localMatches(p, lt), ...lt]) {
      const at = mapMatch(p, m.offset, m.length);
      if (!at || at.to <= at.from) continue;
      const word = p.text.slice(m.offset, m.offset + m.length);
      if (disabledRules.includes(m.rule)) continue;
      if (m.type === 'misspelling' && dict.has(word.toLowerCase())) continue;
      if (dropped(m, word, p, at)) continue;
      hits.push({ ...at, ...m, word, lang: p.lang });
    }
  }
  return hits.sort((a, b) => a.from - b.from);
}

// An acronym, code, identifier or address: two capitals (DNIT, IPCA,
// BR-DWGD, PhD), letters with digits (CO2, PM2.5, H1N1), an underscore
// (var_name) or a dot inside a word (datazoom.social).
export const isCode = (tok) => {
  const t = tok.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
  return /\p{Lu}.*\p{Lu}/u.test(t) || (/\p{L}/u.test(t) && /\d/.test(t)) || /_/.test(t) || /\p{L}\.\p{L}/u.test(t);
};

// Portuguese words that appear inside Portuguese names quoted in English
// ("Sistema de Informações sobre Mortalidade").
const PT_LINKS = new Set(['de', 'da', 'do', 'das', 'dos', 'na', 'no', 'nas', 'nos', 'ao', 'aos', 'à', 'às', 'sobre', 'por', 'para', 'e', 'em', 'com', 'o', 'a', 'os', 'as', 'pelo', 'pela']);
// Words that name a part of a table or figure: "Panel A", "Column B".
const PART = /(?:^|\s)(?:Panel|Column|Columns|Table|Figure|Appendix|Section|Part|Model|Group|Family|Row|Case|Scenario|Type|Plan|Option|Class|Grade|Step|Stage|Wave|Sample|Specification|Painel|Coluna|Tabela|Figura|Apêndice|Seção|Grupo|Modelo|Etapa)\s+$/;
const ABBREV = /(?:\bcit|\bal|\be\.g|\bi\.e|\bcf|\bvs|\betc|\bp|\bpp|\bFig|\bEq|\bNo|\bSec|\bapprox|\bres|\bop|\bibid|\bed|\beds|\bvol|\bn|\bnº|\bart|\bInc|\bLtd|\bJr|\bDr|\bProf|\bSr|\bSra)\.\s*$/i;

// Matches that are not the user's mistake.
export function dropped(m, word, p, at) {
  if (m.message === 'TBD') return true; // unfinished LanguageTool rule
  // The match is about our placeholder ("“Dummy” is a singular noun").
  if (m.message && m.message.includes(DUMMY)) return true;
  const toks = word.split(/\s+/).filter(Boolean);
  const before = p.text.slice(0, m.offset);
  const after = p.text.slice(m.offset + m.length);
  // "much less does it change": "less" before a verb is not a quantity.
  if (m.rule === 'FEWER_LESS' && /^\s*(?:does|do|did|is|are|was|were|has|have|had|can|could|will|would|should|may|might)\b/i.test(after)) return true;
  if (m.type === 'misspelling') {
    // A dictionary cannot know acronyms, codes, identifiers, including a
    // flagged piece of one ("datazoom" in "datazoom.social").
    const whole = (before.match(/\S*$/) || [''])[0] + word + (after.match(/^\S*/) || [''])[0];
    if (toks.some(isCode) || isCode(whole.replace(/[.,;:!?)\]]+$/, ''))) return true;
    // Technical vocabulary of research writing.
    const lw = word.toLowerCase();
    if (ACADEMIC_WORDS.has(lw) || lw.split('-').every((x) => ACADEMIC_WORDS.has(x) || x.length < 2)) return true;
    // A capitalized word unknown to the dictionary is a name (Fiocruz,
    // Itabuna, a first name at the start of a line).
    if (/^\p{Lu}\p{Ll}/u.test(word)) return true;
    // Portuguese names quoted in English text.
    if (p.lang === 'en' && PT_LINKS.has(lw)) {
      const prev = (before.match(/(\S+)\s*$/) || [])[1] || '';
      const next = (after.match(/^\s*(\S+)/) || [])[1] || '';
      if (/^\p{Lu}/u.test(prev) || /^\p{Lu}/u.test(next)) return true;
    }
    // Italics mark foreign words and titles.
    if (at && (p.italic || []).some(([a, b]) => at.from >= a && at.to <= b)) return true;
    return false;
  }
  // A short grammar match around an acronym read it as a word ("do SIM"
  // taken as "sim").
  if (toks.length <= 3 && toks.some(isCode)) return true;
  // "Panel A sums", "In Panel A the": the letter is a name, not an article.
  if (/^(?:A|I)\b/.test(word) && PART.test(before)) return true;
  // "datazoom.social": a dot inside a name, not the end of a sentence.
  if ((m.rule === 'LC_AFTER_PERIOD' || m.rule === 'UPPERCASE_SENTENCE_START') && /\p{L}\.$/u.test(before)) return true;
  if (m.rule === 'UPPERCASE_SENTENCE_START') {
    // Paragraph that continues a sentence (after display math), a panel
    // letter (\textbf{a}), or a lowercase word after an abbreviation.
    if (!before.trim() || word.length === 1 || ABBREV.test(before) || before.trimEnd().endsWith(DUMMY)) return true;
  }
  return false;
}
