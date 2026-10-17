import { NO_ALWAYS, NO_NOTE, flatten, type Adapter, type KeyPlan, type PanePromptMatch } from './types.js';

// Codex CLI 0.162 draws its dialogs at the bottom of the pane, without a box, the footer on the last line:
//
//     Would you like to run the following command?          approval (exec): a question, then the command
//     Reason: …
//     $ printf '%s\n' hi > hello.txt
//   › 1. Yes, proceed (y)                                   options, the cursor ❯ at column 0, key hints in ()
//     2. Yes, and don't ask again for commands that start with `…` (p)
//     3. No, and tell Codex what to do differently (esc)
//     Press enter to confirm or esc to cancel               footer
//
// An edit approval asks "Would you like to make the following edits?" and names the file under "Destination:".
// request_user_input (Plan mode) indents its options and puts a description after two spaces:
//
//     Question 1/1 (1 unanswered)
//     Which color should the banner be?
//     › 1. Blue (Recommended)  Uses a versatile, calm color …
//     tab to add notes | enter to submit answer | esc to interrupt
//
// The end of a Plan mode turn asks "Implement this plan?" over `enter select · esc back`, and the startup hooks
// review ("Hooks need review") sits over `enter confirm · esc skip`. The footer is what makes a dialog live: a
// copy quoted in the transcript has the input box under it, not a footer.
const APPROVAL_FOOTER = /^\s*Press enter to confirm or esc to cancel\s*$/;
const QUESTION_FOOTER = /\benter to submit\b/;
const SELECT_FOOTER = /^\s*enter select · esc back\s*$/;
const CONFIRM_FOOTER = /^\s*enter confirm · esc skip\s*$/;
const FOOTERS = [APPROVAL_FOOTER, QUESTION_FOOTER, SELECT_FOOTER, CONFIRM_FOOTER];
const OPTION = /^\s*(?:›\s*)?(\d+)\.\s+(\S.*)$/;
/** How far above its options a dialog's header (question, command, file) may start. */
const HEADER_SPAN = 25;

const isBlank = (l: string) => l.trim() === '';
const isFooter = (l: string) => FOOTERS.some(f => f.test(l));
const split = (pane: string) => pane.split('\n').map(l => l.replace(/\s+$/, ''));

/** Index of the last non-blank line, or -1. */
function lastLine(lines: string[]): number {
  let i = lines.length - 1;
  while (i >= 0 && isBlank(lines[i]!)) i--;
  return i;
}

/** `raw`: each option as drawn, its key hint (`(p)`) still at the end. */
type Dialog = { kind: 'approval' | 'question' | 'plan' | 'confirm'; header: string[]; options: string[]; details: string[]; raw: string[] };

/** Option label: the description after two spaces and the key hint (`(y)`, `(esc)`) left out. */
const label = (text: string) => text.split(/\s{2,}/)[0]!.replace(/\s+\([a-z]+\)$/, '').trim();
/** Option description: what follows the label after two spaces (wrapped lines were joined with one). */
const detail = (text: string) => text.split(/\s{2,}/).slice(1).join(' ').replace(/\s+/g, ' ').trim();

function parseDialog(pane: string): Dialog | null {
  const lines = split(pane);
  const footer = lastLine(lines);
  if (footer < 0 || !isFooter(lines[footer]!)) return null;
  // The option block: the non-blank run right above the footer. A line that is not an option wraps the one above.
  let end = footer - 1;
  while (end >= 0 && isBlank(lines[end]!)) end--;
  let start = end;
  while (start > 0 && !isBlank(lines[start - 1]!)) start--;
  const raw: string[] = [];
  for (let i = start; i <= end; i++) {
    const m = lines[i]!.match(OPTION);
    if (m && Number(m[1]) === raw.length + 1) raw.push(m[2]!);
    else if (raw.length > 0) raw[raw.length - 1] += ` ${lines[i]!.trim()}`;
    else return null;
  }
  if (raw.length === 0) return null;
  // The header: indented lines above the options, up to the transcript (a line at column 0).
  const header: string[] = [];
  for (let i = start - 1; i >= 0 && start - i <= HEADER_SPAN; i--) {
    const l = lines[i]!;
    if (!isBlank(l) && !/^\s/.test(l)) break;
    header.unshift(l);
  }
  const f = lines[footer]!;
  const kind = APPROVAL_FOOTER.test(f) ? 'approval' : QUESTION_FOOTER.test(f) ? 'question' : SELECT_FOOTER.test(f) ? 'plan' : 'confirm';
  // A select footer is also any picker the user opens (/model, /permissions): only the plan question is the agent's.
  if (kind === 'plan' && !header.some(l => /^\s*Implement this plan\?\s*$/.test(l))) return null;
  return { kind, header, options: raw.map(label), details: raw.map(detail), raw };
}

