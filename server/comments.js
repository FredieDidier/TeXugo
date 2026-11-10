// Comments in the text that travel with Git: one JSON file per thread in
// .texugo-comments/ at the project root, so two coauthors commenting at the
// same time never touch the same file (no merge conflicts), and a pull
// brings the others' comments and replies. Each thread is tied to a passage
// by its text (server/anchor.js), not by a line number.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { whoami } from './coauthors.js';
import { locate } from './anchor.js';

export const DIR = '.texugo-comments';
const ID = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;

const dirOf = (root) => path.join(root, DIR);
const fileOf = (root, id) => {
  if (!ID.test(id)) throw new Error('Comentário inválido.');
  return path.join(dirOf(root), id + '.json');
};

// The person writing: the repository's Git identity, or the Mac user.
export async function me(root) {
  let who = { name: '', email: '' };
  try {
    who = await whoami(root);
  } catch {}
  if (!who.name) who.name = os.userInfo().username;
  return who;
}

function read(root, id) {
  return JSON.parse(fs.readFileSync(fileOf(root, id), 'utf8'));
}
function write(root, c) {
  fs.mkdirSync(dirOf(root), { recursive: true });
  // One key per line and a final newline: readable diffs in Git.
  fs.writeFileSync(fileOf(root, c.id), JSON.stringify(c, null, 2) + '\n');
  return c;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Every thread, with where its passage is now in the file on disk.
export async function list(root) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dirOf(root)).filter((n) => n.endsWith('.json'));
  } catch {}
  const texts = new Map();
  for (const n of names) {
    let c;
    try {
      c = JSON.parse(fs.readFileSync(path.join(dirOf(root), n), 'utf8'));
    } catch {
      continue; // half-merged or hand-edited: skip rather than fail
    }
    if (!c || !ID.test(c.id) || !c.file) continue;
    const abs = path.join(root, c.file);
    if (!texts.has(abs)) {
      try {
        texts.set(abs, fs.readFileSync(abs, 'utf8'));
      } catch {
        texts.set(abs, null);
      }
    }
    const text = texts.get(abs);
    const at = text == null ? null : locate(text, c.anchor);
    out.push({ ...c, path: abs, at });
  }
  out.sort((a, b) => a.file.localeCompare(b.file) || (a.at ? a.at.from : 1e12) - (b.at ? b.at.from : 1e12) || a.date.localeCompare(b.date));
  return { me: await me(root), items: out };
}

export async function create(root, { file, anchor, text }) {
  if (!text || !text.trim()) throw new Error('Escreva o comentário.');
  if (!anchor || !anchor.quote) throw new Error('Selecione o trecho a comentar.');
  const who = await me(root);
  const c = {
    id: `${stamp()}-${randomBytes(3).toString('hex')}`,
    file: path.relative(root, file).split(path.sep).join('/'),
    anchor: { quote: anchor.quote.slice(0, 2000), before: anchor.before || '', after: anchor.after || '', line: anchor.line || 1 },
    author: who.name,
    email: who.email,
    date: new Date().toISOString(),
    text: text.trim(),
    replies: [],
    resolved: null,
  };
  return write(root, c);
}

export async function reply(root, id, text) {
  if (!text || !text.trim()) throw new Error('Escreva a resposta.');
  const c = read(root, id);
  const who = await me(root);
  c.replies = [...(c.replies || []), { author: who.name, email: who.email, date: new Date().toISOString(), text: text.trim() }];
  return write(root, c);
}

export async function resolve(root, id, done) {
  const c = read(root, id);
  const who = await me(root);
  c.resolved = done ? { author: who.name, email: who.email, date: new Date().toISOString() } : null;
  return write(root, c);
}

// The passage was edited: keep the comment on its new text.
export function reanchor(root, id, anchor) {
  const c = read(root, id);
  c.anchor = { quote: anchor.quote.slice(0, 2000), before: anchor.before || '', after: anchor.after || '', line: anchor.line || 1 };
  return write(root, c);
}

export function remove(root, id) {
  fs.rmSync(fileOf(root, id), { force: true });
  try {
    if (!fs.readdirSync(dirOf(root)).length) fs.rmdirSync(dirOf(root));
  } catch {}
  return true;
}
