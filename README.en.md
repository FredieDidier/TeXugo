<p align="center"><img src="web/assets/logo.svg" width="120" alt="TeXugo"></p>

<h1 align="center">TeXugo</h1>
<p align="center"><i>Fierce with errors, gentle with you.</i></p>
<p align="center"><a href="README.md">Português</a> · <b>English</b></p>

TeXugo is a local LaTeX editor for the Mac. Your files stay on your disk and compiling is local, with your own TeX Live. Some optional features reach external services: the AI actions and the Claude panel (through your Claude Code, to Anthropic), reference search and checking (Crossref, OpenAlex, arXiv), your Git remote when syncing, the TeX Doctor when installing packages and, only if you choose it, the online LanguageTool. The full list, with what each one sends, is in [PRIVACY.md](PRIVACY.md). It is made for papers, research proposals, responses to referees, referee reports, Beamer slides, syllabi, exams, problem sets, reports and letters. It also opens Markdown files, with a side-by-side preview.

The interface is in Portuguese by default; switch it to English in Preferências → Idioma (Preferences → Language). With the English interface, the templates come out in English too.

## What it does better

- **Many tabs, each with its own Compile button.** A tab shows the root document its file belongs to. When a file goes into more than one document (say, `sections/body.tex` in both `paper.tex` and `paper_wp.tex`), a picker lets you choose which one to compile.
- **Compile all.** The button at the top (⌘⇧↵) compiles every document of the open tabs, each one once, and says how many ("Compile the 2 documents"). Hovering shows which documents and which tabs go into each.
- **Zero `??` with `\externaldocument`.** When the paper imports the appendix's labels (`xr`/`xr-hyper`) and the appendix imports the paper's, compiling one file alone leaves `??` in the PDF. TeXugo compiles the whole group in the right order and repeats until the labels settle. It also survives deleted `.aux` files and orphan `.bbl` files, which make `latexmk` run BibTeX before LaTeX.
- **Every `??` comes with its reason.** The Problems panel lists undefined references and citations with the likely cause: a label that does not exist, a label in another document without `\externaldocument`, a key that is in no `.bib`. LaTeX errors come with a plain-language hint and the right line.
- **Build timeline.** Shows what is running, in which pass and why ("labels of paper.tex changed").
- **PDF on the side, one tab per document.** The PDF reloads at the same spot after compiling. SyncTeX: ⌘J goes from the code to the PDF, and a double click on the PDF goes to the line of code. There is a screen-only dark mode. For a PDF compiled outside TeXugo, without SyncTeX, the app explains why and offers to compile.
- **A real editor.** CodeMirror with LaTeX highlighting, completion of `\ref`/`\cref` (from the project's labels), `\cite` (from the `.bib` keys) and environments, figure, table and slide snippets, automatic `\end{…}`, ⌘B/⌘I and ⌘/ to comment.
- **SyncTeX for PDFs compiled outside TeXugo too**: without a `.synctex.gz` (a PDF from Overleaf, the terminal or another editor), the double click on the PDF and ⌘J go by the text: TeXugo looks up the words of the passage in the code and those of the line in the PDF. The position is approximate; compiling in TeXugo makes it exact.
- **Git without a required message**: leave the message empty and TeXugo writes one from the files ("Atualiza paper.tex e refs.bib"). **Sync** commits what changed, pulls and pushes in one click.
- **Shortcuts and commands** (⌘?, Help menu, palette or start screen): every shortcut with what it does and where else to find each command (menu, button, icon), with search.
- **Files changed outside the app** (git pull, Claude Code, another editor) reload by themselves. If you have unsaved changes, the app asks before overwriting.
- **Git and GitHub.** Status, diff, commit, pull and push in the side panel, using the system git and the credentials GitHub Desktop already set up. When you open a repository, TeXugo completes the `.gitignore` with LaTeX's auxiliary files (`.aux`, `.log`, `.fls`…) so they stay out of commits.
- **Slides:** a "Present" button for Beamer (full screen, one slide at a time, arrows and click) and a mode where the PDF follows the editor cursor.
- **Submission:** a ZIP that compiles on its own. It carries the `.bbl` instead of the `.bib`, as arXiv asks; brings in files from outside the document folder (such as `../analysis/figures`), with paths fixed only in the copies; and, before saying it is ready, extracts the ZIP into an empty folder and compiles it the way arXiv does, pointing out errors, `??`, missing files or files read from outside. **Check before submitting**: anonymity for double-blind review (names, e-mails, `\thanks`, acknowledgments, GitHub/OSF links, absolute paths with your user name, comments with names, PDF author metadata) and PDF fonts (Type 3 and non-embedded fonts, which many journals reject); style review with ChkTeX; word count with texcount.
- **Replication package** (Review tab, Replication tab of the bottom panel, or the palette): the checklist the journal's Data Editor will run, before they run it. It is one list, on the standard that AEA, the Econometric Society, ReStud, EJ, JEEA, JPE and others follow (the Data and Code Availability Standard, DCAS); the journal you pick changes where the package goes (openICPSR, Zenodo, Dataverse, Mendeley Data), when, and a few details (README as a PDF, an open copy of `.dta` files). TeXugo reads the project folder and checks: a README at the root and the sections of the Data Editors' template (and any TODO left), a license, code by language, one script that runs everything, absolute paths in code, random draws without a seed (R, Stata, Python, Julia, MATLAB), recorded package versions (renv, requirements, an ado folder), data files and formats, datasets cited in the `.bib`, package size, system files and, for each table and figure of the paper, which script writes it. Each warning lists the places (file:line) and opens them on click. What only the authors know (rights to the data, a run from scratch in a clean folder, numbers in the text coming from code, ethics approval, pre-registration) is a Done/Not applicable box, kept in `.texugo/replication.json`. **README draft**: in the shape of the Data Editors' template, with the dataset list, the packages used, the R or Python version, the seed's line, the size range, the programs and the "table/figure → program" table filled in, and TODOs for the rest; it never writes over a README (it saves `README-rascunho.md` instead).
- **Review tab** (clipboard in the left bar, with the number of open points): everything about reviewing the open document in one place, in the order it happens. *Coauthors*: comments in the text, PDF annotations, compare with another version, sent versions, news since your last visit and who wrote each passage. *Referees*: Claude's referee report and the response to referees. *Before sending*: writing tics, references in Crossref, anonymity and font checks, replication package, submission ZIP, ChkTeX and word count. Each row says where things stand ("2 of 3 open", "response.tex 30 min ago") and opens the tool; long lists go to the bottom panel.
- **Comments in the text** (selection bar 💬, right-click, ⌥⌘M): select a passage and leave a comment for your coauthors; they reply and resolve. Each conversation is a file in `.texugo-comments/` in the project folder and goes along with the commit, so it reaches whoever pulls (one file per conversation: two coauthors commenting at the same time never conflict). The passage is marked in the editor; hover to see the conversation. It is found again by its text, not its line: it survives new lines above, rewrapping and your own edits to the passage (the comment follows the new text when you save). If a coauthor rewrites the passage, the conversation stays in the **Comments** tab of the bottom panel marked "passage changed", with the text as it was. The Review tab counts the open comments.
- **News since your last visit** (Review tab, **News** tab of the bottom panel, palette): when you open the project, TeXugo asks the remote what arrived and tells you who changed what since you last looked: per coauthor, the commits, the files (+/− lines) and the **sections** each one touched (Introduction, Data…), with a click to go to the section, see the file's diff or the commit. Your own commits are left out; what is on the remote and not yet pulled shows apart, with the pull button, each file's diff and **See in the PDF**: the paper compiled with what arrived marked (blue came in, red struck out went out), before pulling and without changing anything here. The same button at the top shows in the PDF everything that changed since your visit. The visit mark lives in `.git/texugo-visit.json` (per clone, never committed) and only moves when you open the news; you can also see the last 7 or 30 days.
- **Who wrote each passage** (people icon above the editor, Review tab, palette): the initials of whoever last changed each line, one colour per coauthor, from `git blame` of the editor's text (it follows what you type before saving; new lines show as yours). Hover for the name, date and commit; click to see the commit. The Review tab shows how much of the file is each person's.
- **Review as a referee** (Review tab): your Claude Code reads the whole paper, `\input`s included, and writes a referee report to the standard of the journal you name (with an optional focus): summary, recommendation and each comment (major, minor, writing) with a suggestion. Each point quotes the passage, and TeXugo finds that passage in the text: a click takes you to the right line. It runs in the background, shows up in the **Report** tab of the bottom panel with a "resolved" box, a button that sends the point to the Claude panel and **Save .md**. It uses the model and effort chosen in the Claude panel and only reads files.
- **Response to referees** (Review tab): paste the editor's letter and the reports and choose the submitted version (a Git commit or the file/ZIP you sent). TeXugo works out what changed since then and your Claude Code splits each comment, drafts the reply and says where the paper changed. The result is a `response.tex` in the template's format: each comment in a box, the reply, *Change in the paper* with the section and PDF page (via SyncTeX) and a red *To do* for what is still missing (including numbers that were not re-estimated). Each change carries a `% file.tex:line` comment; **⌘-click** on it (or on any `file.tex:123` in the editor) opens that line.
- **PDF annotations** (Review tab): highlights, underlines, strikeouts and notes made in Preview, Acrobat or any reader, on the document's PDF or on a PDF a coauthor sent back annotated. They show up in the **Annotations** tab of the bottom panel with the marked passage, the comment and the author, each tied to its `.tex` line (via SyncTeX; margin notes and PDFs without SyncTeX, by text). Click to go to the line, mark it resolved, or send it to the Claude panel to make the change.
- **Replace the flagged passage**: in the tooltip of a writing tic, *Replace with Claude* rewrites only the underlined words of the sentence; you accept or discard the diff.
- **Sent versions** (Review tab, Suggestions tab of the bottom panel, or palette): for when the same paper goes to several people and the feedback comes back out of order. When you send it, *Mark as sent* keeps the text as it is, with the PDF and SyncTeX (in `.texugo/sent`, outside Git). When feedback comes back (a `.tex`, an Overleaf ZIP, a folder or an annotated PDF), it is read against the **sent** version, not today's: only that person's changes show, even if you have already brought in another coauthor's. Each suggestion is compared word by word (line breaks don't count) with what changed since sending: *applies as is* (one click, in the editor, ⌘Z undoes; or all at once), *already in the text* (someone made the same fix), *conflict* (the passage changed too: today's text and the suggestion side by side, with *Use the suggestion*, *Keep today's* or *Merge with Claude*) and *passage gone*. With no version marked, TeXugo guesses the base: the sent version or the commit closest to what came back. In an annotated PDF, each note is tied through the sent version's SyncTeX and found at today's line for the same passage, with a warning when the passage has changed since sending. At the end, *Commit…* suggests the message "Suggestions from Name".
- **Compare with another version** (Review tab or palette): pick the `.tex`, the ZIP (exported from Overleaf) or the folder a coauthor sent, or a Git commit, and TeXugo uses `latexdiff` to build the PDF with the changes marked (new text underlined in blue, deleted text struck out in red), compiled with your figures, tables and `.bib`, and opens it in a tab on the side. It compares the whole document, `\input`s included; files the received version lacks count as equal to yours.
- **References tab** (book icon in the left bar): every entry of the project's `.bib` files, with search by author, title, year or key, how many times each is cited (and a filter for the uncited ones), details and links (DOI, arXiv, Scholar, line in the `.bib`), double click or *Cite at cursor* to cite, and **+** to add.
- **Import from Zotero** (down arrow in the References tab, or palette): search your library, tick the items and they go into the `.bib` (what is already there, by DOI, shows dimmed). It reads through Zotero 7's local API when it is on and, otherwise, from a copy of `zotero.sqlite`, with nothing to set up and without touching the original. **Import .bib…** merges a `.bib` exported from Zotero, Better BibTeX, Mendeley or Paperpile, skipping entries with the same key, DOI or title.
- **Paper library** (⌥⌘B, View menu or palette): the PDFs you read, kept once for every project. Add PDFs, drag them onto the window or bring in the PDFs attached in Zotero, with title, authors and year from there. Each one's text is read once and the search goes through all of them: case and accents ignored, words on the same page or an "exact phrase", and each result shows the page and the passage. A click opens the paper at that page with the words highlighted (↵ goes to the next one); it can also open in the PDF pane, beside the text you are writing.
- **Check in Crossref** (✓ at the top of the tab): checks every entry. With a DOI, it reads the record; without one, it searches by title and first author and only accepts the same work (for `@article`, the published journal version, never the NBER/SSRN working paper with the same title). It flags DOIs that lead to another work or do not exist, and suggests missing year, journal, volume, number, pages and DOI; nothing changes until you click *Apply*, and the fix touches only that field.
- **Add reference** (⌥⌘R): paste a DOI, an article link (ScienceDirect, arXiv) or part of the title. TeXugo searches Crossref, OpenAlex and arXiv, shows the options, writes a clean entry to the document's `.bib` (key in the `smith2020markets` style, NBER working papers with their number) and cites it at the cursor.
- **Grammar checker** for Portuguese and English, with [LanguageTool](https://languagetool.org) running on your Mac: spelling underlined in red, grammar and style in blue. Hovering shows the explanation and the suggestions, and one click replaces the word. LaTeX does not get in the way: commands, math, `\cite` and `\ref` are read as part of the sentence instead of becoming errors, and footnotes are checked on their own. The default is the **strict** mode, which flags as much as possible: it turns on the grammar rules LanguageTool ships switched off and adds a TeXugo rule for Portuguese subject-verb agreement ("As crianças brinca no quintal" → "brincam") that LanguageTool misses. You can switch to the normal mode, add words to your dictionary and silence a rule in Preferences. If LanguageTool is not installed, the "checker: install" item in the status bar installs it through Homebrew with one click. There is also the option of LanguageTool's online server, which sends the text out.
- **Live preview**: with the "live" switch on (next to Compile), the PDF follows what you type, without saving. After a short pause, TeXugo compiles the text on screen in a separate folder (`.texugo/live`), with a single engine pass, and swaps the PDF without losing your place. Your files and the real PDF do not change. While a command is half typed (an unclosed brace, say), the PDF stays at the last good version and the switch shows the error. Since BibTeX does not run live, new citations and labels appear when you compile. ⌘J and the double click work on the live PDF too.
- **Equation preview**: with the cursor inside a formula (`$…$`, `\(…\)`, `\[…\]`, `$$…$$`, `equation`, `align`, `gather`, `multline`…), the equation is drawn right above it as you type, without compiling. It uses the project's own macros (`\newcommand`, `\DeclareMathOperator`, `\def`, including from `.sty` files); a syntax error shows in red in place of the formula.
- **Citation card**: hover over a key inside `\cite{}` to see title, authors, year and journal, with links to the DOI, arXiv, Google Scholar and the `.bib` entry. A key that does not exist shows in red, with a shortcut to add it.
- **Paste a table**: cells copied from Excel, Numbers or Google Sheets become a `booktabs` table when pasted into a `.tex` (number columns centered, `***` as superscript, `_`, `%`, `$` and `&` escaped). Inside an open `tabular`, only the rows go in. For CSV, use the palette.
- **Format document** (⌥⇧F) with TeX Live's `latexindent`, as one edit that ⌘Z undoes. It works even on MacTeX, whose `latexindent` usually breaks for lack of the Perl module `File::HomeDir`: TeXugo ships a minimal stand-in.
- **TeX doctor:** shows the state of the installation and, when compiling complains about a missing `.sty` or `.cls`, finds the TeX Live package that has the file and installs it with one click. The administrator password is typed in macOS's own window. If TeX Live is from an earlier (frozen) year, it uses that year's final archive, the only one that still accepts installs.
- **Markdown** opens rendered as on GitHub (Preview / Side by side / Code).
- **Writing-tic detector** (AI tells), in Portuguese and English, with no AI and no internet. It underlines in purple the vocabulary models use far more than people do (with the era of each word: *delve* in 2023–24, *showcasing* and *enhance* with GPT‑5, *quietly* and *load-bearing* in 2025–26), em dashes, "not only X but also Y", participle clauses commenting on the sentence, announced conclusions, chatbot leftovers, Markdown pasted into LaTeX, calques, and long chained sentences. Hovering gives the reason, what to do and the source. It skips what is not prose: comments, math, `\cite`, `\label`, preamble, tables. The rules and sources live in `web/src/vicios/rules.js`; they are candidates to review, not proof of authorship.
- **Rewrite with AI, using your own Claude Code.** Select a passage and right-click: Replace the flagged passage, Review, Rewrite, Polish, Humanize, Shorten, Translate to English, Flow and cohesion, More formal. TeXugo calls the `claude` installed on your Mac, in the project folder, with your account and your skills, and only with permission to read files and load skills: it never edits anything by itself. The answer shows as a word-by-word diff with a note of what changed; Accept replaces the passage in one edit (⌘Z undoes). An `estilo.md` in the project folder overrides everything; without it, a default style guide applies.
- **Claude model and effort.** In the Claude panel, two menus pick the model (Opus 5.5, Sonnet 5.5, Fable 5.2, Haiku 5.5) and the effort (low to max); the default is Opus 5.5 with medium effort. The choice applies to the panel, to Claude Code in the terminal and to the AI actions on a selection.
- **Terminal and Claude Code inside TeXugo.** Bottom panel, Terminal tab (⌃`): real terminals in the project folder, several at once, that keep running if the window reloads. The **Claude Code** button opens your `claude` connected to TeXugo through the same protocol VS Code uses: Claude sees the selection live, the open tabs and, as diagnostics, the compile errors and `??` of the last build; each edit it proposes shows in TeXugo as a word-by-word diff to Accept or Reject.
- **Split editor** (⌘⌥\\ or the columns button in the document bar): another file on the side, like the paper and the appendix, or two parts of the same file.
- **PDF in a separate window**, for another monitor, with SyncTeX between the windows.
- **Clone from GitHub** straight into a new project.
- **Templates (12), in pairs by theme:** research (paper; paper + online appendix; response to referees; referee report; research proposal; report), teaching (Beamer slides with the "Toca" theme; syllabus; exam with points added up, grade table and an answer key in one line; problem set with solutions only in the instructor's version) and other (letter; blank document). Paper and paper + appendix have a **journal format**. Both offer Standard (working paper), Standard double-spaced (what QJE, ReStud, JPE, EJ, JEEA and ReStat accept at submission) and Elsevier (JDE, JPubE, JUE, JEEM). The paper alone also has APA 7 (psychology, education, business, health) and two columns (IEEE, engineering and computing). AEA (AER, AEJ, Insights) and Econometrica live in paper + appendix, since those papers almost always come with an online appendix.
- **Portuguese or English:** the whole interface, menus, hints and error messages included, switches language in Preferences → Language.
- **Start screen** (click the logo or the house): templates, open folder, clone from GitHub and recent projects.
- **Preferences:** editor and Markdown font, size and line spacing; theme; compile on save; live preview; grammar checker (strictness, local or online, dictionary).
- Project search, document outline (sections, slides, labels), command palette (⌘K), quick open (⌘P), word count, light and dark themes.

## Running

You need [MacTeX](https://tug.org/mactex/) (or another TeX Live with `latexmk`) and Node 20 or newer.

```bash
npm install
npm start
```

To develop in the browser, without Electron (uses its own preferences, separate from the installed app's):

```bash
npm run serve
```

To build `out/TeXugo.app` (drag it to Applications; if there is already a TeXugo there, it is updated):

```bash
npm run package
```

To have every commit reinstall the app by itself (in the background; macOS notifies when done, and the log goes to `out/auto-install.log`):

```bash
git config core.hooksPath .githooks
```

Tests:

```bash
npm test
```

## Shortcuts

| Shortcut | What it does |
|---|---|
| ⌘↵ | Compile the tab's document |
| ⌘⇧↵ | Compile everything open |
| ⌘S / ⌥⌘S | Save the tab / all |
| ⌘J | Show the cursor's passage in the PDF |
| double click on the PDF | Go to the line of code |
| ⌥⌘R | Add a reference by DOI, arXiv or title |
| ⌥⌘B | Paper library (read and search the text) |
| ⌥⇧F | Format the document (latexindent) |
| ⌘P | Open a file |
| ⌘K | Command palette (recently used first) |
| ⌃G | Go to line (or `:42` in the palette) |
| F6 | Moves between files, editor, PDF and bottom panel |
| ⌘⇧F | Search the project |
| ⌘\\ | Show or hide the sidebar |
| ⌘⌥\\ | Split the editor or close the split |
| ⌃Tab | Next tab |

## How it works

- `server/`: local Node server. Handles files, compiling (`build.js`), reading the log (`logparse.js`), SyncTeX and git. It only accepts connections from `127.0.0.1` with a token generated each time the app opens.
- `web/`: the interface (CodeMirror 6 + pdf.js), bundled with esbuild into `dist/`.
- `server/doctor.js`: TeX doctor and `latexindent`; `server/submission.js`: ZIP and anonymity check; `server/replication.js` and `server/replication-journals.js`: the replication-package checklist and what each journal asks; `server/templates/`: the templates (English versions in `<template>/en/`).
- `server/live.js` and `web/src/live.js`: live preview; `server/grammar.js` and `web/src/grammar/`: grammar checker (LaTeX → text, LanguageTool and TeXugo's agreement rule).
- `web/src/i18n.js`: English translation of the interface.
- `electron/`: the Mac window, menus, folder picker and "move to Trash".
