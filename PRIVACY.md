# Privacy in TeXugo

<p><a href="PRIVACIDADE.md">Português</a> · <b>English</b></p>

TeXugo runs on your computer. Your files stay on your disk, and compiling uses your own TeX. TeXugo has no server, asks for no account, collects no usage statistics and sends nothing to the app's author.

Some features, all optional, talk to outside services. The table says which, when, and what each one sends.

## What leaves your computer

| Where to | When | What is sent | How to avoid it |
|---|---|---|---|
| Anthropic, through **your** Claude Code | AI actions on the text, the Claude panel, referee report, response to referees | The chosen passage and the context around it. The referee report sends the whole paper, and the response sends the reports you paste. Anything the agent reads in the project goes too | Do not use the AI features |
| Crossref (`api.crossref.org`) | Add reference, check references | The DOI, title and first author of each entry | Do not use those two features |
| OpenAlex (`api.openalex.org`) | The same | The title | The same |
| arXiv (`export.arxiv.org`) | Add a reference by its arXiv identifier | The identifier | The same |
| LanguageTool online (`api.languagetool.org`) | Only if you choose the online server in Settings | The paragraphs of the text | The default is the local server, on your computer |
| Git remote (GitHub or another) | When the project opens (`fetch`), and on pull, push, Sync and clone | What Git normally sends | Use a project without a remote |
| TeX Live mirrors | TeX doctor, when finding and installing a package | Package names | Do not use the TeX doctor |
| LanguageTool (`languagetool.org`) | Only if you click *Download* on the advanced English checker (Settings → Checker) | The download request for the n-grams (9 GB). None of your text goes with it | Do not download |
| GitHub (`api.github.com`) | When the app opens, at most once a day, to see if there is a new version. Off in Preferences → General | The request, with your IP and the TeXugo version. No project data | Turn off "Tell me when there is a new version" |
| Homebrew | Installing LanguageTool with the button | What `brew` normally sends | Install it by hand |
| Google (Chromium dictionaries) | On Windows and Linux, the first time the system spell checker is used | The dictionary download request | Use it on a Mac, which uses the macOS dictionary |

Requests to Crossref, OpenAlex and arXiv send the header `User-Agent: TeXugo (LaTeX editor; https://github.com/FredieDidier/TeXugo)`. It identifies the app, not the person using it.

The AI actions use the Claude Code that **you** installed, signed in with **your** account. TeXugo has no key of its own and does not sit between you and Anthropic. What Anthropic does with what it receives follows the policy of your Claude account.

## What stays on your computer

- **`state.json`**, in the app's data folder: recent projects, settings, personal dictionary and the folders you said you trust.
- **The paper library**, also in the app's data folder: the PDFs and the text extracted from them.
- **The advanced checker's n-grams**, if you download them, and the **copies of unsaved tabs** (to recover your work if the app crashes), also in the app's data folder. The copies go when you save or discard.
- **`.texugo/`**, in each project. It stays out of Git and holds the live preview, difference PDFs, sent versions, generated referee reports, and the state of annotations and of the replication checklist.
- **`.git/texugo-visit.json`**: the mark of your last visit to the coauthors' news.
- **`~/.claude/ide/<port>.lock`**, only while a Claude Code is connected to the app.

## What travels with the project

- **`.texugo-comments/`**, in each project, **is committed**. That way coauthors see the comments in the text. Each comment carries the author's name (Git's `user.name`), the text and the date. **It carries no e-mail.** Older comments that still had an e-mail can be cleaned from the palette, with "Remove e-mails from comments".

## Other people's projects

A project can bring a `latexmkrc`, which latexmk runs when compiling, or a `.claude/` folder, with settings that Claude Code runs. The first time you open such a folder, or when one of these files arrives while the project is open, TeXugo asks whether you trust whoever made the project. Until you confirm, Claude Code runs only with your own settings, not the project's.
