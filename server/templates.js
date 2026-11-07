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

export function createFromTemplate(id, target, fields) {
  const src = path.join(DIR, id);
  if (!fs.existsSync(path.join(src, 'meta.json'))) throw new Error('Modelo desconhecido: ' + id);
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const now = new Date();
  const values = {
    TITLE: fields.title || 'Título',
    AUTHOR: fields.author || 'Autor',
    INSTITUTION: fields.institution || 'Instituição',
    DATE: `${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`,
    YEAR: String(now.getFullYear()),
  };
  const fill = (text) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? escapeTex(values[k]) : m));
  (function copy(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.name === 'meta.json') continue;
      const a = path.join(from, e.name);
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
