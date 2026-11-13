// Writes a SQLite file for a test: Node's own SQLite where this Node has it
// (Windows has no sqlite3 program), else the sqlite3 command.
import { execFileSync } from 'node:child_process';

const sqlite = await import('node:sqlite').catch(() => null);

export function writeSqlite(file, sql) {
  if (!sqlite) return execFileSync('sqlite3', [file], { input: sql });
  const db = new sqlite.DatabaseSync(file);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
