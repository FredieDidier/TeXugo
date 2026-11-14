// A stand-in for `claude -p --output-format json`, used by test/ui/referees.mjs
// to check its own checks without spending the account: it answers the
// referee-review and the response-to-referees prompts with JSON built from
// the prompt itself. TEXUGO_REFEREES_FAKE=bad makes it misbehave on
// purpose (a file written into the project, a comment left out, a point
// without a real quote), which the checks must catch.
import fs from 'node:fs';
import path from 'node:path';
import { COMMENTS } from './make.mjs';

const args = process.argv.slice(2);
if (process.env.TEXUGO_REFEREES_ARGLOG) fs.appendFileSync(process.env.TEXUGO_REFEREES_ARGLOG, JSON.stringify(args) + '\n');
if (args.includes('--version')) {
  console.log('9.9.9 (Claude Code, stand-in)');
  process.exit(0);
}
const bad = process.env.TEXUGO_REFEREES_FAKE === 'bad';
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const reply = (data) => console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `<texugo>\n${JSON.stringify(data)}\n</texugo>` }));

if (prompt.startsWith('You are a referee')) {
  // Three points on lines of the body, each quoting 8 words of its line.
  const body = (prompt.match(/<file path="sections\/body\.tex">\n([\s\S]*?)\n<\/file>/) || [])[1] || '';
  const lines = body.split('\n').map((l) => l.match(/^(\d+)\| (.*)$/)).filter((m) => m && m[2].split(' ').length > 12);
  const points = lines.slice(0, 3).map((m, i) => ({ kind: ['major', 'minor', 'typo'][i], title: `Point ${i + 1}`, comment: 'A comment on this passage.', suggestion: '', file: 'sections/body.tex', line: Number(m[1]), quote: m[2].split(' ').slice(1, 9).join(' ') }));
  if (bad) {
    points.push({ kind: 'minor', title: 'Lost point', comment: 'Quotes nothing in the paper.', suggestion: '', file: 'sections/body.tex', line: 2, quote: 'words that appear nowhere in the paper at all' });
    fs.appendFileSync(path.join(process.cwd(), 'sections', 'body.tex'), '% edited by the agent\n');
  }
  reply({ summary: 'The paper studies bike-share docks.', recommendation: 'major revision', points });
} else {
  const reports = (prompt.match(/<reports>\n([\s\S]*?)\n<\/reports>/) || [])[1] || '';
  const sections = [];
  for (const line of reports.split('\n')) {
    if (/^Referee \d+$/.test(line.trim())) sections.push({ who: line.trim(), comments: [] });
    const m = line.match(/^\d+\.\s+(.*)$/);
    if (!m || !sections.length) continue;
    const c = COMMENTS.find((x) => m[1].includes(x.key));
    let changes = c && c.changed ? [{ what: `Revised for ${c.id}.`, file: c.file, line: 1, quote: c.quote }] : [];
    // Misbehaving: misses the change made for R1.1 and claims one for R1.2.
    if (bad && c && c.id === 'R1.1') changes = [];
    if (bad && c && c.id === 'R1.2') changes = [{ what: 'Claimed but never made.', file: 'sections/body.tex', line: 1, quote: COMMENTS[0].quote }];
    sections[sections.length - 1].comments.push({ comment: m[1], status: changes.length ? 'addressed' : 'todo', reply: 'We thank the referee.', changes });
  }
  if (bad) {
    sections[sections.length - 1].comments.pop();
    fs.writeFileSync(path.join(process.cwd(), 'canary.txt'), 'written by the agent\n');
  }
  reply({ intro: 'We thank the editor and the referees.', main_changes: ['Standard errors clustered by district.'], sections });
}
