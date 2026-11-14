// "Parecer" and "Resposta aos pareceristas" end to end in the real Electron
// app, with the user's own Claude Code (PRE-LAUNCH-AUDIT.md, item 8):
//
//   npm run build:web && npx electron test/ui/referees.mjs
//
// It calls the real model on an invented paper (test/fixtures/referees), so
// it spends the account's usage and takes several minutes; npm test never
// runs it. The project, a temporary profile and the report live in a
// temporary folder printed at the end; the report is also copied to
// out/referees-report.md. The run stops with exit code 2 when Claude Code is
// missing or not logged in, 1 when a check fails.
//
// TEXUGO_REFEREES_FAKE=1 swaps Claude Code for a stand-in that answers at
// once (fake-claude.mjs), to check this script; TEXUGO_REFEREES_FAKE=bad
// makes the stand-in misbehave, and the checks must fail.
//
// Parecer: the run ends, every point links to a line that exists (and,
// when TeXugo found the quote, the line holds it), a click opens that line,
// and no file of the project changes (the report goes to .texugo/review).
// Resposta: response.tex is the only new file, it compiles, every comment
// of both reports has its box, every "Change in the paper" names a section
// and a page, a comment the revision answered has one and a comment it did
// not answer does not. The agent's command line is logged: the one-shot
// runs get only the Skill and Read tools.
import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = path.join(REPO, 'test', 'fixtures', 'referees');
const FAKE = process.env.TEXUGO_REFEREES_FAKE || '';
const LIMIT = 40 * 60000; // each flow; the app's own limit is 30 minutes
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-referees-'));
const BIN = path.join(TMP, 'bin');
const ARGLOG = path.join(TMP, 'agent-args.jsonl');
fs.mkdirSync(BIN);
fs.mkdirSync(path.join(TMP, 'profile'));

const { findOnPath } = await import(pathToFileURL(path.join(REPO, 'server', 'util.js')).href);
const { outputs } = await import(pathToFileURL(path.join(REPO, 'server', 'outdirs.js')).href);
const { makeRefereeProject, COMMENTS } = await import(pathToFileURL(path.join(FIX, 'make.mjs')).href);

// The agent TeXugo finds first on the PATH: a wrapper that logs the command
// line and runs the real one, or the stand-in.
const real = findOnPath('claude');
if (!FAKE && !real) {
  console.log('BLOCKED Claude Code (claude) is not on the PATH');
  process.exit(2);
}
fs.writeFileSync(path.join(BIN, 'claude'), FAKE ? `#!/bin/sh\nexec node "${path.join(FIX, 'fake-claude.mjs')}" "$@"\n` : `#!/bin/sh\nprintf '%s\\n' "$*" >> "${ARGLOG}"\nexec "${real}" "$@"\n`, { mode: 0o755 });
process.env.PATH = BIN + path.delimiter + process.env.PATH;
process.env.TEXUGO_REFEREES_ARGLOG = ARGLOG;

const { proj, doc, reports } = await makeRefereeProject(TMP);
const reportsText = fs.readFileSync(reports, 'utf8');
fs.writeFileSync(path.join(TMP, 'profile', 'state.json'), JSON.stringify({ settings: { grammar: false, lang: 'pt', reopenLast: false, onboarded: true } }));
app.setPath('userData', path.join(TMP, 'profile'));
dialog.showMessageBoxSync = () => 2;

process.argv.push(proj);
await import(pathToFileURL(path.join(REPO, 'electron', 'main.js')).href);

const results = [];
const notes = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + JSON.stringify(detail)}`);
};
const note = (text) => (notes.push(text), console.log('     ' + text));
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const lines = (rel) => fs.readFileSync(path.join(proj, rel), 'utf8').split('\n');
// Project-relative path; the app may report the folder by its real path
// (/private/var/… for /var/… on the Mac).
const rel = (f) => (path.relative(proj, f).startsWith('..') ? path.relative(fs.realpathSync(proj), f) : path.relative(proj, f));
const mmss = (ms) => `${Math.floor(ms / 60000)} min ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')} s`;
const LOGIN = /log(ado|ged)? ?in|authenticat|login|credential/i;

// Every file of the project but Git's and TeXugo's own folders, by content.
function snapshot() {
  const out = {};
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(proj, full);
      if (rel === '.git' || rel === '.texugo') continue;
      if (e.isDirectory()) walk(full);
      else out[rel] = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
    }
  })(proj);
  return out;
}
function changed(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).map((k) => (k in a ? (k in b ? 'changed ' : 'removed ') : 'new ') + k);
}
// The command lines the agent got since the last look.
let argsSeen = 0;
function agentArgs() {
  const all = fs.existsSync(ARGLOG) ? fs.readFileSync(ARGLOG, 'utf8').trim().split('\n').filter(Boolean) : [];
  const fresh = all.slice(argsSeen).filter((l) => !/--version/.test(l));
  argsSeen = all.length;
  return fresh.map((l) => (l.startsWith('[') ? JSON.parse(l).join(' ') : l));
}
const readOnly = (cmd) => /(^| )-p( |$)/.test(cmd) && /--tools Skill,Read( |$)/.test(cmd);

