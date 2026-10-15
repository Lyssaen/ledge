import { UNTYPABLE, type Pending } from '@ledge/protocol';
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
//    ctrl+g to edit in VS Code · ~/.claude/plans/….md         footer (plan approval, ExitPlanMode)
//
// The footer is what makes it a live dialog: the idle input line ("❯ ") and chat that quotes a
// dialog have numbered lines but no footer at the bottom.
//
// AskUserQuestion with several questions shows one tab per question (each with the question footer; an answered
// option is marked ✔), then a review that has no footer at all, its two options last on the pane:
//
//   ←  ☒ Color  ☒ Size  ✔ Submit  →
//   Review your answers
//    ● Color?
//      → Red
//   Ready to submit your answers?
//   ❯ 1. Submit answers
//     2. Cancel
const OPTION = /^\s*(?:❯\s*)?(\d+)\.\s+(\S.*?)\s*$/;
const FOOTER = /^\s*(?:(?:Enter to select\b.*)?Esc to cancel\b|ctrl\+g to edit\b)/;
const PLAN_FOOTER = /^\s*ctrl\+g to edit\b/;
const REVIEW_QUESTION = /^\s*Ready to submit your answers\?$/;
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

/**
 * The end of the multi-question review (the line after its last option), or -1: options 1 and 2 are the last lines
 * on the pane, right under the review's question.
 */
function reviewEnd(lines: string[]): number {
  let last = lines.length - 1;
  while (last >= 0 && isBlank(lines[last]!)) last--;
  if (last < 1 || lines[last]!.match(OPTION)?.[1] !== '2' || lines[last - 1]!.match(OPTION)?.[1] !== '1') return -1;
  let q = last - 2;
  while (q >= 0 && isBlank(lines[q]!)) q--;
  return q >= 0 && REVIEW_QUESTION.test(lines[q]!) ? last + 1 : -1;
}

/** Where a live dialog ends: its footer, or the end of the review; -1 when none is on screen. */
function dialogEnd(lines: string[]): number {
  const footer = footerIndex(lines);
  return footer >= 0 ? footer : reviewEnd(lines);
}

/** Options 1..n between `from` (option 1) and the footer; any other non-blank line is a description (joined) or a rule. */
function optionsBetween(lines: string[], from: number, footer: number): { options: string[]; details: string[] } {
  const options: string[] = [];
  const details: string[] = [];
  for (let i = from; i < footer; i++) {
    const m = lines[i]!.match(OPTION);
    if (m && Number(m[1]) === options.length + 1) { options.push(m[2]!.replace(/\s+✔$/, '')); details.push(''); }
    else if (options.length && !isBlank(lines[i]!) && !isRule(lines[i]!)) details[options.length - 1] = `${details[options.length - 1]} ${lines[i]!.trim()}`.trim();
  }
  // A description that only repeats its label says nothing.
  return { options, details: details.map((d, i) => (d === options[i] ? '' : d)) };
}

type Dialog = { kind: 'permission' | 'question' | 'plan'; title: string[]; question: string; options: string[]; details: string[] };

