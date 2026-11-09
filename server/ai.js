// AI writing actions on a selection, run through the user's own Claude Code
// in headless mode (claude -p). It runs in the project folder, so the user's
// installed skills and project settings apply. Claude only gets the Read and
// Skill tools: it can read the project and load a writing skill, never edit a
// file. The editor shows the result as a diff the user accepts or discards.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { toolEnv, which } from './util.js';

export const ACTIONS = {
  revisar: 'Revise the passage: fix grammar, wording, clarity and any claim the wording overstates. Keep the meaning, the structure and the length roughly the same.',
  polir: 'Polish the passage: smoother wording and better word choice, same meaning, same structure, same length.',
  humanizar: 'Remove every AI writing tell from the passage (the dated catalogue in the writing skill, if one is available; the flagged spans listed below are candidates) so it reads as written by the author. Keep every number, claim and qualifier.',
  encurtar: 'Shorten the passage by about a third. Cut words that say nothing; never cut a qualifier, a number, a subject or the referent of a pronoun, and do not compress sentences into aphorisms.',
  traduzir: 'Translate the passage from Portuguese into English for an academic economics journal. Natural English, no calques from Portuguese, same register, same LaTeX commands.',
  fluidez: 'Improve flow and cohesion: the links between sentences and between this passage and its neighbours (transitions, referents, the order of information, given before new). Change only what the flow needs.',
  formal: 'Make the passage more formal, in the register of an academic paper, without inflating it: plain words, no stock phrases.',
};

const DEFAULT_STYLE = `House style when no writing skill is available: plain, formal and specific.
Prefer the simple verb ("is", "uses"). No em dashes. No "not only X but also Y", no "it is worth noting",
no trailing "-ing" clause commenting on the sentence, no inflated words (crucial, pivotal, delve, showcase,
underscore, landscape, tapestry, robust as praise, genuinely, quietly). In Portuguese, no comma before the
final "e" of a list, no Title Case in headings, no "vale ressaltar", "desempenha um papel crucial", "Além disso,"
at every sentence, no calques from English (endereçar, assumir que). Keep the author's terms and numbers.`;

let current = null;

export function cancelAi() {
  if (current) {
    try {
      current.kill('SIGTERM');
    } catch {}
    current = null;
    return true;
  }
  return false;
}

function styleFile(root, file) {
  // Optional per-project style: estilo.md or style.md at the project root or
  // beside the file.
  for (const dir of [path.dirname(file), root]) {
    for (const name of ['estilo.md', 'style.md', 'ESTILO.md', 'STYLE.md']) {
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isFile()) return { path: p, text: fs.readFileSync(p, 'utf8').slice(0, 20000) };
      } catch {}
    }
  }
  return null;
}

export function buildPrompt({ action, text, before = '', after = '', file, root, hints = [], lang }) {
  const task = ACTIONS[action];
  if (!task) throw new Error('Ação desconhecida: ' + action);
  const style = styleFile(root, file);
  const kind = /\.tex$/i.test(file) ? 'LaTeX' : /\.(md|markdown)$/i.test(file) ? 'Markdown' : 'plain text';
  return [
    `You are editing a passage of ${path.basename(file)} (${kind}) in the project at ${root}.`,
    `If a writing skill is available to you (for example applied-micro-paper-writing), load it first and follow it.`,
    task,
    `The passage is in ${lang === 'en' ? 'English' : lang === 'pt' ? 'Portuguese' : 'its own language'}; ${action === 'traduzir' ? 'the result must be in English' : 'keep that language'}.`,
    `Keep every LaTeX command, citation key, label, reference, math and comment exactly as they are, unless the action requires moving them.`,
    `Do not edit any file. Reply with the rewritten passage only, between <texugo> and </texugo>, and then one or two short sentences, in Portuguese, between <nota> and </nota>, saying what you changed and why.`,
    style ? `The project's style guide (${path.basename(style.path)}) has priority over everything else:\n<estilo>\n${style.text}\n</estilo>` : DEFAULT_STYLE,
    hints.length ? `Spans the TeXugo detector flagged in the passage (candidates, judge them in context):\n${hints.map((h) => `- "${h.text}": ${h.why}`).join('\n')}` : '',
    before ? `Context before the passage (read only, do not rewrite):\n<antes>\n${before}\n</antes>` : '',
    `<passage>\n${text}\n</passage>`,
    after ? `Context after the passage (read only, do not rewrite):\n<depois>\n${after}\n</depois>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function rewrite(opts) {
  const claude = await which('claude');
  if (!claude) throw new Error('Claude Code não encontrado. Instale com: curl -fsSL https://claude.ai/install.sh | bash (e entre na sua conta com "claude" no Terminal).');
  if (current) throw new Error('Já há uma ação de IA em andamento.');
  const prompt = buildPrompt(opts);
  const t0 = Date.now();
  const out = await new Promise((resolve) => {
    const child = spawn(claude, ['-p', '--output-format', 'json', '--tools', 'Skill,Read', '--no-session-persistence'], { cwd: opts.root, env: toolEnv() });
    current = child;
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 300000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (current === child) current = null;
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(prompt);
  });
  if (out.signal === 'SIGTERM' && !out.stdout) throw new Error('Cancelado.');
  let data;
  try {
    data = JSON.parse(out.stdout);
  } catch {
    const msg = (out.stderr || out.stdout || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(/log ?in|auth|credential/i.test(msg) ? 'O Claude Code não está logado. Abra o Terminal, rode "claude" e entre na sua conta.' : 'O Claude Code falhou: ' + (msg || `código ${out.code}`));
  }
  if (data.is_error) throw new Error('O Claude Code respondeu com erro: ' + String(data.result || '').slice(0, 300));
  const res = String(data.result || '');
  const m = res.match(/<texugo>\n?([\s\S]*?)\n?<\/texugo>/);
  if (!m) throw new Error('A resposta veio sem o trecho reescrito. Tente de novo.');
  const note = (res.match(/<nota>([\s\S]*?)<\/nota>/) || [])[1];
  return { text: m[1], note: note ? note.trim() : null, ms: Date.now() - t0, style: (styleFile(opts.root, opts.file) || {}).path || null };
}
