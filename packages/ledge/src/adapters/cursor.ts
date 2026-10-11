import type { Pending } from '@ledge/protocol';
import type { Adapter, KeyPlan, PanePromptMatch } from './types.js';

const rtrim = (l: string) => l.replace(/\s+$/, '');
const isBlank = (l: string) => l.trim() === '';
const toLines = (pane: string) => pane.split('\n').map(rtrim);

function lastNonBlank(lines: string[]): number {
  let i = lines.length - 1;
  while (i >= 0 && isBlank(lines[i]!)) i--;
  return i;
}

// Cursor Agent 2026.10 draws an approval at the very bottom of the pane, under a full-width rule. A long
// command wraps over several lines, and a subagent's request looks the same:
//
//   ────────────────────────────────
//    $  find "/home/dev/demo" \( -path '*/.git/objects' \)
//       -prune -o -print | sort in .
//
//    Run this command?
//    Not in allowlist: find, sort
//     → Run (once) (y)
//       Add Shell(find), Shell(sort) to allowlist? (tab)
//       Run Everything (shift+tab)
//       Skip & tell the agent what to do instead (esc or n)
//
// The footer (`esc or n`) as the last line is what makes it a live dialog: a quoted copy in the transcript
// is followed by more conversation. y runs once; n (or Esc) opens a "tell the agent what to do instead"
// field that an empty Enter skips. Tab and Shift+Tab would widen the permissions: Ledge never sends them.
const DIALOG_FOOTER = /\(esc or n\)$/;
const DIALOG_ACCEPT = /\(y\)$/;
const RULE = /^─{10,}$/;
/** How far above the footer the rule can be: a long command wraps over many lines. */
const DIALOG_MAX = 40;

type Dialog = { question: string; subject: string };

function parseDialog(lines: string[]): Dialog | null {
  const end = lastNonBlank(lines);
  if (end < 0 || !DIALOG_FOOTER.test(lines[end]!)) return null;
  let rule = end - 1;
  while (rule >= 0 && end - rule <= DIALOG_MAX && !RULE.test(lines[rule]!.trim())) rule--;
  if (rule < 0 || !RULE.test(lines[rule]!.trim())) return null;
  const body = lines.slice(rule + 1, end + 1).map(l => l.trim());
  if (!body.some(l => DIALOG_ACCEPT.test(l))) return null;
  const q = body.findIndex(l => l.endsWith('?') && !/\((y|tab|shift\+tab)\)$/.test(l));
  if (q < 0) return null;
  const subject = body.slice(0, q).filter(Boolean).join(' ');
  return { question: body[q]!, subject };
}

/** `$  npm test in .` is a shell command and the folder it runs in: Ledge shows the command. */
function dialogText(d: Dialog): string {
  const cmd = d.subject.match(/^\$\s+(.+?)\s+in\s+\S+$/);
  if (cmd) return cmd[1]!;
  return d.subject ? `${d.question} ${d.subject}` : d.question;
}

// The workspace trust dialog, shown before anything else in a folder Cursor Agent has not seen. Its box
// stays in the scrollback once answered, so it is live only while its bottom border ends the pane and it is
// not already "Trusting workspace...":
//
//   ╭──────────────────────────────╮
//   │  ⚠ Workspace Trust Required  │
//   │  Do you trust the contents of this directory?
//   │    /home/dev/de               │   the path wraps mid-word
//   │    mo                         │
//   │  ▶ [a] Trust this workspace   │
//   │    [q] Quit                   │
//   │  Use arrow keys to navigate, Enter to select, or press the key shown
//   ╰──────────────────────────────╯
const TRUST_TITLE = /Workspace Trust Required/;
const TRUST_OPTION = /\[a\] Trust this workspace/;
/** Replaced by "⏳ Trusting workspace..." once a key is pressed. */
const TRUST_FOOTER = /Use arrow keys to navigate, Enter to select, or press the key shown/;
const boxed = (l: string) => l.trim().replace(/^│/, '').replace(/│$/, '').trim();

function parseTrust(lines: string[]): { path: string } | null {
  const end = lastNonBlank(lines);
  if (end < 0 || !lines[end]!.trim().startsWith('╰')) return null;
  let top = end - 1;
  while (top >= 0 && !lines[top]!.trim().startsWith('╭')) top--;
  if (top < 0) return null;
  const box = lines.slice(top + 1, end).map(boxed);
  if (!box.some(l => TRUST_TITLE.test(l)) || !box.some(l => TRUST_OPTION.test(l)) || !box.some(l => TRUST_FOOTER.test(l))) return null;
  const ask = box.findIndex(l => /^Do you trust\b/.test(l));
  const opt = box.findIndex(l => TRUST_OPTION.test(l));
  const path = ask < 0 ? '' : box.slice(ask + 1, opt).filter(Boolean).join('');
  return { path };
}

