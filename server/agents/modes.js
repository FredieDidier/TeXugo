// Permission modes of the agent panel: the same four for every agent that
// offers them, each mapped to the agent's own setting (Claude Code's
// --permission-mode, codex-acp's session mode).
//   ask    asks before every edit, new file or command (the default)
//   edits  edits the project's files without asking; asks for the rest
//   auto   the agent judges what is safe and asks only for the rest
//   full   never asks: any file, any command, the network
// The read-only runs (actions on the text, referee report, response to
// referees) never take a mode.
export const MODES = ['ask', 'edits', 'auto', 'full'];
export const modeOf = (m) => (MODES.includes(m) ? m : 'ask');
