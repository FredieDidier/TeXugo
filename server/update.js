// Item 6 of PRE-LAUNCH-AUDIT.md, in its free form: no Apple or Microsoft
// signing, so nothing is installed by the app. It asks GitHub Releases for
// the latest published version and, when it is newer, the page offers a
// link to the installer for this system. The person downloads and installs
// it like the first time. What goes out: the request to api.github.com
// (IP and the User-Agent with the version). Preferences → Geral turns it off.

const DEFAULT_URL = 'https://api.github.com/repos/FredieDidier/TeXugo/releases/latest';
const DAY = 24 * 60 * 60 * 1000;

// "v0.10.2" → [0, 10, 2]; anything after "-" (pre-release) makes it older
// than the plain version, which is all a release check needs.
export function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(-.+)?$/);
  if (!m) return null;
  return { n: [+m[1], +(m[2] || 0), +(m[3] || 0)], pre: !!m[4] };
}

export function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i];
  return !a.pre && b.pre;
}

// The installer that fits this machine, or null (the page then opens the
// release itself, which lists every file).
export function pickAsset(assets, platform = process.platform, arch = process.arch) {
  const list = (assets || []).filter((a) => a && a.name && a.browser_download_url);
  const ext = platform === 'darwin' ? /\.dmg$/i : platform === 'win32' ? /\.exe$/i : /\.AppImage$/i;
  const fit = list.filter((a) => ext.test(a.name));
  if (!fit.length) return null;
  const other = arch === 'arm64' ? /x64|x86_64|amd64|intel/i : /arm64|aarch64/i;
  const own = arch === 'arm64' ? /arm64|aarch64/i : /x64|x86_64|amd64/i;
  const pick = fit.find((a) => own.test(a.name)) || fit.find((a) => /universal/i.test(a.name)) || fit.find((a) => !other.test(a.name));
  return pick ? { name: pick.name, url: pick.browser_download_url, size: pick.size || 0 } : null;
}

export class UpdateChecker {
  constructor({ current, url = process.env.TEXUGO_UPDATE_URL || DEFAULT_URL, fetchImpl = fetch } = {}) {
    this.current = current;
    this.url = url;
    this.fetch = fetchImpl;
    this.last = null; // { at, info }
  }

  // Returns { current, latest, newer, page, notes, asset } or { error }.
  // At most one request a day unless forced (the "Procurar agora" button).
  async check({ force = false } = {}) {
    if (!force && this.last && Date.now() - this.last.at < DAY) return this.last.info;
    let info;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const r = await this.fetch(this.url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `TeXugo/${this.current} (LaTeX editor; https://github.com/FredieDidier/TeXugo)` },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      // 404: no release published yet. Not an error worth showing.
      if (r.status === 404) info = { current: this.current, latest: null, newer: false };
      else if (!r.ok) throw new Error('HTTP ' + r.status);
      else {
        const rel = await r.json();
        const latest = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
        info = {
          current: this.current,
          latest,
          newer: !rel.draft && !rel.prerelease && isNewer(latest, this.current),
          page: /^https:\/\/github\.com\//.test(rel.html_url || '') ? rel.html_url : null,
          notes: String(rel.body || '').slice(0, 4000),
          asset: pickAsset(rel.assets),
        };
        if (info.asset && !/^https:\/\/github\.com\//.test(info.asset.url)) info.asset = null;
      }
    } catch (err) {
      // Offline or rate-limited: try again next time, say nothing.
      return { current: this.current, error: err.name === 'AbortError' ? 'timeout' : err.message };
    }
    this.last = { at: Date.now(), info };
    return info;
  }
}

// Ajuda → Relatar um problema: the GitHub issue form with the version and
// the system filled in through the query string (field ids of
// .github/ISSUE_TEMPLATE/problema.yml). Nothing is sent by the app; the
// browser opens the form and the person decides what to submit.
export const ISSUES_NEW = 'https://github.com/FredieDidier/TeXugo/issues/new';
export function issueUrl({ version, platform = process.platform, arch = process.arch, release = '' }) {
  const os = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[platform] || platform;
  const q = new URLSearchParams({ template: 'problema.yml', versao: String(version || ''), sistema: `${os} ${release}`.trim() + ` (${arch})` });
  return `${ISSUES_NEW}?${q}`;
}
