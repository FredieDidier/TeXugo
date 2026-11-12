// Projects that bring their own executable configuration: a latexmkrc (Perl
// that latexmk runs on every compile) or a .claude/ folder (Claude Code
// settings, which may carry hooks that run shell commands). The first time
// such a folder is opened, the UI asks whether the user trusts whoever made
// it; the answer is kept per folder in state.json. Until then, Claude Code
// runs only with the user's own settings, and latexmk is not asked to
// evaluate the rc outside a compile.
import fs from 'node:fs';
import path from 'node:path';

let check = () => true; // tests and CLI tools: no gate
export function setTrustCheck(fn) {
  check = fn;
}

export function isTrusted(dir) {
  try {
    return !!check(path.resolve(dir));
  } catch {
    return false;
  }
}

// Flags for `claude -p` in a project folder: an untrusted project's own
// settings (.claude/settings.json and settings.local.json, with their hooks
// and permission rules) are left out; the user's settings and skills stay.
export function claudeSourceFlags(root) {
  return isTrusted(root || '.') ? [] : ['--setting-sources', 'user'];
}

// What in the folder runs code: project-relative paths, for the warning.
export function riskyItems(root, docDirs = []) {
  const found = [];
  const rel = (p) => path.relative(root, p) || path.basename(p);
  const claudeDir = path.join(root, '.claude');
  try {
    if (fs.statSync(claudeDir).isDirectory()) {
      const parts = ['settings.json', 'settings.local.json', 'hooks', 'agents', 'skills', 'commands'].filter((f) => fs.existsSync(path.join(claudeDir, f)));
      if (parts.length) found.push('.claude/ (' + parts.join(', ') + ')');
    }
  } catch {}
  for (const dir of new Set([root, ...docDirs])) {
    for (const f of ['latexmkrc', '.latexmkrc']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) found.push(rel(p));
    }
  }
  return found;
}

// Is `dir` inside one of the trusted roots?
export function underTrusted(trusted, dir) {
  return (trusted || []).some((r) => dir === r || dir.startsWith(r + path.sep));
}
