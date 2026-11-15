// Records the short videos of the site (docs/videos/<lang>/<scene>.mp4, with
// a .webp poster) from the real app. A demo project in a temporary folder,
// a profile of its own, scripted mouse and keyboard, frames captured with
// capturePage and encoded to H.264 by Chromium's MediaRecorder, so nothing
// beyond Electron and cwebp is needed.
//
//   npm run site:videos -- pt             (every scene, in Portuguese)
//   npm run site:videos -- en compilar    (one scene, in English)
//
// The window appears on screen while it records; the page is told it has
// the focus, so the caret and selections show even when another app is in
// front.
import { app, BrowserWindow } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.mjs'));
const LANG = args[0] === 'en' ? 'en' : 'pt';
const ONLY = args.slice(1);
const OUT = path.join(REPO, 'docs', 'videos', LANG);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-site-'));
const PROJ = path.join(TMP, LANG === 'en' ? 'bike-lanes' : 'ciclovias');
const KEEP_TMP = !!process.env.TEXUGO_KEEP_TMP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- demo text
const T = {
  pt: {
    title: 'Ciclovias e tempo de viagem',
    babel: 'brazilian',
    abstract: 'Medimos quanto tempo as ciclovias novas poupam a quem vai trabalhar de bicicleta.',
    intro: [
      '\\section{Introdução}\\label{sec:intro}',
      'Entre 2016 e 2022, a cidade abriu 60 km de ciclovias. Comparamos os bairros que ganharam uma ciclovia com os vizinhos que ainda esperavam a sua, como em \\citet{card1994minimum}.',
      '',
      'O tempo médio de viagem caiu quatro minutos (Tabela~\\ref{tab:principal}). A Tabela~\\ref{tab:robusta} do apêndice repete a conta sem os anos da pandemia.',
      '',
    ],
    results: ['\\section{Resultados}\\label{sec:resultados}', '\\begin{table}[h]', '  \\centering', '  \\caption{Tempo de viagem}\\label{tab:principal}', '  \\begin{tabular}{lc}', '    \\toprule', '    & Minutos por viagem \\\\', '    \\midrule', '    Ciclovia $\\times$ depois & $-4{,}2$ \\\\', '                            & $(1{,}1)$ \\\\', '    \\bottomrule', '  \\end{tabular}', '\\end{table}', ''],
    appendix: { data: 'Dados', robust: 'Sem 2020 e 2021', col: 'Minutos', row: 'Ciclovia $\\times$ depois', main: 'O resultado principal está na Tabela~\\ref{tab:principal} do artigo.', title: 'Apêndice online' },
    live: ' Em média, a viagem ficou quatro minutos mais curta.',
    eqIntro: 'Estimamos',
    missingRef: ' A Figura~\\ref{fig:mapa} mostra as ciclovias.',
    tics: 'Vale ressaltar que os ciclistas chega mais cedo ao trabalho.',
    wordy: 'De modo geral, os resultados obtidos neste estudo parecem indicar, em grande medida, que as ciclovias novas contribuíram de forma bastante significativa para reduzir o tempo que as pessoas gastam no trajeto até o trabalho.',
    revisions: [
      ['Comparamos os bairros', 'Comparamos 38 bairros'],
      ['O tempo médio de viagem caiu quatro minutos', 'O tempo médio de viagem caiu 4,2 minutos'],
      [' A Tabela~\\ref{tab:robusta} do apêndice repete a conta sem os anos da pandemia.', ''],
    ],
    doi: '10.1257/aer.91.4.795',
  },
  en: {
    title: 'Bike Lanes and Commuting Time',
    babel: 'english',
    abstract: 'We measure how much time new bike lanes save people who cycle to work.',
    intro: [
      '\\section{Introduction}\\label{sec:intro}',
      'Between 2016 and 2022, the city opened 60 km of bike lanes. We compare neighborhoods that got a bike lane with nearby ones still waiting for theirs, as in \\citet{card1994minimum}.',
      '',
      'The average trip became four minutes shorter (Table~\\ref{tab:main}). Table~\\ref{tab:robust} in the appendix repeats the estimate without the pandemic years.',
      '',
    ],
    results: ['\\section{Results}\\label{sec:results}', '\\begin{table}[h]', '  \\centering', '  \\caption{Commuting time}\\label{tab:main}', '  \\begin{tabular}{lc}', '    \\toprule', '    & Minutes per trip \\\\', '    \\midrule', '    Bike lane $\\times$ after & $-4.2$ \\\\', '                              & $(1.1)$ \\\\', '    \\bottomrule', '  \\end{tabular}', '\\end{table}', ''],
    appendix: { data: 'Data', robust: 'Without 2020 and 2021', col: 'Minutes', row: 'Bike lane $\\times$ after', main: 'The main estimate is in Table~\\ref{tab:main} of the paper.', title: 'Online Appendix' },
    live: ' On average, the trip became four minutes shorter.',
    eqIntro: 'We estimate',
    missingRef: ' Figure~\\ref{fig:map} shows the bike lanes.',
    tics: 'It is worth noting that cyclists now save a hour every week.',
    wordy: 'Generally speaking, the results obtained in this study appear to indicate, to a large extent, that the new bike lanes contributed in a rather significant way to reducing the amount of time that people spend on their way to work.',
    revisions: [
      ['We compare neighborhoods', 'We compare 38 neighborhoods'],
      ['The average trip became four minutes shorter', 'The average trip became 4.2 minutes shorter'],
      [' Table~\\ref{tab:robust} in the appendix repeats the estimate without the pandemic years.', ''],
    ],
    doi: '10.1257/aer.91.4.795',
  },
}[LANG];
const robustLabel = LANG === 'en' ? 'tab:robust' : 'tab:robusta';
const mainLabel = LANG === 'en' ? 'tab:main' : 'tab:principal';
const introFile = LANG === 'en' ? 'introduction.tex' : 'introducao.tex';
const resultsFile = LANG === 'en' ? 'results.tex' : 'resultados.tex';

