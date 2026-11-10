// What differs between macOS, Windows and Linux, in one place: where the
// app keeps its data, where TeX and other tools usually live (apps started
// from the Dock, Start menu or a desktop launcher do not get the login
// shell's PATH), how a file is opened or shown in the file manager, and how
// a ZIP is made or unpacked. Everything else in the server is the same on
// every system.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const IS_MAC = process.platform === 'darwin';
export const IS_WIN = process.platform === 'win32';
export const IS_LINUX = !IS_MAC && !IS_WIN;

// The app's data folder (state, paper library, caches).
export function appDataDir(name = 'TeXugo', { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', name);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), name);
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), name);
}

// TeX Live installs into a folder named after the year: take every year
// present, newest first.
function texLiveYears(root, arch) {
  try {
    return fs
      .readdirSync(root)
      .filter((d) => /^20\d\d$/.test(d))
      .sort()
      .reverse()
      .map((y) => path.join(root, y, 'bin', arch));
  } catch {
    return [];
  }
}

// Folders added after the PATH the app was started with.
export function extraPaths({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const claude = [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local')];
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const pf = env.ProgramFiles || 'C:\\Program Files';
    return [
      ...texLiveYears('C:\\texlive', 'windows'),
      ...texLiveYears('C:\\texlive', 'win64'),
      path.join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
      path.join(pf, 'MiKTeX', 'miktex', 'bin', 'x64'),
      path.join(pf, 'Git', 'cmd'),
      path.join(pf, 'Git', 'usr', 'bin'), // perl, for latexmk and latexindent
      path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'),
      ...claude,
    ];
  }
  if (platform === 'darwin') {
    return ['/Library/TeX/texbin', ...texLiveYears('/usr/local/texlive', 'universal-darwin'), '/opt/homebrew/bin', ...claude, '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  }
  const arch = process.arch === 'arm64' ? 'aarch64-linux' : 'x86_64-linux';
  return [...texLiveYears('/usr/local/texlive', arch), path.join(home, '.local', 'texlive', 'bin', arch), ...claude, '/usr/local/bin', '/usr/bin', '/bin', '/snap/bin'];
}

// How to install TeX, for messages.
export function texInstallHint(platform = process.platform) {
  if (platform === 'win32') return 'Instale o MiKTeX (https://miktex.org) ou o TeX Live (https://tug.org/texlive/) e reabra o TeXugo.';
  if (platform === 'darwin') return 'Instale o MacTeX (https://tug.org/mactex/) ou adicione /Library/TeX/texbin ao PATH.';
  return 'Instale o TeX Live (pelo gerenciador de pacotes, por exemplo sudo apt install texlive-full, ou por https://tug.org/texlive/) e reabra o TeXugo.';
}

// Commands that open a file or link with its default app, show a file in
// the file manager, or open a terminal in a folder. Used when the Electron
// shell is not there (the browser version).
export function openCommand(target, platform = process.platform) {
  if (platform === 'darwin') return ['open', [target]];
  if (platform === 'win32') return ['explorer.exe', [target]];
  return ['xdg-open', [target]];
}
export function revealCommand(file, platform = process.platform) {
  if (platform === 'darwin') return ['open', ['-R', file]];
  if (platform === 'win32') return ['explorer.exe', [`/select,${file}`]];
  return ['xdg-open', [path.dirname(file)]];
}
export function terminalCommand(dir, platform = process.platform) {
  if (platform === 'darwin') return ['open', ['-a', 'Terminal', dir]];
  if (platform === 'win32') return ['cmd.exe', ['/c', 'start', '', '/d', dir, 'cmd.exe']];
  return ['x-terminal-emulator', ['--working-directory', dir]];
}

// The user's interactive shell for the embedded terminal.
export function userShell(platform = process.platform, env = process.env) {
  if (platform === 'win32') return { shell: env.ComSpec || 'powershell.exe', login: [] };
  return { shell: env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), login: ['-l'] };
}

// ZIP with what each system has: zip/unzip on macOS and Linux; Windows 10
// and later ship bsdtar, which reads and writes ZIP.
export function zipCommand(out, names, platform = process.platform) {
  if (platform === 'win32') return ['tar.exe', ['-a', '-c', '-f', out, ...names]];
  return ['zip', ['-X', '-q', out, ...names]];
}
export function unzipCommand(zip, dir, platform = process.platform) {
  if (platform === 'win32') return ['tar.exe', ['-x', '-f', zip, '-C', dir]];
  return ['unzip', ['-q', '-o', zip, '-d', dir]];
}

// Stops a process and everything it started (latexmk runs pdflatex, biber…).
// POSIX: the child was spawned detached, so it leads its own group.
// Windows has no groups; taskkill /T walks the tree.
export function killTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return;
  try {
    if (IS_WIN) {
      import('node:child_process').then(({ spawn }) => spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill()));
    } else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}