/** The non-blank run of header lines starting at `from`, trimmed. */
function run(header: string[], from: number): string[] {
  const out: string[] = [];
  for (let i = from; i < header.length && !isBlank(header[i]!); i++) out.push(header[i]!.trim());
  return out;
}

function approvalText(header: string[]): string {
  const cmd = header.findIndex(l => /^\s*\$\s/.test(l));
  if (cmd >= 0) return run(header, cmd).join(' ').replace(/^\$\s+/, '');
  // Codex wraps the path at the pane width, mid-word: the pieces are joined back without a space.
  const dest = header.findIndex(l => /^\s*Destination:\s*$/.test(l));
  if (dest >= 0) { const path = run(header, dest + 1).join(''); if (path) return `Edit ${path}`; }
  return header.map(l => l.trim()).find(l => /^Would you like to\b/.test(l)) ?? 'approval';
}

/** The last non-blank header lines (the question right above the options), without the "Question 1/2" counter. */
function questionText(header: string[]): string {
  const out: string[] = [];
  for (let i = header.length - 1; i >= 0; i--) {
    const l = header[i]!.trim();
    if (!l) { if (out.length) break; continue; }
    if (/^Questions? \d+\/\d+\b/.test(l)) break;
    out.unshift(l);
    if (out.length === 3) break;
  }
  return out.join(' ');
}

function confirmText(header: string[]): string {
  const lines = header.map(l => l.trim()).filter(Boolean);
  if (lines[0] === 'Hooks need review') return `Trust the new Codex hooks? ${lines[1] ?? ''}`.trim();
  return lines[0] ?? 'confirm';
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const d = parseDialog(pane);
  if (!d) return null;
  if (d.kind === 'question') return { kind: 'question', text: questionText(d.header), options: d.options, ...(d.details.some(Boolean) ? { optionDetails: d.details } : {}) };
  if (d.kind === 'plan') return { kind: 'plan', text: 'Implement this plan?', options: d.options };
  if (d.kind === 'confirm') return { kind: 'permission', text: confirmText(d.header), options: d.options };
  return { kind: 'permission', text: approvalText(d.header), options: d.options };
}

/** Works on the server's short capture: the footer is the last line of every dialog. */
function promptStillVisible(lastLines: string): boolean {
  const lines = split(lastLines);
  const i = lastLine(lines);
  return i >= 0 && isFooter(lines[i]!) && lines.slice(0, i).some(l => OPTION.test(l));
}

// The input box at the bottom of the pane, at rest or with a draft:
//
//   › Ask Codex to do anything          the input line at column 0 (a placeholder or the draft)
//
//     GPT-5.6-Sol low · ~/demo          status, a line or two
//     ← for agents · ? for shortcuts
//
// The transcript also starts the user's prompts with "› ", so the box is the lowest one, near the bottom.
/** Non-blank lines that can sit under the input line: draft continuation lines and the status. */
const BELOW_INPUT = 10;
/** A running turn shows `• Working (2s • esc to interrupt)` right above the input box. */
const BUSY = /\besc to interrupt\b/;
const BUSY_SPAN = 6;

function inputLine(lines: string[]): number {
  let below = 0;
  for (let i = lastLine(lines); i >= 0 && below <= BELOW_INPUT; i--) {
    if (/^›(?:\s|$)/.test(lines[i]!)) return i;
    if (isBlank(lines[i]!)) continue;
    // Draft continuation and status lines are indented: a line at column 0 (`• reply`, `■ interrupted`) is transcript.
    if (!/^\s/.test(lines[i]!)) return -1;
    below++;
  }
  return -1;
}

function previewLines(pane: string): string[] {
  const lines = split(pane);
  if (parseDialog(pane)) return lines;
  const input = inputLine(lines);
  return input < 0 ? lines : lines.slice(0, input);
}