// The argument of \cmd{...} at index i (just after the opening brace).
function braced(text, i) {
  let depth = 1;
  let j = i;
  for (; j < text.length && depth; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '{') depth++;
    else if (text[j] === '}') depth--;
  }
  return text.slice(i, j - 1);
}
function boxes(tex) {
  const out = [];
  const re = /\\referee\{/g;
  let m;
  while ((m = re.exec(tex))) {
    const comment = braced(tex, m.index + m[0].length);
    const rest = tex.slice(m.index + m[0].length + comment.length + 1);
    const end = rest.search(/\\referee\{|\\section\{|\\end\{document\}/);
    const body = end < 0 ? rest : rest.slice(0, end);
    const grab = (cmd) => [...body.matchAll(new RegExp(`\\\\${cmd}\\{`, 'g'))].map((x) => braced(body, x.index + x[0].length));
    const locs = [...body.matchAll(/^\\(?:change|todo)\{.*% (\S+):(\d+)\s*$/gm)].map((x) => ({ file: x[1], line: Number(x[2]) }));
    out.push({ comment: norm(comment.replace(/\\([&%$#_{}])/g, '$1').replace(/\\par /g, ' ')), changes: grab('change'), todos: grab('todo'), locs });
  }
  return out;
}

app.whenReady().then(async () => {
  let blocked = '';
  try {
    await sleep(1500);
    const win = BrowserWindow.getAllWindows()[0];
    const wc = win.webContents;
    const js = (body) => wc.executeJavaScript(`(async () => { ${body} })()`, true);
    const until = async (body, ms = 15000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await js(body).catch(() => false)) return true;
      return false;
    };
    const untilNode = async (fn, ms) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
        const v = await fn();
        if (v) return v;
      }
      return null;
    };
    const key = async (keyCode, modifiers = []) => {
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await sleep(150);
    };
    const clickBtn = (scope, text) => js(`const b = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); if (b) b.click(); return !!b;`);
    const modalText = () => js(`return document.querySelector('.modal')?.innerText || '';`);

    check('the sample project opens with paper.tex', await until(`return document.title.startsWith('bike-share-paper') && document.querySelector('.tab.active .label')?.textContent === 'paper.tex';`));
    await js(`document.querySelector('.editor-host .cm-content').focus(); return true;`);
    await key('Enter', [MOD]);
    check('the paper compiles with zero ??', await until(`return !document.querySelector('.status-dot.building') && !!document.querySelector('.doc-bar .chip.ok');`, 180000), await js(`return document.querySelector('.doc-bar')?.innerText;`));
    check('the build leaves SyncTeX, so changes can get their page', fs.existsSync(outputs(doc).synctex));
    await sleep(1500);
    await js(`[...document.querySelectorAll('.activitybar > *')].find((e) => (e.title || '').startsWith('Revisão')).click(); return true;`);
    await sleep(900);

    // ---------------------------------------------------------------- Parecer
    let before = snapshot();
    agentArgs();
    check('Parecer: the dialog opens from the Revisão tab', (await clickBtn('.sidebar', 'Revisar como parecerista…')) && (await until(`return (document.querySelector('.modal-title')?.innerText || '').includes('como parecerista');`, 5000)));
    await clickBtn('.modal footer', 'Gerar parecer');
    let t0 = Date.now();
    await until(`return !!document.querySelector('.bottom-body .review-panel, .bottom-body .qq-banner');`, LIMIT);
    const reviewMs = Date.now() - t0;
    const reviewErr = await js(`return document.querySelector('.bottom-body .qq-banner')?.innerText || '';`);
    note(`Parecer: ${mmss(reviewMs)}`);
    const reviewCmds = agentArgs();
    if (reviewErr) {
      check('Parecer: the run ends with a report', false, reviewErr);
      if (LOGIN.test(reviewErr)) blocked = reviewErr;
      note(`Parecer: message on the screen: ${norm(reviewErr)}`);
    } else {
      const rep = JSON.parse(fs.readFileSync(path.join(proj, '.texugo', 'review', 'paper.json'), 'utf8'));
      const pts = rep.points;
      check('Parecer: the run ends with a report', pts.length > 0 && !!rep.summary, rep);
      note(`Parecer: ${pts.length} points (${['major', 'minor', 'typo'].map((k) => `${pts.filter((p) => p.kind === k).length} ${k}`).join(', ')}), recommendation "${rep.recommendation}"`);
      const bad = pts.filter((p) => {
        const r = rel(p.file);
        return r.startsWith('..') || !fs.existsSync(p.file) || !(p.line >= 1 && p.line <= lines(r).length);
      });
      check('Parecer: every point links to a line that exists in a project file', !bad.length, bad.map((p) => `${p.file}:${p.line}`));
      const exact = pts.filter((p) => p.exact);
      const wrong = exact.filter((p) => {
        const ls = lines(rel(p.file));
        return !norm(ls[p.line - 1] + ' ' + (ls[p.line] || '')).includes(norm(p.quote).slice(0, 30)) && !norm((ls[p.line - 2] || '') + ' ' + ls[p.line - 1]).includes(norm(p.quote).slice(0, 30));
      });
      check('Parecer: a point whose quote TeXugo found sits on the line that holds the quote', !wrong.length, wrong.map((p) => `${p.file}:${p.line} ${p.quote}`));
      check('Parecer: every quote is found in the source (no "~" lines)', exact.length === pts.length, pts.filter((p) => !p.exact).map((p) => `${rel(p.file)}:${p.line} "${p.quote}"`));
      const files = [...new Set(pts.map((p) => rel(p.file)))];
      note(`Parecer: files the points link to: ${files.join(', ')}`);
      const first = exact[0];
      if (first) {
        await js(`[...document.querySelectorAll('.bottom-body .review-pt')].find((e) => e.querySelector('.where')?.innerText.trim() === ${JSON.stringify(`${rel(first.file)}:${first.line}`)})?.click(); return true;`);
        await sleep(1200);
        const at = await js(`return { tab: document.querySelector('.tab.active .label')?.textContent, line: document.querySelector('.cm-activeLine')?.innerText || '' };`);
        check('Parecer: a click on a point opens its file at its line', at.tab === path.basename(first.file) && norm(lines(rel(first.file)).slice(first.line - 2, first.line + 1).join(' ')).includes(norm(at.line)), { at, want: `${rel(first.file)}:${first.line}` });
      }
    }
    check('Parecer: the agent ran once, read-only (tools Skill and Read)', reviewCmds.length === 1 && readOnly(reviewCmds[0]), reviewCmds);
    let after = snapshot();
    check('Parecer: no file of the project changed', !changed(before, after).length, changed(before, after));
    note(`Parecer: written in .texugo: ${fs.existsSync(path.join(proj, '.texugo', 'review')) ? fs.readdirSync(path.join(proj, '.texugo', 'review')).join(', ') : 'nothing'}`);

    // ---------------------------------------------------------- Resposta
    await js(`document.querySelectorAll('.modal').forEach((m) => m.querySelector('footer button')?.click()); return true;`);
    await js(`[...document.querySelectorAll('.tab')].find((t) => t.innerText.includes('paper.tex'))?.click(); return true;`);
    await sleep(600);
    before = snapshot();
    check('Resposta: the dialog opens from the Revisão tab', (await clickBtn('.sidebar', 'Escrever a resposta…')) && (await until(`return (document.querySelector('.modal-title')?.innerText || '').includes('Resposta aos pareceristas');`, 5000)));
    check('Resposta: the dialog lists the "Submitted version" commit', await until(`return [...(document.querySelector('.modal select')?.options || [])].some((o) => o.text.includes('Submitted version'));`, 10000), await modalText());
    await js(`const ta = document.querySelector('.modal textarea'); ta.value = ${JSON.stringify(reportsText)}; ta.dispatchEvent(new Event('input')); const s = document.querySelector('.modal select'); s.value = [...s.options].find((o) => o.text.includes('Submitted version')).value; s.dispatchEvent(new Event('change')); return true;`);
    await clickBtn('.modal footer', 'Escrever a resposta');
    t0 = Date.now();
    const target = path.join(proj, 'response.tex');
    const outcome = await untilNode(async () => (fs.existsSync(target) && !(await js(`return !!document.querySelector('.modal');`)) ? 'file' : (await js(`return document.querySelector('.modal .qq-banner')?.innerText || '';`)) || null), LIMIT);
    const respondMs = Date.now() - t0;
    note(`Resposta: ${mmss(respondMs)}`);
    const respondCmds = agentArgs();
    check('Resposta: the agent ran once, read-only (tools Skill and Read)', respondCmds.length === 1 && readOnly(respondCmds[0]), respondCmds);
    if (outcome !== 'file') {
      check('Resposta: response.tex is written', false, outcome || 'timeout');
      if (outcome && LOGIN.test(outcome)) blocked = blocked || outcome;
      note(`Resposta: message on the screen: ${norm(outcome || 'none (timeout)')}`);
    } else {
      check('Resposta: response.tex is written and opens in the editor', await until(`return document.querySelector('.tab.active .label')?.textContent === 'response.tex';`, 5000));
      after = snapshot();
      const diff = changed(before, after);
      check('Resposta: response.tex is the only file written', diff.length === 1 && diff[0] === 'new response.tex', diff);
      const tex = fs.readFileSync(target, 'utf8');
      const copy = path.join(TMP, 'response-build');
      fs.cpSync(proj, copy, { recursive: true, filter: (f) => !f.includes(`${path.sep}.git`) });
      const b = spawnSync('latexmk', ['-pdf', '-interaction=nonstopmode', '-halt-on-error', 'response.tex'], { cwd: copy, encoding: 'utf8', timeout: 180000 });
      const log = fs.existsSync(path.join(copy, 'response.log')) ? fs.readFileSync(path.join(copy, 'response.log'), 'utf8') : '';
      check('Resposta: response.tex compiles without errors', b.status === 0 && fs.existsSync(path.join(copy, 'response.pdf')) && !/^! /m.test(log), (log.match(/^! .*$/m) || [b.stderr.slice(-400)])[0]);
      const bx = boxes(tex);
      note(`Resposta: ${bx.length} boxes, ${bx.reduce((n, x) => n + x.changes.length, 0)} "Change in the paper", ${bx.reduce((n, x) => n + x.todos.length, 0)} "To do"`);
      const rows = COMMENTS.map((c) => ({ ...c, box: bx.find((x) => x.comment.includes(c.key)) }));
      check('Resposta: a box for every comment of both reports (12)', rows.every((r) => r.box), rows.filter((r) => !r.box).map((r) => r.id));
      const allChanges = bx.flatMap((x) => x.changes);
      check('Resposta: every "Change in the paper" names a section and a page', allChanges.every((c) => /Section ``[^']+''/.test(c) && /p\.~\d+/.test(c)), allChanges.filter((c) => !(/Section ``/.test(c) && /p\.~\d+/.test(c))));
      const missed = rows.filter((r) => r.changed === 'paper' && r.box && !r.box.changes.length);
      check('Resposta: each comment the revision answered in the paper has a "Change in the paper"', !missed.length, missed.map((r) => r.id));
      const claimed = rows.filter((r) => !r.changed && r.box && r.box.changes.length);
      check('Resposta: no comment the revision left alone claims a change', !claimed.length, claimed.map((r) => `${r.id}: ${r.box.changes.join(' | ')}`));
      const open = rows.filter((r) => !r.changed && r.box && !r.box.todos.length);
      note(`Resposta: comments left alone without "To do" (explained or disputed in the reply): ${open.map((r) => r.id).join(', ') || 'none'}`);
      for (const r of rows) {
        if (!r.box) continue;
        const locs = r.box.locs.map((l) => {
          const ls = fs.existsSync(path.join(proj, l.file)) ? lines(l.file) : [];
          const hit = r.quote && norm(ls.slice(l.line - 2, l.line + 1).join(' ')).includes(norm(r.quote));
          return `${l.file}:${l.line}${r.quote ? (hit ? ' (the revised passage)' : ' (elsewhere)') : ''}`;
        });
        note(`Resposta: ${r.id} ${r.changed ? `changed in ${r.changed}` : 'not changed'} -> ${r.box.changes.length ? 'Change' : ''}${r.box.todos.length ? ' To do' : ''}${!r.box.changes.length && !r.box.todos.length ? 'reply only' : ''}${locs.length ? ' at ' + locs.join(', ') : ''}`);
      }
      fs.copyFileSync(target, path.join(TMP, 'response.tex'));
    }
  } catch (err) {
    check('the run finished without an exception', false, err.stack || String(err));
  }
  const failed = results.filter((r) => !r.ok);
  const report = [
    `# Parecer and Resposta with ${FAKE ? `the stand-in agent (${FAKE})` : 'Claude Code'}`,
    '',
    `${new Date().toISOString()} · ${FAKE ? 'fake-claude.mjs' : real} · folder ${TMP}`,
    '',
    ...results.map((r) => `- ${r.ok ? 'ok' : '**FAIL**'} ${r.name}${r.ok ? '' : `: \`${JSON.stringify(r.detail).slice(0, 600)}\``}`),
    '',
    ...notes.map((n) => `- ${n}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(TMP, 'report.md'), report);
  fs.mkdirSync(path.join(REPO, 'out'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'out', 'referees-report.md'), report);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Report: ${path.join(TMP, 'report.md')}`);
  if (blocked) console.log(`BLOCKED Claude Code is not logged in: ${norm(blocked)}`);
  app.exit(blocked ? 2 : failed.length || !results.length ? 1 : 0);
});
