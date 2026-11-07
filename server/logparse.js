// Parses a TeX .log into errors, warnings, bad boxes and the undefined
// references and citations that print as ?? in the PDF.
//
// The build sets max_print_line high, so messages and file paths are not
// wrapped. The file that a message belongs to is tracked with the usual
// heuristic: "(" followed by a path opens a file, ")" closes the last one.
import path from 'node:path';
import fs from 'node:fs';

const FILE_EXT = /\.(tex|sty|cls|clo|cfg|def|aux|bbl|fd|toc|lof|lot|out|nav|snm|ltx|ldf|dict|bib|ins|dtx|lua|mkii|vrb|tikz|pgf|code\.tex|w18)$/i;

export function parseLog(logText, docDir) {
  const lines = logText.split(/\r?\n/);
  const stack = [];
  const result = {
    errors: [],
    warnings: [],
    badboxes: [],
    undefinedRefs: [],
    undefinedCites: [],
    multiplyDefined: [],
    missingFiles: [],
    rerun: false,
    pages: null,
  };

  const currentTex = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i];
      if (f && /\.(tex|ltx)$/i.test(f)) return f;
    }
    return null;
  };
  const abs = (f) => (f ? path.resolve(docDir, f) : null);

  // Walk a line, updating the file stack. Returns nothing; side effects only.
  const trackFiles = (line) => {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '(') {
        const rest = line.slice(i + 1);
        const m = rest.match(/^"?([^\s()"]+)"?/);
        let name = null;
        if (m) {
          const cand = m[1];
          if (FILE_EXT.test(cand) || cand.startsWith('/') || cand.startsWith('./') || cand.startsWith('../')) {
            name = cand;
            i += m[0].length;
          }
        }
        stack.push(name);
      } else if (ch === ')') {
        if (stack.length) stack.pop();
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // -file-line-error style: ./sections/body.tex:53: Undefined control sequence.
    let m = line.match(/^(\.{0,2}\/?[^:\s][^:]*\.(?:tex|sty|cls|ltx|bbl|aux|def|cfg)):(\d+): (.*)$/);
    if (m) {
      const context = collectContext(lines, i + 1);
      result.errors.push({
        file: abs(m[1]),
        line: Number(m[2]),
        message: m[3].trim(),
        context: context.text,
        hint: hintFor(m[3], context.text),
      });
      const missing = m[3].match(/File `([^']+)' not found/);
      if (missing) result.missingFiles.push(missing[1]);
      i = context.end - 1;
      continue;
    }
    if (line.startsWith('! ')) {
      const context = collectContext(lines, i + 1);
      const lm = context.text.match(/^l\.(\d+)/m);
      result.errors.push({
        file: abs(currentTex()),
        line: lm ? Number(lm[1]) : null,
        message: line.slice(2).trim(),
        context: context.text,
        hint: hintFor(line, context.text),
      });
      const missing = line.match(/File `([^']+)' not found/);
      if (missing) result.missingFiles.push(missing[1]);
      i = context.end - 1;
      continue;
    }

    m = line.match(/^(LaTeX|Package (\S+)|Class (\S+)|pdfTeX) warning:?\s*(.*)$/i) || line.match(/^(LaTeX|Package (\S+)|Class (\S+)) Warning: (.*)$/);
    if (m && /warning/i.test(line)) {
      // Continuation lines are indented with "(pkg)" or spaces.
      let msg = m[4];
      let j = i + 1;
      while (j < lines.length && /^(\([^)]*\)\s+|\s{4,})\S/.test(lines[j]) && !/^\s*\(\.?\.?\//.test(lines[j])) {
        msg += ' ' + lines[j].replace(/^\([^)]*\)\s+/, '').trim();
        j++;
      }
      const pkg = m[2] || m[3] || (m[1].toLowerCase() === 'latex' ? null : m[1]);
      const lineNo = (msg.match(/on input line (\d+)/) || [])[1];
      const w = { file: abs(currentTex()), line: lineNo ? Number(lineNo) : null, message: msg.trim(), package: pkg };

      const ref = msg.match(/^Reference `([^']+)' on page (\d+) undefined/);
      const cite = msg.match(/^Citation `([^']+)' on page (\d+) undefined/);
      if (ref) result.undefinedRefs.push({ key: ref[1], page: Number(ref[2]), file: w.file, line: w.line });
      else if (cite) result.undefinedCites.push({ key: cite[1], page: Number(cite[2]), file: w.file, line: w.line });
      else if (/^Label `([^']+)' multiply defined/.test(msg)) result.multiplyDefined.push(msg.match(/`([^']+)'/)[1]);
      if (/Rerun to get|Label\(s\) may have changed|rerun LaTeX/i.test(msg)) result.rerun = true;
      if (!/^Font shape|Some font shapes were not available|^There were undefined/.test(msg)) result.warnings.push(w);
      for (let k = i; k < j; k++) trackFiles(lines[k]);
      i = j - 1;
      continue;
    }

    m = line.match(/^(Overfull|Underfull) \\([hv])box \((.*?)\) .*?(?:at lines? (\d+)(?:--(\d+))?)?$/);
    if (m) {
      const amount = m[3];
      result.badboxes.push({
        kind: m[1].toLowerCase(),
        box: m[2] + 'box',
        amount,
        file: abs(currentTex()),
        line: m[4] ? Number(m[4]) : null,
        message: `${m[1]} \\${m[2]}box (${amount})`,
      });
    }

    // biblatex reports missing keys differently.
    m = line.match(/^Package biblatex Warning: The following entry could not be found/);
    if (m && lines[i + 1]) {
      const key = lines[i + 1].match(/\(biblatex\)\s+'?([^'\s]+)'?/);
      if (key) result.undefinedCites.push({ key: key[1], page: null, file: null, line: null });
    }

    m = line.match(/^Output written on .*? \((\d+) pages?/);
    if (m) result.pages = Number(m[1]);

    trackFiles(line);
  }
  // Same key reported on several pages: keep one entry per key and location.
  result.undefinedRefs = dedupe(result.undefinedRefs);
  result.undefinedCites = dedupe(result.undefinedCites);
  return result;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((r) => {
    const k = `${r.key}|${r.file}|${r.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function collectContext(lines, start) {
  const out = [];
  let j = start;
  while (j < lines.length && out.length < 8) {
    const l = lines[j];
    if (l.trim() === '' && out.length) break;
    if (/^(\.{0,2}\/?[^:\s][^:]*\.tex):(\d+): /.test(l) || l.startsWith('! ')) break;
    out.push(l);
    j++;
  }
  return { text: out.join('\n').trim(), end: j };
}

// Plain-language hints for the errors people hit most.
function hintFor(message, context) {
  const msg = message + ' ' + context;
  if (/Undefined control sequence/.test(msg)) {
    const cs = (context.match(/\\[A-Za-z@]+(?=\s*$)/m) || context.match(/\\[A-Za-z@]+/) || [])[0];
    return `Comando desconhecido${cs ? ` (${cs})` : ''}: erro de digitação ou falta carregar o pacote que o define.`;
  }
  if (/File `([^']+)' not found/.test(msg)) {
    const f = msg.match(/File `([^']+)' not found/)[1];
    return /\.(sty|cls)$/.test(f)
      ? `O pacote ${f} não está instalado no TeX Live. Instale com: sudo tlmgr install ${f.replace(/\.(sty|cls)$/, '')}`
      : `Arquivo ${f} não encontrado. Confira o caminho (é relativo à pasta do documento raiz).`;
  }
  if (/Missing \$ inserted/.test(msg)) return 'Um símbolo de matemática (_, ^, \\alpha...) ficou fora de $...$, ou um $ não foi fechado.';
  if (/Extra alignment tab/.test(msg)) return 'Uma linha da tabela tem mais & do que colunas declaradas.';
  if (/Missing \\begin\{document\}/.test(msg)) return 'Texto ou comando antes de \\begin{document}, ou erro no preâmbulo.';
  if (/Environment (\S+) undefined/.test(msg)) return 'Ambiente desconhecido: falta carregar o pacote que o define.';
  if (/\\begin\{(\S+)\} on input line (\d+) ended by \\end\{(\S+)\}/.test(msg)) return 'Um \\begin{...} foi fechado com o \\end{...} errado.';
  if (/Runaway argument|Paragraph ended before/.test(msg)) return 'Uma chave { ficou sem fechar.';
  if (/Too many \}'s/.test(msg)) return 'Há uma chave } a mais.';
  if (/Unicode character/.test(msg)) return 'Caractere Unicode que o pdfLaTeX não conhece. Troque o caractere ou compile com XeLaTeX.';
  if (/Misplaced alignment tab character &/.test(msg)) return 'Um & fora de tabela. Para o símbolo, use \\&.';
  if (/Emergency stop/.test(msg)) return 'O LaTeX parou. O erro real costuma ser o anterior a este.';
  return null;
}

// Labels written to a document's .aux (following \@input for \include'd
// parts). These are what xr imports and what \ref resolves against.
export function auxLabels(auxFile, seen = new Set()) {
  const out = new Map();
  if (seen.has(auxFile)) return out;
  seen.add(auxFile);
  let text;
  try {
    text = fs.readFileSync(auxFile, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    let m = line.match(/^\\newlabel\{([^}]+)\}\{(.*)\}$/);
    if (m) {
      out.set(m[1], m[2]);
      continue;
    }
    m = line.match(/^\\@input\{([^}]+)\}/);
    if (m) for (const [k, v] of auxLabels(path.resolve(path.dirname(auxFile), m[1]), seen)) out.set(k, v);
  }
  return out;
}

// Stable fingerprint of what other documents can import from this one.
export function auxFingerprint(auxFile) {
  const labels = auxLabels(auxFile);
  let text = '';
  try {
    text = fs.readFileSync(auxFile, 'utf8');
  } catch {
    return 'missing';
  }
  const cites = text.split('\n').filter((l) => l.startsWith('\\bibcite')).join('\n');
  return [...labels.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n') + '\n' + cites;
}