/** The input box is on screen, no dialog replaces it and no turn is running: Codex waits for a prompt. */
function atRest(pane: string): boolean {
  const lines = split(pane);
  const last = lastLine(lines);
  if (last < 0 || isFooter(lines[last]!)) return false;
  const input = inputLine(lines);
  return input >= 0 && !lines.slice(Math.max(0, input - BUSY_SPAN), input).some(l => BUSY.test(l));
}

const digit = (n: number): KeyPlan => [{ text: String(n) }];
/** 1-based number of the first option matching `re`, or null. */
function optionNumber(options: string[], re: RegExp): number | null {
  const i = options.findIndex(o => re.test(o));
  return i < 0 ? null : i + 1;
}

/**
 * Codex reads keys typed in a fast burst as a paste, and an Enter inside a paste is a newline in the draft. tmux types
 * the reply in one burst: Enter goes after a pause. Measured on 0.162: sent right after the text, Enter was a newline.
 */
export const REPLY_ENTER_DELAY_MS = 300;

// « Always » is the approval's own option, its key at the end of the line: `p` for a command (« … for commands that
// start with `…` »), `a` for files (« … for these files »). The plan question has none (« Yes, clear context and
// implement » is not one).
const ALWAYS = /don['’]t ask again/i;

function alwaysKeys(d: Dialog | null): KeyPlan {
  const i = d?.kind === 'approval' ? d.raw.findIndex(o => ALWAYS.test(o)) : -1;
  const key = i < 0 ? undefined : d!.raw[i]!.match(/\(([a-z])\)\s*$/)?.[1];
  if (!key) throw new Error(NO_ALWAYS);
  return [{ text: key }];
}

/**
 * Deny with a note. Esc answers « No, and tell Codex what to do differently »: the turn stops and the note is the next
 * prompt, typed once the input box is back. On the plan question Esc only goes back: « No, stay in Plan mode » first.
 */
function noteKeys(d: Dialog | null, note: string): KeyPlan {
  if (d?.kind === 'confirm') throw new Error(NO_NOTE);
  const no = d?.kind === 'plan' ? optionNumber(d.options, /^No\b/) : null;
  return [...(no ? digit(no) : [{ keys: ['Escape'] }]), { until: atRest }, { text: flatten(note) }, { waitMs: REPLY_ENTER_DELAY_MS }, { keys: ['Enter'] }];
}

export const codexAdapter: Adapter = {
  tool: 'codex',
  detectPrompt,
  promptStillVisible,
  previewLines,
  atRest,
  keysFor(decision, pending, pane, note) {
    const d = pane ? parseDialog(pane) : null;
    if (decision === 'always') return alwaysKeys(d);
    if (decision === 'deny' && note) return noteKeys(d, note);
    if (decision === 'deny') {
      // Esc on the plan question only goes back; "No, stay in Plan mode" is the answer.
      const no = d?.kind === 'plan' ? optionNumber(d.options, /^No\b/) : null;
      return no ? digit(no) : [{ keys: ['Escape'] }];
    }
    if (d?.kind === 'confirm') {
      // A digit only moves the cursor in this list: Enter confirms.
      const trust = optionNumber(d.options, /^Trust all\b|^Yes\b/i);
      if (!trust) throw new Error('no trust option in this dialog, answer in the terminal');
      return [{ text: String(trust) }, { keys: ['Enter'] }];
    }
    if (d?.kind === 'plan' || pending.kind === 'plan') {
      return digit((d && (optionNumber(d.options, /^Yes, implement this plan$/) ?? optionNumber(d.options, /^Yes\b/))) ?? 1);
    }
    // A digit selects a request_user_input option at once.
    if (pending.kind === 'question') return digit(1);
    // "Yes, proceed" runs this one command (or applies this one edit); `p` / `a` would stop asking.
    return [{ text: 'y' }];
  },
  replyPlan(text, pending) {
    const flat = flatten(text);
    if (pending?.kind === 'question' && /^[1-9]$/.test(flat)) return digit(Number(flat));
    return [{ text: flat }, { waitMs: REPLY_ENTER_DELAY_MS }, { keys: ['Enter'] }];
  },
  // Esc interrupts the turn; Ctrl+C clears the draft and a second one quits Codex.
  interruptKeys: () => ['Escape']
};
