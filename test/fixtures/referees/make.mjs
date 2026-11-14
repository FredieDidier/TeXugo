// A sample paper for trying "Parecer" and "Resposta aos pareceristas" with a
// real agent: the "Artigo + apêndice" template filled with an invented study
// (bike-share docks and short car trips in an invented city), a Git commit of
// the submitted version, a second commit with the revision, and two invented
// referee reports beside the project folder.
//
//   node test/fixtures/referees/make.mjs <folder>
//
// creates <folder>/bike-share-paper (the project) and <folder>/reports.txt
// (the text to paste). The folder must not hold a bike-share-paper already.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

// The twelve referee comments, a phrase of each that the response must copy,
// and whether the revision changed the paper for it, with the file and a
// phrase of the revised text where it did. "appendix" marks the one change
// made only in appendix.tex, the linked online appendix.
export const COMMENTS = [
  { id: 'R1.1', key: 'Please cluster by district', changed: 'paper', file: 'sections/body.tex', quote: 'Standard errors are clustered by district, the level at which' },
  { id: 'R1.2', key: 'varies with the distance between a sensor', changed: null },
  { id: 'R1.3', key: 'changes in sensor coverage', changed: 'paper', file: 'sections/body.tex', quote: 'Keeping only the 356 sensors installed before 2018' },
  { id: 'R1.4', key: 'choice of this threshold', changed: null },
  { id: 'R1.5', key: 'which districts went into each wave', changed: null },
  { id: 'R1.6', key: 'repeated word', changed: 'paper', file: 'sections/body.tex', quote: 'The comparison follows the difference-in-differences logic' },
  { id: 'R2.1', key: 'per 1,000 residents and day, so that readers', changed: 'paper', file: 'sections/body.tex', quote: 'the estimate amounts to about 14 fewer short car trips' },
  { id: 'R2.2', key: 'moves every opening date one year earlier', changed: 'appendix', file: 'appendix.tex', quote: 'Moving every opening one year earlier, to months in which no dock existed' },
  { id: 'R2.3', key: 'spillovers across district borders', changed: null },
  { id: 'R2.4', key: 'taxi or ride-hailing trips', changed: null },
  { id: 'R2.5', key: 'robust to heterogeneous treatment effects', changed: null },
  { id: 'R2.6', key: 'has no note saying what the standard errors', changed: 'paper', file: 'sections/body.tex', quote: 'Standard errors clustered by district in parentheses' },
];

const PLACEBO = `\\section{Placebo timing}\\label{app:placebo}
Moving every opening one year earlier, to months in which no dock existed, gives a coefficient of 0.006 (0.019) on short car trips.

`;

export async function makeRefereeProject(parent) {
  const proj = path.join(parent, 'bike-share-paper');
  if (fs.existsSync(proj)) throw new Error(`${proj} already exists`);
  const { createFromTemplate } = await import(pathToFileURL(path.join(REPO, 'server', 'templates.js')).href);
  createFromTemplate('artigo-apendice', proj, { title: 'Bike-Share Docks and Short Car Trips', author: 'A. Author', institution: 'Example University', format: 'padrao' }, 'en');
  fs.rmSync(path.join(proj, '.DS_Store'), { force: true });
  const write = (rel, text) => fs.writeFileSync(path.join(proj, rel), text);
  const read = (rel) => fs.readFileSync(path.join(proj, rel), 'utf8');
  write('sections/body.tex', fs.readFileSync(path.join(HERE, 'body-submitted.tex'), 'utf8'));
  write('paper.tex', read('paper.tex').replace('The question, the variation, the estimate and why it matters.', 'Bike-share docks opened in four waves across the 31 districts of an invented city reduced car trips shorter than three kilometres by about 6 percent, with no change in longer trips.'));
  // The appendix table carries the numbers the robustness section cites.
  write('appendix.tex', read('appendix.tex').replace('Treated $\\times$ post & 0.11 & 0.14 \\\\\n                          & (0.05) & (0.06) \\\\', 'Treated $\\times$ post & $-0.058$ & $-0.066$ \\\\\n                          & (0.022) & (0.025) \\\\').replace('& Drop 2020 & Urban only', '& Drop 2020 & Central districts'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'A. Author', GIT_AUTHOR_EMAIL: 'author@example.org', GIT_COMMITTER_NAME: 'A. Author', GIT_COMMITTER_EMAIL: 'author@example.org' };
  const git = (...a) => execFileSync('git', a, { cwd: proj, env, stdio: 'pipe' }).toString().trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Submitted version');
  const submitted = git('rev-parse', 'HEAD');
  write('sections/body.tex', fs.readFileSync(path.join(HERE, 'body-revised.tex'), 'utf8'));
  write(
    'appendix.tex',
    read('appendix.tex')
      .replace('\\begin{tabular}{lcc}', '\\begin{tabular}{lccc}')
      .replace('& Drop 2020 & Central districts', '& Drop 2020 & Central districts & Fixed sensors')
      .replace('& $-0.058$ & $-0.066$ \\\\\n                          & (0.022) & (0.025) \\\\', '& $-0.058$ & $-0.066$ & $-0.063$ \\\\\n                          & (0.022) & (0.025) & (0.023) \\\\')
      .replace('\\end{document}', PLACEBO + '\\end{document}'),
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'Revision after the reports');
  const reports = path.join(parent, 'reports.txt');
  fs.copyFileSync(path.join(HERE, 'reports.txt'), reports);
  return { proj, doc: path.join(proj, 'paper.tex'), reports, submitted };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parent = process.argv[2];
  if (!parent) {
    console.error('usage: node test/fixtures/referees/make.mjs <folder>');
    process.exit(1);
  }
  fs.mkdirSync(parent, { recursive: true });
  const r = await makeRefereeProject(path.resolve(parent));
  console.log(`project:   ${r.proj}\nreports:   ${r.reports}\nsubmitted: ${r.submitted.slice(0, 7)} "Submitted version"`);
}
