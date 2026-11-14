// AI writing actions on a selection, run through the user's own agent
// (Claude Code, Codex, Gemini CLI or OpenCode) in its non-interactive,
// read-only mode (server/agents). It runs in the project folder, so the
// user's installed skills and project settings apply; it can read the
// project, never edit a file. The editor shows the result as a diff the user
// accepts or discards.
import { serverLang } from './lang.js';
import fs from 'node:fs';
import path from 'node:path';
import { oneShot, cancelAi } from './agents/adapter.js';

export { cancelAi };

export const ACTIONS = {
  revisar: 'Revise the passage: fix grammar, wording, clarity and any claim the wording overstates. Keep the meaning, the structure and the length roughly the same.',
  reescrever: 'Rewrite the passage freely so it reads better: you may reorder sentences, split or merge them, change the structure and the wording, and cut repetition. Keep every claim, number, qualifier, citation and the meaning exactly; do not add new claims or content. The length may change, but do not pad.',
  polir: 'Polish the passage: smoother wording and better word choice, same meaning, same structure, same length.',
  humanizar: 'Remove every AI writing tell from the passage (the dated catalogue in the writing skill, if one is available; the flagged spans listed below are candidates) so it reads as written by the author. Keep every number, claim and qualifier.',
  encurtar: 'Shorten the passage by about a third. Cut words that say nothing; never cut a qualifier, a number, a subject or the referent of a pronoun, and do not compress sentences into aphorisms.',
  traduzir: 'Translate the passage from Portuguese into English for an academic economics journal. Natural English, no calques from Portuguese, same register, same LaTeX commands.',
  fluidez: 'Improve flow and cohesion: the links between sentences and between this passage and its neighbours (transitions, referents, the order of information, given before new). Change only what the flow needs.',
  trocar: 'Replace only the spans the TeXugo detector flagged (listed below) with plain, specific wording that fits the sentence. Change nothing else: every other word, number, citation and the sentence structure stay exactly as they are, unless a flagged span cannot be replaced without touching its immediate neighbours.',
  formal: 'Make the passage more formal, in the register of an academic paper, without inflating it: plain words, no stock phrases.',
};

const DEFAULT_STYLE = `House style when no writing skill is available: plain, formal and specific.
Prefer the simple verb ("is", "uses"). No em dashes. No "not only X but also Y", no "it is worth noting",
no trailing "-ing" clause commenting on the sentence, no inflated words (crucial, pivotal, delve, showcase,
underscore, landscape, tapestry, robust as praise, genuinely, quietly). In Portuguese, no comma before the
final "e" of a list, no Title Case in headings, no "vale ressaltar", "desempenha um papel crucial", "Além disso,"
at every sentence, no calques from English (endereçar, assumir que). Keep the author's terms and numbers.`;

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
    `Do not edit any file. Reply with the rewritten passage only, between <texugo> and </texugo>, and then one or two short sentences, in ${serverLang() === 'en' ? 'English' : 'Portuguese'} (the language of the user's interface), between <nota> and </nota>, saying what you changed and why.`,
    style ? `The project's style guide (${path.basename(style.path)}) has priority over everything else:\n<estilo>\n${style.text}\n</estilo>` : DEFAULT_STYLE,
    hints.length ? `Spans the TeXugo detector flagged in the passage (candidates, judge them in context):\n${hints.map((h) => `- "${h.text}": ${h.why}`).join('\n')}` : '',
    before ? `Context before the passage (read only, do not rewrite):\n<antes>\n${before}\n</antes>` : '',
    `<passage>\n${text}\n</passage>`,
    after ? `Context after the passage (read only, do not rewrite):\n<depois>\n${after}\n</depois>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// One read-only run of the chosen agent in the project folder. Returns the
// final text. Used by the selection actions, the referee review and the
// response to referees.
export const runAgent = oneShot;

export async function rewrite(opts) {
  const prompt = buildPrompt(opts);
  const t0 = Date.now();
  const result = await runAgent(prompt, opts);
  const res = result;
  const m = res.match(/<texugo>\n?([\s\S]*?)\n?<\/texugo>/);
  if (!m) throw new Error('A resposta veio sem o trecho reescrito. Tente de novo.');
  const note = (res.match(/<nota>([\s\S]*?)<\/nota>/) || [])[1];
  return { text: m[1], note: note ? note.trim() : null, ms: Date.now() - t0, style: (styleFile(opts.root, opts.file) || {}).path || null };
}
