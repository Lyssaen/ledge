import type { Pending } from '@ledge/protocol';
import type { Adapter, KeyPlan, PanePromptMatch } from './types.js';

// Claude Code 2.x draws a dialog at the bottom of the pane, without a box:
//
//   ────────────────────────   full-width rule (top)
//    Bash command               title
//    …                          tips / description
//   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌   optional dashed rules around the command or diff body
//    mkdir zz-ledge-probe
//   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//    Do you want to proceed?    question
//    ❯ 1. Yes                   options, the selected one marked ❯, descriptions indented below
//      2. No
//
//    Esc to cancel · Tab to amend                             footer (permission)
//   Enter to select · ↑/↓ to navigate · Esc to cancel         footer (question)
//
// The footer is what makes it a live dialog: the idle input line ("❯ ") and chat that quotes a
// dialog have numbered lines but no footer at the bottom.
const OPTION = /^\s*(?:❯\s*)?(\d+)\.\s+(\S.*?)\s*$/;
const FOOTER = /^\s*(?:Enter to select\b.*)?Esc to cancel\b/;
const RULE = /^─{10,}$/;
const DASHED = /^╌{10,}$/;
/** The footer may have at most this many non-blank lines below it. */
const FOOTER_SLACK = 2;
// No span limit inside the dialog: the poller's capture (DETECT_LINES) bounds the search, and a
// dialog taller than that capture has no top rule in it, so it is not detected.

const isBlank = (l: string) => l.trim() === '';
const isRule = (l: string) => RULE.test(l.trim()) || DASHED.test(l.trim());

/** Index of the dialog footer near the bottom of `lines`, or -1. */
function footerIndex(lines: string[]): number {
  let nonBlank = 0;
  for (let i = lines.length - 1; i >= 0 && nonBlank <= FOOTER_SLACK; i--) {
    if (isBlank(lines[i]!)) continue;
    if (FOOTER.test(lines[i]!)) return i;
    nonBlank++;
  }
  return -1;
}

/** Options 1..n between `from` (option 1) and the footer; any other line is a description or a rule. */
function optionsBetween(lines: string[], from: number, footer: number): string[] {
  const options: string[] = [];
  for (let i = from; i < footer; i++) {
    const m = lines[i]!.match(OPTION);
    if (m && Number(m[1]) === options.length + 1) options.push(m[2]!);
  }
  return options;
}

type Dialog = { kind: 'permission' | 'question'; title: string[]; question: string; options: string[] };

function parseDialog(pane: string): Dialog | null {
  const lines = pane.split('\n').map(l => l.replace(/\s+$/, ''));
  const footer = footerIndex(lines);
  if (footer < 0) return null;

  let first = -1;
  for (let i = footer - 1; i >= 0; i--) {
    const m = lines[i]!.match(OPTION);
    if (m && m[1] === '1') { first = i; break; }
  }
  if (first < 0) return null;
  const options = optionsBetween(lines, first, footer);

  // The question is the block of text right above option 1 (wrapped lines joined).
  let q = first - 1;
  while (q >= 0 && isBlank(lines[q]!)) q--;
  const questionLines: string[] = [];
  while (q >= 0 && !isBlank(lines[q]!) && !isRule(lines[q]!) && questionLines.length < 3) questionLines.unshift(lines[q--]!.trim());
  if (questionLines.length === 0) return null;

  let top = q;
  while (top >= 0 && !RULE.test(lines[top]!.trim())) top--;
  if (top < 0) return null;

  return {
    kind: /Enter to select/.test(lines[footer]!) ? 'question' : 'permission',
    title: lines.slice(top + 1, q + 1),
    question: questionLines.join(' '),
    options
  };
}

/** A permission's subject: the dashed-rule body (the command), or the title and the line after it. */
function permissionText(header: string[], question: string): string {
  const nonBlank = header.filter(l => !isBlank(l));
  const titleAndNext = nonBlank.slice(0, 2).filter(l => !DASHED.test(l.trim())).map(l => l.trim()).join(' ');
  // File dialogs ("Create file", "Edit file") put the diff between the dashed rules: name the file instead.
  if (/\bfile$/i.test(nonBlank[0]?.trim() ?? '')) return titleAndNext || question;
  const d1 = header.findIndex(l => DASHED.test(l.trim()));
  const d2 = d1 < 0 ? -1 : header.findIndex((l, i) => i > d1 && DASHED.test(l.trim()));
  if (d2 > d1 + 1) {
    const body = header.slice(d1 + 1, d2).map(l => l.trim()).filter(Boolean).join('\n');
    if (body) return body;
  }
  return titleAndNext || question;
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const d = parseDialog(pane);
  if (!d) return null;
  if (d.kind === 'question') return { kind: 'question', text: d.question, options: d.options };
  return { kind: 'permission', text: permissionText(d.title, d.question), options: d.options };
}

/** Works on the server's short capture: the bottom of a dialog is its last options and the footer. */
function promptStillVisible(lastLines: string): boolean {
  const lines = lastLines.split('\n').map(l => l.replace(/\s+$/, ''));
  const footer = footerIndex(lines);
  return footer > 0 && lines.slice(0, footer).some(l => OPTION.test(l));
}

// In 2.x a digit selects its option at once: no Enter (an Enter would land on whatever comes next).
const digit = (n: number): KeyPlan => [{ text: String(n) }];

// Any digit is a selection: hook options omit the dialog's own "Type something." / "Chat about this".
function optionNumber(text: string, pending: Pending | undefined): number | null {
  return pending?.kind === 'question' && /^[1-9]$/.test(text) ? Number(text) : null;
}

export const claudeAdapter: Adapter = {
  tool: 'claude',
  detectPrompt,
  promptStillVisible,
  keysFor(decision) {
    return decision === 'accept' ? digit(1) : [{ keys: ['Escape'] }];
  },
  replyPlan(text, pending) {
    // Tmux.sendText rejects newlines: flatten here, Enter is a separate key step.
    const flat = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    const n = optionNumber(flat, pending);
    if (n !== null) return digit(n);
    return [{ text: flat }, { keys: ['Enter'] }];
  },
  interruptKeys: () => ['Escape']
};