function parseDialog(pane: string): Dialog | null {
  const lines = pane.split('\n').map(l => l.replace(/\s+$/, ''));
  const footer = dialogEnd(lines);
  if (footer < 0) return null;

  let first = -1;
  for (let i = footer - 1; i >= 0; i--) {
    const m = lines[i]!.match(OPTION);
    if (m && m[1] === '1') { first = i; break; }
  }
  if (first < 0) first = 0;
  const { options, details } = optionsBetween(lines, first, footer);

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
    kind: /Enter to select/.test(lines[footer] ?? '') || REVIEW_QUESTION.test(questionLines.join(' '))
      ? 'question' : PLAN_FOOTER.test(lines[footer] ?? '') ? 'plan' : 'permission',
    title: lines.slice(top + 1, q + 1),
    question: questionLines.join(' '),
    options,
    details
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

// The workspace trust dialog, shown before anything else in a folder Claude Code has not seen. Its options carry no
// number, only the ❯ cursor, and its footer is its own:
//
//   ────────────────────────
//    Accessing workspace:
//    /home/dev/demo
//    Quick safety check: … one you trust? …
//    ❯ No, exit
//      Yes, I trust this folder
//    Enter to confirm · Esc to cancel
const TRUST_FOOTER = /^\s*Enter to confirm\b.*Esc to cancel\b/;
const TRUST_OPTION = /\btrust this folder\b/i;

type Trust = { path: string; options: string[]; selected: number; trust: number };

function parseTrust(pane: string): Trust | null {
  const lines = pane.split('\n').map(l => l.replace(/\s+$/, ''));
  let footer = lines.length - 1;
  while (footer >= 0 && isBlank(lines[footer]!)) footer--;
  if (footer < 0 || !TRUST_FOOTER.test(lines[footer]!)) return null;
  // The options are the block right above the footer.
  let o = footer - 1;
  while (o >= 0 && isBlank(lines[o]!)) o--;
  const block: string[] = [];
  while (o >= 0 && !isBlank(lines[o]!)) block.unshift(lines[o--]!);
  const options = block.map(l => l.trim().replace(/^❯\s*/, ''));
  const trust = options.findIndex(l => TRUST_OPTION.test(l));
  const selected = block.findIndex(l => l.trim().startsWith('❯'));
  if (trust < 0 || selected < 0) return null;
  const at = lines.findIndex(l => /^\s*Accessing workspace:/.test(l));
  const path = at < 0 ? '' : lines.slice(at + 1, footer).find(l => !isBlank(l))?.trim() ?? '';
  return { path, options, selected, trust };
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const t = parseTrust(pane);
  if (t) return { kind: 'permission', text: `Trust this folder? ${t.path}`.trim(), options: t.options };
  const d = parseDialog(pane);
  if (!d) return null;
  // Only a question's lines under an option are its description; elsewhere they wrap a long option.
  if (d.kind === 'question') return { kind: 'question', text: d.question, options: d.options, ...(d.details.some(Boolean) ? { optionDetails: d.details } : {}) };
  if (d.kind === 'plan') return { kind: 'plan', text: d.question, options: d.options };
  return { kind: 'permission', text: permissionText(d.title, d.question), options: d.options };
}

/** Works on the server's short capture: the bottom of a dialog is its last options and the footer. */
function promptStillVisible(lastLines: string): boolean {
  const lines = lastLines.split('\n').map(l => l.replace(/\s+$/, ''));
  if (lines.some(l => TRUST_FOOTER.test(l)) && lines.some(l => TRUST_OPTION.test(l))) return true;
  const footer = dialogEnd(lines);
  return footer > 0 && lines.slice(0, footer).some(l => OPTION.test(l));
}

const squash = (t: string) => t.replace(/\s+/g, ' ').trim();

/**
 * After keys were sent: the prompt that was answered is no longer the one on screen. A question that gives way to the
 * next one (several questions, then their review) was answered. The pane cuts a long question to three lines, so a
 * question that starts the same is the same one. An approval's hook text is not what the pane shows: any dialog left
 * at the bottom means it was not taken.
 */
function promptGone(pane: string, pending: Pending): boolean {
  if (pending.kind !== 'question' || !squash(pending.text)) return !promptStillVisible(pane.replace(/\s+$/, '').split('\n').slice(-5).join('\n'));
  const m = detectPrompt(pane);
  if (!m || m.kind !== 'question') return true;
  const shown = squash(m.text); const asked = squash(pending.text);
  return !(shown === asked || asked.startsWith(shown) || shown.startsWith(asked));
}

// The idle input box at the bottom of the pane (2.1+ fullscreen and inline alike):
//
//   ────────────────────────   rule
//   ❯ draft text               input, one line or more
//   ────────────────────────   rule
//     ⏵⏵ auto mode on · …      status, a line or two
//
// It is chrome, not conversation: the preview drops it from its top rule down.
/** Lines below the input box's bottom rule that can still be status, not conversation. */
const STATUS_SLACK = 3;
/** The tallest draft the input box can hold before it is no longer recognised as one. */
const INPUT_MAX = 12;
const isInputRule = (l: string) => /^─{10,}$/.test(l.trim());
/** The top rule can carry the conversation's title once it has one: `───── add-readme-file ─`. */
const isInputTop = (l: string) => /^─{10,}(?: \S.* ─+)?$/.test(l.trim());

/** The input box's top and bottom rules, or null when the bottom of the pane is not the input box. */
function inputBox(lines: string[]): { top: number; bottom: number } | null {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1]!)) end--;
  // The bottom rule: the lowest rule with at most STATUS_SLACK non-blank lines under it.
  let bottom = -1; let below = 0;
  for (let i = end - 1; i >= 0 && below <= STATUS_SLACK; i--) {
    if (isInputRule(lines[i]!)) { bottom = i; break; }
    if (!isBlank(lines[i]!)) below++;
  }
  if (bottom < 0) return null;
  // The top rule: the nearest rule above, with the ❯ input line right under it.
  for (let top = bottom - 1; top >= 0 && bottom - top <= INPUT_MAX + 1; top--) {
    if (!isInputTop(lines[top]!)) continue;
    return lines[top + 1]!.trimStart().startsWith('❯') ? { top, bottom } : null;
  }
  return null;
}

const TITLE_RULE = /^─{10,} (\S.*?) ─+$/;
/** `───── add-readme-file ─`: the title Claude Code writes on the input box's top rule once the conversation has one. */
function paneTitle(pane: string): string | null {
  const lines = pane.split('\n').map(l => l.replace(/\s+$/, ''));
  const box = inputBox(lines);
  const m = box ? TITLE_RULE.exec(lines[box.top]!.trim()) : null;
  return m ? m[1]! : null;
}

function previewLines(pane: string): string[] {
  const lines = pane.split('\n').map(l => l.replace(/\s+$/, ''));
  const box = inputBox(lines);
  return box ? lines.slice(0, box.top) : lines;
}

