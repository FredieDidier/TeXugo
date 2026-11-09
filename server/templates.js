// Project templates. Each template is a folder under server/templates with a
// meta.json and its files; {{TITLE}}, {{AUTHOR}}, {{DATE}}, {{INSTITUTION}}
// placeholders are filled in when the project is created.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

export function listTemplates() {
  return fs
    .readdirSync(DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const meta = JSON.parse(fs.readFileSync(path.join(DIR, e.name, 'meta.json'), 'utf8'));
      return { id: e.name, ...meta };
    })
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

// lang 'en' uses the template's en/ folder when it has one (Portuguese
// templates ship an English version there) and writes the date in English.
export function createFromTemplate(id, target, fields, lang = 'pt') {
  let src = path.join(DIR, id);
  if (!fs.existsSync(path.join(src, 'meta.json'))) throw new Error('Modelo desconhecido: ' + id);
  const english = lang === 'en';
  if (english && fs.existsSync(path.join(src, 'en'))) src = path.join(src, 'en');
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const now = new Date();
  const values = {
    TITLE: fields.title || (english ? 'Title' : 'Título'),
    AUTHOR: fields.author || (english ? 'Author' : 'Autor'),
    INSTITUTION: fields.institution || (english ? 'Institution' : 'Instituição'),
    DATE: english ? now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : `${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`,
    YEAR: String(now.getFullYear()),
  };
  // A journal format (Artigo: AEA, Elsevier, Econometrica...) sets raw LaTeX
  // variables and/or swaps whole files.
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, id, 'meta.json'), 'utf8'));
  const formats = meta.formats || [];
  const format = formats.find((f) => f.id === fields.format) || formats[0] || {};
  const vars = format.vars || {};
  const swaps = format.files || {};
  const fill = (text) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : k in values ? escapeTex(values[k]) : m));
  (function copy(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.name === 'meta.json' || (from === path.join(DIR, id) && (e.name === 'en' || e.name === 'formats'))) continue;
      const rel = path.relative(src, path.join(from, e.name));
      const a = swaps[rel] ? path.join(DIR, id, swaps[rel]) : path.join(from, e.name);
      const b = path.join(to, e.name);
      if (e.isDirectory()) copy(a, b);
      else if (/\.(tex|bib|sty|cls|md|txt|latexmkrc)$/.test(e.name) || e.name === 'latexmkrc') fs.writeFileSync(b, fill(fs.readFileSync(a, 'utf8')));
      else fs.copyFileSync(a, b);
    }
  })(src, target);
}

function escapeTex(s) {
  return String(s).replace(/([&%$#_])/g, '\\$1');
}