function writeProject(dir) {
  const w = (rel, text) => (fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }), fs.writeFileSync(path.join(dir, rel), text));
  w('preamble.tex', [
    '% Shared preamble of paper.tex and appendix.tex.',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[utf8]{inputenc}',
    `\\usepackage[${T.babel}]{babel}`,
    '\\usepackage{lmodern}',
    '\\usepackage[a5paper,margin=1.4cm]{geometry}',
    '\\usepackage{amsmath}',
    '\\usepackage{booktabs}',
    '\\usepackage[authoryear,round]{natbib}',
    '\\usepackage{xr-hyper}',
    '\\usepackage[hidelinks]{hyperref}',
    '',
  ].join('\n'));
  w('paper.tex', [
    '% !TEX program = pdflatex',
    '\\documentclass[11pt]{article}',
    '\\input{preamble}',
    '\\externaldocument{appendix}',
    '',
    '\\begin{document}',
    `\\title{${T.title}}`,
    '\\author{Ana Exemplo}',
    '\\date{}',
    '\\maketitle',
    '',
    '\\begin{abstract}',
    `\\noindent ${T.abstract}`,
    '\\end{abstract}',
    '',
    `\\input{sections/${introFile.replace('.tex', '')}}`,
    `\\input{sections/${resultsFile.replace('.tex', '')}}`,
    '',
    '\\bibliographystyle{aer}',
    '\\bibliography{references}',
    '\\end{document}',
    '',
  ].join('\n'));
  w(`sections/${introFile}`, T.intro.join('\n'));
  w(`sections/${resultsFile}`, T.results.join('\n'));
  w('appendix.tex', [
    '% !TEX program = pdflatex',
    '\\documentclass[11pt]{article}',
    '\\input{preamble}',
    '\\externaldocument{paper}',
    '\\renewcommand{\\thetable}{A\\arabic{table}}',
    '',
    '\\begin{document}',
    `\\section*{${T.appendix.title}}`,
    `\\section{${T.appendix.data}}\\label{app:data}`,
    T.appendix.main,
    '',
    '\\begin{table}[h]',
    '  \\centering',
    `  \\caption{${T.appendix.robust}}\\label{${robustLabel}}`,
    '  \\begin{tabular}{lc}',
    '    \\toprule',
    `    & ${T.appendix.col} \\\\`,
    '    \\midrule',
    `    ${T.appendix.row} & $${LANG === 'en' ? '-3.9' : '-3{,}9'}$ \\\\`,
    `     & $(${LANG === 'en' ? '1.3' : '1{,}3'})$ \\\\`,
    '    \\bottomrule',
    '  \\end{tabular}',
    '\\end{table}',
    '\\end{document}',
    '',
  ].join('\n'));
  fs.copyFileSync(path.join(REPO, 'server', 'templates', 'artigo-apendice', 'references.bib'), path.join(dir, 'references.bib'));
}
writeProject(PROJ);
// A PDF made the usual way, paper.tex alone and once: every cross-reference
// to the appendix comes out as ??. The first scene starts from it.
try {
  execFileSync('pdflatex', ['-interaction=nonstopmode', 'paper.tex'], { cwd: PROJ, stdio: 'pipe' });
} catch {}
for (const f of fs.readdirSync(PROJ)) if (/\.(aux|log|out|synctex\.gz)$/.test(f)) fs.rmSync(path.join(PROJ, f));
const git = (...a) => execFileSync('git', a, { cwd: PROJ, stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('-c', 'user.name=Ana Exemplo', '-c', 'user.email=ana@example.org', 'add', '-A');
git('-c', 'user.name=Ana Exemplo', '-c', 'user.email=ana@example.org', 'commit', '-q', '-m', LANG === 'en' ? 'First draft' : 'Primeira versão');

// The revised introduction, compared with the first commit in the last scene.
const revisedIntro = T.revisions.reduce((text, [a, b]) => text.replace(a, b), T.intro.join('\n'));

// ------------------------------------------------------------------ the app
fs.mkdirSync(path.join(TMP, 'profile'));
// LanguageTool takes a while to start and holds memory: on only when the
// grammar scene is recorded.
const grammar = !ONLY.length || ONLY.includes('escrita');
fs.writeFileSync(path.join(TMP, 'profile', 'state.json'), JSON.stringify({ settings: { grammar, lang: LANG, theme: 'light', reopenLast: false, onboarded: true }, recents: [] }));
app.setPath('userData', path.join(TMP, 'profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
process.argv.push(PROJ);
await import(pathToFileURL(path.join(REPO, 'electron/main.js')).href);

// ----------------------------------------------------------------- recorder
// Frames: capturePage of the crop rectangle about 30 times a second, kept
// only when the picture changed. Cursor: the pointer the script moves, drawn
// afterwards over the frames. Speed: stretches where the screen only waits.
class Recorder {
  constructor(wc) {
    this.wc = wc;
    this.cursor = { x: 700, y: 400 };
  }
  async start(name, crop, { out = 1600 } = {}) {
    this.name = name;
    this.crop = { x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(crop.width), height: Math.round(crop.height) };
    this.out = out;
    this.dir = fs.mkdtempSync(path.join(TMP, 'frames-'));
    this.frames = [];
    this.track = [{ t: 0, x: this.cursor.x, y: this.cursor.y }];
    this.speeds = [{ t: 0, f: 1 }];
    this.t0 = now();
    this.running = true;
    this.loop = (async () => {
      let last = '';
      let n = 0;
      while (this.running) {
        const t = now() - this.t0;
        const img = await this.wc.capturePage(this.crop);
        const jpg = img.toJPEG(94);
        const hash = crypto.createHash('md5').update(jpg).digest('hex');
        if (hash !== last) {
          const f = path.join(this.dir, `${String(n++).padStart(5, '0')}.jpg`);
          fs.writeFileSync(f, jpg);
          this.frames.push({ t, f });
          last = hash;
        }
        await sleep(Math.max(0, 33 - (now() - this.t0 - t)));
      }
    })();
    await sleep(60);
  }
  t() {
    return now() - this.t0;
  }
  speed(f) {
    if (this.running) this.speeds.push({ t: this.t(), f });
  }
  point(p) {
    this.cursor = { x: p.x, y: p.y };
    if (this.running) this.track.push({ t: this.t(), ...p });
  }
  async stop(holdMs = 1800) {
    await sleep(holdMs);
    this.running = false;
    await this.loop;
    const end = this.t();
    // Real time -> video time, piecewise linear.
    const toVideo = (t) => {
      let v = 0;
      for (let i = 0; i < this.speeds.length; i++) {
        const a = this.speeds[i].t;
        const b = i + 1 < this.speeds.length ? this.speeds[i + 1].t : Infinity;
        if (t <= a) break;
        v += (Math.min(t, b) - a) / this.speeds[i].f;
      }
      return v;
    };
    const spec = {
      frames: this.frames.map((f) => ({ v: toVideo(f.t), url: pathToFileURL(f.f).href })),
      track: this.track.map((p) => ({ ...p, v: toVideo(p.t), x: p.x - this.crop.x, y: p.y - this.crop.y })),
      duration: toVideo(end),
      crop: this.crop,
      out: this.out,
    };
    await encode(spec, path.join(OUT, this.name));
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

// Plays the frames back in real time on a canvas, with the pointer drawn
// over them, and records the canvas.
async function encode(spec, base) {
  const w = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { webSecurity: false, backgroundThrottling: false, offscreen: false } });
  const page = path.join(TMP, 'encoder.html');
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><canvas id="c"></canvas>');
  await w.loadFile(page);
  const result = await w.webContents.executeJavaScript(`(${encoderMain.toString()})(${JSON.stringify(spec)})`, true);
  w.destroy();
  fs.writeFileSync(base + '.mp4', Buffer.from(result.video, 'base64'));
  const jpg = base + '.poster.jpg';
  fs.writeFileSync(jpg, Buffer.from(result.poster, 'base64'));
  execFileSync('cwebp', ['-quiet', '-q', '82', jpg, '-o', base + '.webp']);
  fs.rmSync(jpg);
  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  console.log(`${path.relative(REPO, base)}.mp4  ${result.width}x${result.height}  ${(spec.duration / 1000).toFixed(1)} s  ${kb(base + '.mp4')} KB  (${spec.frames.length} frames; poster ${kb(base + '.webp')} KB)`);
}

// Runs inside the encoder page.
async function encoderMain(spec) {
  const scale = Math.min(1, spec.out / (spec.crop.width * 2));
  const W = Math.round((spec.crop.width * 2 * scale) / 2) * 2;
  const H = Math.round((spec.crop.height * 2 * scale) / 2) * 2;
  const k = W / spec.crop.width; // window px -> output px
  const c = document.getElementById('c');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const load = (url) => fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b));
  const cache = new Map();
  const get = (i) => {
    if (!cache.has(i)) cache.set(i, load(spec.frames[i].url));
    return cache.get(i);
  };
  // Pointer: macOS-like arrow, tip at (0, 0), in window px.
  const arrow = new Path2D('M0 0 L0 16.5 L4.1 12.6 L6.9 19 L9.6 17.8 L6.9 11.6 L12.4 11.6 Z');
  const cursorAt = (v) => {
    const tr = spec.track;
    let i = 0;
    while (i + 1 < tr.length && tr[i + 1].v <= v) i++;
    const a = tr[i];
    const b = tr[i + 1];
    if (!b || b.v === a.v) return { x: a.x, y: a.y };
    const s = Math.max(0, Math.min(1, (v - a.v) / (b.v - a.v)));
    return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
  };
  const clicks = spec.track.filter((p) => p.click).map((p) => p.v);
  const hidden = (v) => {
    let h = false;
    for (const p of spec.track) if (p.v <= v && 'hide' in p) h = p.hide;
    return h;
  };
  const draw = (bmp, v) => {
    g.drawImage(bmp, 0, 0, W, H);
    for (const cv of clicks) {
      const d = v - cv;
      if (d >= 0 && d < 450) {
        const p = cursorAt(cv);
        const s = d / 450;
        g.beginPath();
        g.arc(p.x * k, p.y * k, (6 + 16 * s) * k, 0, Math.PI * 2);
        g.fillStyle = `rgba(217, 138, 28, ${0.35 * (1 - s)})`;
        g.fill();
      }
    }
    if (hidden(v)) return;
    const p = cursorAt(v);
    g.save();
    g.translate(p.x * k, p.y * k);
    g.scale(k * 1.15, k * 1.15);
    g.lineJoin = 'round';
    g.lineWidth = 1.4;
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#111111';
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 1;
    g.stroke(arrow);
    g.shadowColor = 'transparent';
    g.fill(arrow);
    g.restore();
  };
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=avc1.640028', videoBitsPerSecond: 5_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const fps = 30;
  let fi = 0;
  let bmp = await get(0);
  get(1);
  draw(bmp, 0);
  rec.start();
  const t0 = performance.now();
  for (let n = 0; ; n++) {
    const v = (n * 1000) / fps;
    if (v > spec.duration) break;
    while (fi + 1 < spec.frames.length && spec.frames[fi + 1].v <= v) {
      fi++;
      cache.delete(fi - 2);
      bmp = await get(fi);
      if (fi + 1 < spec.frames.length) get(fi + 1);
    }
    draw(bmp, v);
    track.requestFrame();
    const wait = t0 + v - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  rec.stop();
  await new Promise((r) => (rec.onstop = r));
  const video = await new Blob(chunks).arrayBuffer();
  // Poster: the last frame, without the pointer.
  g.drawImage(bmp, 0, 0, W, H);
  const poster = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)).then((b) => b.arrayBuffer());
  const b64 = (buf) => {
    let s = '';
    const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return { video: b64(video), poster: b64(poster), width: W, height: H };
}

// ------------------------------------------------------------------ driving
app.whenReady().then(async () => {
  let code = 0;
  try {
    await sleep(1500);
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1440, 840);
    win.center();
    const wc = win.webContents;
    wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const js = (body) => wc.executeJavaScript(`(async () => { ${body} })()`, true);
    const until = async (body, ms = 20000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(120)) if (await js(body).catch(() => false)) return true;
      throw new Error('timed out waiting for: ' + body.slice(0, 140));
    };
    const rec = new Recorder(wc);
    const rect = (sel) => js(`const e = ${sel.startsWith('(') ? sel : `document.querySelector(${JSON.stringify(sel)})`}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };`);
    const center = async (sel) => {
      const r = await rect(sel);
      if (!r) throw new Error('not found: ' + sel);
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const ease = (s) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2);
    const moveTo = async (p, ms) => {
      const a = { ...rec.cursor };
      const dist = Math.hypot(p.x - a.x, p.y - a.y);
      ms = ms ?? Math.min(900, 300 + dist * 0.7);
      const steps = Math.max(1, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const s = ease(i / steps);
        const q = { x: a.x + (p.x - a.x) * s, y: a.y + (p.y - a.y) * s };
        wc.sendInputEvent({ type: 'mouseMove', x: Math.round(q.x), y: Math.round(q.y) });
        rec.point(q);
        await sleep(16);
      }
    };
    const click = async (target, { right = false, pause = 160 } = {}) => {
      const p = typeof target === 'string' ? await center(target) : target;
      await moveTo(p);
      await sleep(pause);
      rec.point({ ...p, click: true });
      const button = right ? 'right' : 'left';
      wc.sendInputEvent({ type: 'mouseDown', x: Math.round(p.x), y: Math.round(p.y), button, clickCount: 1 });
      await sleep(70);
      wc.sendInputEvent({ type: 'mouseUp', x: Math.round(p.x), y: Math.round(p.y), button, clickCount: 1 });
      await sleep(200);
    };
    const key = async (keyCode, modifiers = []) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      if (keyCode.length === 1 && !modifiers.length) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await sleep(90);
    };
    const type = async (text, cps = 22) => {
      for (const ch of text) {
        if (ch === '\n') await key('Enter');
        else await wc.insertText(ch);
        await sleep(1000 / cps + (Math.random() - 0.5) * 18);
      }
    };
    const openFile = async (rel) => {
      await key('p', ['meta']);
      await sleep(150);
      await wc.insertText(rel);
      await sleep(350);
      await key('Enter');
      await until(`return document.querySelector('.tab.active .label')?.textContent === ${JSON.stringify(path.basename(rel))};`, 6000);
      await sleep(400);
    };
    const VIEW = `document.querySelector('.editor-host .cm-content').cmTile.root.view`;
    // Puts the CodeMirror cursor right after `needle` in the active editor.
    const caretAfter = (needle) => js(`const v = ${VIEW}; const i = v.state.doc.toString().indexOf(${JSON.stringify(needle)}); if (i < 0) return false; v.dispatch({ selection: { anchor: i + ${needle.length} }, scrollIntoView: true }); v.focus(); return true;`);
    // Screen rectangle of a piece of text in the active editor.
    const textRect = (needle, len) => js(`const v = ${VIEW}; const i = v.state.doc.toString().indexOf(${JSON.stringify(needle)}); if (i < 0) return null; const a = v.coordsAtPos(i), b = v.coordsAtPos(i + ${len ?? needle.length}); return { x: a.left, y: a.top, x2: b.right, y2: b.bottom };`);
    // Replaces the text of the active editor and saves it.
    const setDoc = async (text) => {
      await js(`const v = ${VIEW}; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(text)} } }); v.focus(); return true;`);
      await key('s', ['meta']);
      await until(`return !document.querySelector('.tab.active.dirty');`, 5000);
    };
    const docText = () => js(`return ${VIEW}.state.doc.toString();`);
    // The compile button is disabled while its document builds.
    const waitBuild = async (ms = 120000) => {
      await until(`return document.querySelector('.doc-bar .btn.primary')?.disabled;`, 4000).catch(() => {});
      await until(`const b = document.querySelector('.doc-bar .btn.primary'); return b && !b.disabled;`, ms);
      await sleep(300);
    };
    const closeBottom = async () => {
      await js(`const x = [...document.querySelectorAll('.bottom .icon-btn')].find((b) => /Fechar painel|Close panel/.test(b.title)); if (x && x.offsetParent) x.click(); return true;`);
      await sleep(500);
    };
    const byText = (scope, re) => `([...document.querySelectorAll(${JSON.stringify(scope)})].find((e) => ${re}.test(e.innerText.trim())))`;
    // End of a piece of text in the editor, as a point to click.
    const endOf = async (needle) => {
      const r = await textRect(needle);
      if (!r) throw new Error('text not in the editor: ' + needle);
      return { x: r.x2 + 1, y: (r.y + r.y2) / 2 };
    };
    const hoverText = async (needle, frac = 0.5) => {
      const r = await textRect(needle);
      if (!r) throw new Error('text not in the editor: ' + needle);
      await moveTo({ x: r.x + (r.x2 - r.x) * frac, y: (r.y + r.y2) / 2 });
    };
    const region = async (sels, pad = 0) => {
      const rs = (await Promise.all(sels.map(rect))).filter(Boolean);
      const x = Math.max(0, Math.min(...rs.map((r) => r.x)) - pad);
      const y = Math.max(0, Math.min(...rs.map((r) => r.y)) - pad);
      const x2 = Math.min(1440, Math.max(...rs.map((r) => r.x + r.width)) + pad);
      const y2 = Math.min(840, Math.max(...rs.map((r) => r.y + r.height)) + pad);
      return { x, y, width: x2 - x, height: y2 - y };
    };

    await until(`return !!document.querySelector('.tab.active');`, 20000);
    await sleep(1200);
    if (!(await js(`return !!${VIEW};`))) throw new Error('cannot reach the CodeMirror view');
    const introRel = `sections/${introFile}`;
    const introText = fs.readFileSync(path.join(PROJ, introRel), 'utf8');
    const bibText = fs.readFileSync(path.join(PROJ, 'references.bib'), 'utf8');
    const lastSentence = T.intro[3].slice(-30);
    const scenes = { compilar, 'ao-vivo': aoVivo, problemas, escrita, ia, comparar, referencia };
    for (const name of Object.keys(scenes)) if (!ONLY.length || ONLY.includes(name)) await scenes[name]();

    // 1. Compile: the PDF made the usual way has ??; TeXugo builds paper and
    // appendix in the right order and the ?? become numbers.
    async function compilar() {
      await openFile(introRel);
      await until(`return !!document.querySelector('.pdf-view:not(.hidden) .page canvas');`, 15000);
      await sleep(1500);
      rec.cursor = { x: 760, y: 640 };
      await rec.start('compilar', { x: 0, y: 0, width: 1440, height: 840 }, { out: 1920 });
      await sleep(1800);
      await click('.doc-bar .btn.primary');
      rec.speed(2.5);
      await waitBuild();
      rec.speed(1);
      await sleep(900);
      const chip = await rect('.doc-bar .chip.ok');
      if (chip) await moveTo({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 });
      await rec.stop(2800);
    }

    // 2. Live preview: the PDF follows the typing, and an equation is drawn
    // above the cursor while it is typed.
    async function aoVivo() {
      await openFile(introRel);
      await closeBottom();
      const crop = await region(['.editor-group', '.pdf-group']);
      rec.cursor = { x: crop.x + crop.width * 0.35, y: crop.y + crop.height * 0.75 };
      await rec.start('ao-vivo', crop);
      await sleep(900);
      await click('.doc-bar .live-toggle .sw');
      await sleep(600);
      await click(await endOf(lastSentence));
      await caretAfter(lastSentence);
      await type(T.live, 18);
      rec.speed(2);
      await sleep(2600);
      rec.speed(1);
      await sleep(600);
      await key('Enter');
      await key('Enter');
      await type(`${T.eqIntro}\n\\[ \\Delta t_i = \\beta \\, C_i + \\varepsilon_i`, 14);
      await sleep(900);
      const doc = await docText();
      if (!/\\\]/.test(doc.slice(doc.indexOf(T.eqIntro)))) await type(' \\]', 14);
      await key('Escape');
      rec.speed(2);
      await sleep(3000);
      rec.speed(1);
      await moveTo({ x: crop.x + crop.width * 0.78, y: crop.y + crop.height * 0.62 });
      await rec.stop(2400);
      await js(`const i = document.querySelector('.doc-bar .live-toggle input'); if (i && i.checked) i.click(); return true;`);
      await setDoc(introText);
    }

    // 3. A ?? that comes with its reason, and a click that goes to the line.
    async function problemas() {
      await openFile(introRel);
      await closeBottom();
      const ed = await rect('.editor-group');
      const crop = { x: ed.x, y: ed.y, width: 1440 - ed.x, height: 812 - ed.y };
      rec.cursor = { x: ed.x + ed.width * 0.5, y: ed.y + 480 };
      await rec.start('problemas', crop);
      await sleep(900);
      await click(await endOf(lastSentence));
      await caretAfter(lastSentence);
      await type(T.missingRef, 18);
      await key('Escape');
      await sleep(500);
      await click('.doc-bar .btn.primary');
      rec.speed(2.5);
      await waitBuild();
      rec.speed(1);
      await sleep(700);
      await click('.doc-bar .chip.undefined');
      await sleep(900);
      const row = await rect(`(document.querySelector('.bottom .prob.warning, .bottom .prob'))`);
      if (row) await click({ x: row.x + Math.min(260, row.width / 2), y: row.y + row.height / 2 });
      await rec.stop(2800);
      await setDoc(introText);
      await click('.doc-bar .btn.primary');
      await waitBuild();
    }

    // 4. The grammar checker and the writing-tic detector, on hover.
    async function escrita() {
      await openFile(introRel);
      await closeBottom();
      await setDoc(introText + '\n' + T.tics + '\n');
      await until(`const l = [...document.querySelectorAll('.cm-line')].find((x) => x.innerText.includes(${JSON.stringify(T.tics.slice(0, 20))})); return !!(l && l.querySelector('.cm-vicio') && l.querySelector('.cm-grammar, .cm-spell'));`, 90000);
      await sleep(800);
      const ed = await rect('.editor-group');
      const crop = { x: ed.x, y: ed.y, width: Math.min(1440 - ed.x, 800), height: 440 };
      rec.cursor = { x: ed.x + ed.width * 0.6, y: ed.y + 400 };
      await rec.start('escrita', crop);
      await sleep(900);
      // The marks on the sentence added for this scene, not elsewhere.
      const mark = (sel) => `([...document.querySelectorAll('.cm-line')].find((x) => x.innerText.includes(${JSON.stringify(T.tics.slice(0, 20))})).querySelector(${JSON.stringify(sel)}))`;
      const hoverMark = async (sel, frac) => {
        const r = await rect(mark(sel));
        await moveTo({ x: r.x + r.width * frac, y: r.y + r.height / 2 });
      };
      await hoverMark('.cm-vicio', 0.4);
      // A hover that lands while the editor is busy can be missed: nudge.
      for (let i = 0; i < 3 && !(await until(`return !!document.querySelector('.vicio-tip:not(.grammar-tip)');`, 1500).catch(() => false)); i++) await moveTo({ x: rec.cursor.x + 3, y: rec.cursor.y }, 80);
      await sleep(2400);
      await hoverMark('.cm-grammar, .cm-spell', 0.5);
      for (let i = 0; i < 3 && !(await until(`return !!document.querySelector('.grammar-tip .grammar-fixes .btn');`, 1500).catch(() => false)); i++) await moveTo({ x: rec.cursor.x + 3, y: rec.cursor.y }, 80);
      await sleep(1300);
      await click(`.grammar-tip .grammar-fixes .btn`);
      await sleep(600);
      await moveTo({ x: ed.x + ed.width * 0.62, y: ed.y + 380 });
      await rec.stop(2000);
      await setDoc(introText);
    }

    // 4b. An AI action on a selection: the user's own agent shortens the
    // passage, and the change is accepted from a word diff.
    async function ia() {
      await openFile(introRel);
      await closeBottom();
      await setDoc(introText + '\n' + T.wordy + '\n');
      await js(`const b = [...document.querySelectorAll('.activitybar > *')].find((e) => /^(Arquivos|Files)/.test(e.title || '')); if (b.getAttribute('aria-pressed') !== 'true') b.click(); return true;`);
      await sleep(500);
      const ed = await rect('.editor-group');
      const crop = { x: 44, y: ed.y, width: 1146, height: 620 };
      rec.cursor = { x: ed.x + ed.width * 0.5, y: ed.y + 480 };
      await rec.start('ia', crop);
      await sleep(800);
      const a = await textRect(T.wordy.slice(0, 12));
      const b = await endOf(T.wordy.slice(-20));
      await moveTo({ x: a.x + 1, y: (a.y + a.y2) / 2 });
      wc.sendInputEvent({ type: 'mouseDown', x: Math.round(a.x + 1), y: Math.round((a.y + a.y2) / 2), button: 'left', clickCount: 1 });
      await moveTo(b, 900);
      wc.sendInputEvent({ type: 'mouseUp', x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1 });
      await js(`const v = ${VIEW}; const d = v.state.doc.toString(); const i = d.indexOf(${JSON.stringify(T.wordy)}); v.dispatch({ selection: { anchor: i, head: i + ${T.wordy.length} } }); return true;`);
      await sleep(600);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      await click(mid, { right: true });
      await until(`return !!document.querySelector('.menu .mi');`, 3000);
      await sleep(700);
      await click(byText('.menu .mi', '/^(Encurtar|Shorten)/'));
      rec.speed(8);
      await until(`return !!document.querySelector('.ai-diff');`, 180000);
      rec.speed(1);
      await sleep(3500);
      await click(byText('.modal button', '/^(Aceitar|Accept)$/'));
      await sleep(600);
      await moveTo({ x: ed.x + ed.width * 0.55, y: ed.y + 500 });
      await rec.stop(2600);
      await setDoc(introText);
    }

    // 5. A reference from its DOI, added to the .bib and cited at the cursor.
    async function referencia() {
      await openFile(introRel);
      await closeBottom();
      await js(`const b = [...document.querySelectorAll('.activitybar > *')].find((e) => /^(Arquivos|Files)/.test(e.title || '')); if (b.getAttribute('aria-pressed') !== 'true') b.click(); return true;`);
      await sleep(400);
      const ed = await rect('.editor-group');
      const crop = { x: 44, y: ed.y, width: 1146, height: 620 };
      const first = T.intro[1].slice(-25);
      rec.cursor = { x: ed.x + ed.width * 0.5, y: ed.y + 420 };
      await rec.start('referencia', crop);
      await sleep(800);
      await click(await endOf(first));
      await caretAfter(first);
      await type(LANG === 'en' ? ' The same design appears in ' : ' O mesmo desenho aparece em ', 18);
      await sleep(300);
      await key('r', ['alt', 'meta']);
      await until(`return !!document.querySelector('.modal .ref-results');`, 5000);
      await sleep(700);
      await type(T.doi, 30);
      await sleep(300);
      await key('Enter');
      rec.speed(2);
      await until(`return !!document.querySelector('.modal .ref-item .btn.primary');`, 30000);
      rec.speed(1);
      await sleep(1400);
      await click('.modal .ref-item .btn.primary');
      await until(`return !document.querySelector('.modal');`, 5000);
      await type('.', 10);
      await sleep(1500);
      const key0 = (await docText()).match(/\\cite[tp]?\{(duflo[^}]*)\}/);
      await sleep(600);
      if (key0) await hoverText(key0[1], 0.5);
      await sleep(3200);
      await rec.stop(400);
      await setDoc(introText);
      fs.writeFileSync(path.join(PROJ, 'references.bib'), bibText);
    }

    // 6. What changed since the first version, as a PDF with the changes
    // marked (latexdiff against a Git commit).
    async function comparar() {
      await openFile(introRel);
      await closeBottom();
      await setDoc(revisedIntro);
      rec.cursor = { x: 700, y: 520 };
      await rec.start('comparar', { x: 0, y: 0, width: 1440, height: 840 }, { out: 1920 });
      await sleep(900);
      await click(`([...document.querySelectorAll('.activitybar > *')].find((e) => /^(Revisão|Review)/.test(e.title || '')))`);
      await sleep(900);
      await click(byText('.sidebar button', '/^(Comparar…|Compare…)$/'));
      await until(`return !!document.querySelector('.modal');`, 4000);
      await sleep(700);
      await click(`.modal button[data-k="git"]`);
      await until(`return !!document.querySelector('.modal select option[value]:not([value=""])');`, 5000);
      await sleep(1100);
      await click(byText('.modal button', '/(Gerar PDF com mudanças|Build PDF with changes|PDF with changes)/'));
      rec.speed(6);
      await until(`return /(PDF com as mudanças marcadas|PDF with the changes marked)/.test(document.querySelector('.modal-title')?.innerText || '');`, 120000);
      rec.speed(1);
      await sleep(2600);
      await key('Escape');
      await sleep(800);
      const pdf = await rect('.pdf-group');
      await moveTo({ x: pdf.x + pdf.width * 0.5, y: pdf.y + pdf.height * 0.8 });
      await rec.stop(3000);
      await setDoc(introText);
    }
  } catch (err) {
    console.error('FAIL', err);
    code = 1;
  }
  if (!KEEP_TMP) fs.rmSync(TMP, { recursive: true, force: true });
  else console.log('kept', TMP);
  app.exit(code);
});
