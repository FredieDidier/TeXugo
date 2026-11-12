// The UI language, for the few things the server writes in words that do
// not pass through the page's dictionary: the automatic commit message, the
// note the AI actions return, the administrator prompt of the TeX doctor,
// the locale of the terminals, dates in generated files. Set from the
// settings (state.json) at start and whenever they change.
let lang = 'pt';
export function setServerLang(l) {
  lang = l === 'en' ? 'en' : 'pt';
}
export function serverLang() {
  return lang;
}
export const L = (pt, en) => (lang === 'en' ? en : pt);
export const locale = () => (lang === 'en' ? 'en-US' : 'pt-BR');
