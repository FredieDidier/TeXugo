// Copies of unsaved tabs, so a crash, a power cut or a forced quit does not
// take the session's work (PRE-LAUNCH-AUDIT.md I2). They live in the app's
// data folder, never in the project (they would dirty Git), one JSON per
// file under recovery/<hash of the project>/. This is not autosave: the
// user's file is only written when they save.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, sha1, readText } from './util.js';

const dirOf = (root) => path.join(dataDir(), 'recovery', sha1(path.resolve(root)).slice(0, 16));
const fileOf = (root, p) => path.join(dirOf(root), sha1(path.resolve(p)).slice(0, 16) + '.json');

// Keeps exactly `files` ([{ path, text }]) as the project's copies: writes
// the new or changed ones, removes the copies of tabs no longer dirty.
export function sync(root, files) {
  const dir = dirOf(root);
  const keep = new Set();
  if (files.length) fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const out = fileOf(root, f.path);
    keep.add(path.basename(out));
    const old = readText(out);
    if (old) {
      try {
        if (JSON.parse(old).text === f.text) continue;
      } catch {}
    }
    const tmp = out + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ path: path.resolve(f.path), text: f.text, at: Date.now() }));
    fs.renameSync(tmp, out);
  }
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {}
  for (const n of names) if (n.endsWith('.json') && !keep.has(n)) fs.rmSync(path.join(dir, n), { force: true });
  if (!files.length) fs.rmSync(dir, { recursive: true, force: true });
  return keep.size;
}

// Copies whose text differs from what is on disk now. A copy equal to the
// disk (saved by another route before the crash) is dropped.
export function list(root) {
  const dir = dirOf(root);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    let c;
    try {
      c = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    } catch {
      fs.rmSync(path.join(dir, n), { force: true });
      continue;
    }
    const disk = readText(c.path);
    if (disk === c.text) {
      fs.rmSync(path.join(dir, n), { force: true });
      continue;
    }
    out.push({ path: c.path, text: c.text, at: c.at, disk, missing: disk == null });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function drop(root, paths) {
  for (const p of paths || []) fs.rmSync(fileOf(root, p), { force: true });
  return true;
}