// After n or Esc the dialog becomes a one-line field over the command; an empty Enter skips it:
//
//   │ $  touch probe-file in .   │
//   → Tell the agent what to do instead (Enter to send, empty to skip, Esc to cancel)   ctrl+c to stop
const TELL_INSTEAD = /Tell the agent what to do instead\b/;

// The input line and the status under it, at the bottom of the pane:
//
//     → Add a follow-up                                       ctrl+c to stop    a turn runs
//
//     Grok 4.6 High Fast · 7.9% · 1 file edited
//     /home/dev/demo ·
//     master
//
// At rest the same line reads `→ Add a follow-up` (or `→ Plan, search, build anything`, or the draft) with no
// `ctrl+c to stop`. It is chrome, not conversation: the preview drops it and what is under it.
const INPUT = /^\s{1,3}→ /;
const BUSY = /\bctrl\+c to stop\b/;
/** Status lines the input line can have under it (model, folder, branch, all wrapping). */
const STATUS_SLACK = 6;

function inputLine(lines: string[]): number {
  let below = 0;
  for (let i = lastNonBlank(lines); i >= 0 && below <= STATUS_SLACK; i--) {
    if (INPUT.test(lines[i]!)) return i;
    if (!isBlank(lines[i]!)) below++;
  }
  return -1;
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const lines = toLines(pane);
  const t = parseTrust(lines);
  if (t) return { kind: 'permission', text: `Trust this folder? ${t.path}`.trim(), options: ['Trust this workspace', 'Quit'] };
  const d = parseDialog(lines);
  return d ? { kind: 'permission', text: dialogText(d) } : null;
}

/**
 * Works on the server's short capture (the last lines of the pane). The skip field counts as the prompt:
 * a deny whose Enter was lost leaves the agent waiting there, and that must not read as done.
 */
function promptStillVisible(lastLines: string): boolean {
  const lines = toLines(lastLines);
  const end = lastNonBlank(lines);
  if (end >= 0 && lines[end]!.trim().startsWith('╰') && lines.some(l => TRUST_FOOTER.test(l))) return true;
  if (lines.some(l => TELL_INSTEAD.test(l))) return true;
  return end >= 0 && DIALOG_FOOTER.test(lines[end]!) && lines.some(l => DIALOG_ACCEPT.test(l.trim()));
}

const compact = (s: string) => s.replace(/\s+/g, '');

/** The input line holds exactly `text` (wrapped over as many lines as it takes), as typed into an empty input. */
const typed = (text: string) => (lastLines: string) => {
  const lines = toLines(lastLines);
  const want = compact(`→ ${text}`);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (INPUT.test(lines[i]!) && compact(lines.slice(i).join('')).startsWith(want)) return true;
  }
  return false;
};

const inSkipField = (lastLines: string) => toLines(lastLines).some(l => TELL_INSTEAD.test(l));
const inDialog = (lastLines: string) => !inSkipField(lastLines) && promptStillVisible(lastLines);

function previewLines(pane: string): string[] {
  const lines = toLines(pane);
  if (parseDialog(lines) || parseTrust(lines)) return lines;
  const i = inputLine(lines);
  return i < 0 ? lines : lines.slice(0, i);
}

/** The input line is on screen, no dialog or skip field replaces it and no turn is running. */
function atRest(pane: string): boolean {
  const lines = toLines(pane);
  if (parseDialog(lines) || parseTrust(lines)) return false;
  const i = inputLine(lines);
  return i >= 0 && !TELL_INSTEAD.test(lines[i]!) && !lines.slice(i).some(l => BUSY.test(l));
}

export const cursorAdapter: Adapter = {
  tool: 'cursor',
  detectPrompt,
  promptStillVisible,
  previewLines,
  atRest,
  keysFor(decision, _pending, pane) {
    const lines = pane ? toLines(pane) : [];
    if (parseTrust(lines)) return [{ text: decision === 'accept' ? 'a' : 'q' }];
    // Each key waits for the screen it is meant for. Sent in one burst, `n` then Enter reach the dialog together and
    // Enter picks the highlighted "Run (once)"; Esc then y reads as Alt+y.
    if (lines.some(l => TELL_INSTEAD.test(l))) {
      // Already in the skip field (n pressed in the terminal): Esc goes back to the dialog, an empty Enter skips.
      return decision === 'accept' ? [{ keys: ['Escape'] }, { until: inDialog }, { text: 'y' }] : [{ keys: ['Enter'] }];
    }
    return decision === 'accept' ? [{ text: 'y' }] : [{ text: 'n' }, { until: inSkipField }, { keys: ['Enter'] }];
  },
  replyPlan(text: string, _pending?: Pending): KeyPlan {
    // Tmux.sendText rejects newlines: flatten here, Enter is a separate key step. An Enter that comes with the
    // text in one read is taken as part of a paste and lost: it waits for the text to be in the input line.
    const flat = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    return [{ text: flat }, { until: typed(flat) }, { keys: ['Enter'] }];
  },
  // Ctrl-C aborts a running turn; at rest it only clears the input line, it never quits.
  interruptKeys: () => ['C-c']
};