// A running turn puts "esc to interrupt" in the status line under the input box; at rest it is gone:
//
//   ⏸ plan mode on (shift+tab to cycle) · esc to interrupt · ← 2 agents     working
//   ⏸ manual mode on · ? for shortcuts · ← 2 agents                         at rest
const BUSY = /\besc to interrupt\b/;

/** The input box is on screen, no dialog replaces it and no turn is running: Claude waits for a prompt. */
function atRest(pane: string): boolean {
  const lines = pane.split('\n').map(l => l.replace(/\s+$/, ''));
  if (dialogEnd(lines) >= 0 || parseTrust(pane)) return false;
  const box = inputBox(lines);
  return !!box && !lines.slice(box.bottom + 1).some(l => BUSY.test(l));
}

// In 2.x a digit selects its option at once: no Enter (an Enter would land on whatever comes next).
const digit = (n: number): KeyPlan => [{ text: String(n) }];

// Any digit is a selection: hook options omit the dialog's own "Type something." / "Chat about this".
function optionNumber(text: string, pending: Pending | undefined): number | null {
  return pending?.kind === 'question' && /^[1-9]$/.test(text) ? Number(text) : null;
}

// A question's own free-text row: its digit puts the cursor in it without answering (the footer gains "ctrl+g to
// edit"), what is typed then replaces "Type something." and Enter sends it.
//
//   ❯ 3. Type something.        →        ❯ 3. Vert pomme
const FREE_ROW = /^Type something\.?$/;
const NO_FREE_ROW = 'no free-text row in this dialog, answer in the terminal';

function freeTextPlan(text: string, pane: string | undefined): KeyPlan {
  const d = pane ? parseDialog(pane) : null;
  const i = d?.kind === 'question' ? d.options.findIndex(o => FREE_ROW.test(o)) : -1;
  if (i < 0) throw new Error(NO_FREE_ROW);
  const focused = (p: string) => cursorOption(p) === i + 1;
  // The row already has the cursor (moved there with the arrows): its digit would be typed into the field.
  return [...(focused(pane!) ? [] : digit(i + 1)), { until: focused }, { text }, { keys: ['Enter'] }];
}

/**
 * The number of the option that has the cursor (❯) in the live dialog at the bottom of `pane`, or null. Only the options
 * block is read, from option 1 down: never a ❯ quoted in the chat above. A dialog taller than `pane` has its option 1
 * cut off; everything above its footer is then options, which are read from the top of `pane`.
 */
function cursorOption(pane: string): number | null {
  const lines = pane.split('\n').map(l => l.replace(/\s+$/, ''));
  const end = dialogEnd(lines);
  if (end < 0) return null;
  let first = end - 1;
  while (first >= 0 && lines[first]!.match(OPTION)?.[1] !== '1') first--;
  if (first < 0) first = 0;
  for (let i = first; i < end; i++) {
    const m = lines[i]!.match(OPTION);
    if (m && lines[i]!.trimStart().startsWith('❯')) return Number(m[1]);
  }
  return null;
}


/** A phone's free answer, typed as is (never read as an option number) into the question's "Type something." row. */
function otherPlan(text: string, _pending: Pending, pane: string): KeyPlan {
  if (text.trim() === '' || UNTYPABLE.test(text)) throw new Error('a free answer is one line of text');
  return freeTextPlan(text, pane);
}

/** Accepting a plan keeps the permission mode as it was: never the option that turns on auto mode or auto edits. */
const PLAN_ACCEPT = /\bmanually approve\b/i;

export const claudeAdapter: Adapter = {
  tool: 'claude',
  capabilities: { freeTextAnswer: true },
  detectPrompt,
  promptStillVisible,
  promptGone,
  previewLines,
  atRest,
  paneTitle,
  keysFor(decision, pending, pane) {
    if (decision === 'deny') return [{ keys: ['Escape'] }];
    const t = pane ? parseTrust(pane) : null;
    if (t) {
      const step = t.trust > t.selected ? 'Down' : 'Up';
      return [{ keys: [...Array<string>(Math.abs(t.trust - t.selected)).fill(step), 'Enter'] }];
    }
    const d = pane ? parseDialog(pane) : null;
    if (pending.kind === 'plan' && d?.kind === 'plan') {
      const i = d.options.findIndex(o => PLAN_ACCEPT.test(o));
      return digit(i < 0 ? 1 : i + 1);
    }
    return digit(1);
  },
  freeText: true,
  otherPlan,
  replyPlan(text, pending, pane) {
    // Tmux.sendText rejects newlines: flatten here, Enter is a separate key step.
    const flat = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    const n = optionNumber(flat, pending);
    if (n !== null) return digit(n);
    if (pending?.kind === 'question') return freeTextPlan(flat, pane);
    return [{ text: flat }, { keys: ['Enter'] }];
  },
  interruptKeys: () => ['Escape']
};
