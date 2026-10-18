import type { Pending } from '@ledge/protocol';
import { NO_ALWAYS, NO_NOTE, assertDialogIs, flatten, type Adapter, type KeyPlan, type PanePromptMatch } from './types.js';

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
const SHELL_SUBJECT = /^\$\s+(.+?)\s+in\s+\S+$/;
function dialogText(d: Dialog): string {
  const cmd = d.subject.match(SHELL_SUBJECT);
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

/** The inside of the square box that ends the pane (`┌ … └`), borders stripped; its top may be scrolled away. */
function squareBox(lines: string[]): string[] | null {
  const end = lastNonBlank(lines);
  if (end < 0 || !lines[end]!.trim().startsWith('└')) return null;
  let top = end - 1;
  while (top >= 0 && !lines[top]!.trim().startsWith('┌')) top--;
  return lines.slice(top + 1, end).map(boxed);
}

// The AskQuestion dialog (no hook fires for it), one question at a time. Space ticks the option under the cursor,
// Enter goes to the next question or submits, Esc skips. "Other" takes typed text: Ledge leaves it out.
//
//   ┌──────────────────────────────────────────┐
//   │ How should the letter be added?          │
//   │ Question 1 of 2                          │
//   │ 1. Which letter should be added?         │
//   │   › [ ] c                                │
//   │     [ ] d                                │
//   │     [ ] Other: (type to answer)          │
//   │ ↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip
//   └──────────────────────────────────────────┘
const QUESTION_FOOTER = /Space select\b.*\bEsc to skip\b/;
const CHOICE = /^(›\s*)?\[([ x])\]\s+(.*)$/;
const OTHER = /^Other:/;

type Question = { question: string; options: string[]; cursor: number; checked: boolean[] };

function parseQuestion(lines: string[]): Question | null {
  const box = squareBox(lines);
  if (!box || !box.some(l => QUESTION_FOOTER.test(l))) return null;
  const choices = box.map(l => l.match(CHOICE)).filter((m): m is RegExpMatchArray => !!m && !OTHER.test(m[3]!));
  if (!choices.length) return null;
  const first = box.findIndex(l => CHOICE.test(l));
  const question = box.slice(0, first).reverse().find(l => /^\d+\.\s/.test(l))?.replace(/^\d+\.\s+/, '') ?? '';
  return { question, options: choices.map(m => m[3]!.trim()), cursor: choices.findIndex(m => !!m[1]), checked: choices.map(m => m[2] === 'x') };
}

// The plan Cursor Agent proposes in Plan mode, after its turn has stopped (no hook either):
//
//   │ Suggested Plan                     │
//   │ Add line d to notes.txt            │
//   │ …                                  │
//   │ Ready to build?                    │
//   │  → 1. Yes, build locally (b)       │
//   │    2. Yes, build in cloud (c)      │
//   │    3. No, propose changes (p or Esc)
//   └────────────────────────────────────┘
//
// b builds here (never c: the cloud is not what an approval in Ledge means). p opens "Describe how to revise the
// plan", which takes text only (an empty Enter does nothing): it reads as the agent waiting for a prompt, and the
// next reply from Ledge goes there.
const PLAN_ASK = /^Ready to build\?$/;
const PLAN_OPTION = /^(?:→\s*)?\d+\.\s+(.+?)\s+\([^)]*\)$/;
const REVISE = /Describe how to revise the plan\b/;

/** Lines with their blank edges dropped and the runs of blank lines inside kept to one. */
const tidy = (lines: string[]) => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

function parsePlan(lines: string[]): { title: string; options: string[]; body?: string } | null {
  const box = squareBox(lines);
  if (!box) return null;
  const ask = box.findIndex(l => PLAN_ASK.test(l));
  if (ask < 0) return null;
  const options = box.slice(ask + 1).map(l => l.match(PLAN_OPTION)?.[1]).filter((o): o is string => !!o);
  if (!options.length) return null;
  const head = box.findIndex(l => l === 'Suggested Plan');
  const title = head < 0 ? '' : box.slice(head + 1).find(l => l !== '') ?? '';
  // The plan is the box from its header down to "Saved to …" (or the rule above the ask). Its header out of the pane
  // means its start scrolled away: no body rather than half a plan. The file it is saved to is not read: the pane
  // shows its path cut by the box (no leading slash, ellipsed when long), and the box is what the user approves.
  const end = head < 0 ? -1 : box.findIndex((l, i) => i > head && (/^Saved to /.test(l) || /^─{5,}/.test(l)));
  const body = head < 0 ? '' : tidy(box.slice(head + 1, end < 0 ? ask : end));
  return { title: title || 'Ready to build?', options, ...(body ? { body } : {}) };
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
  const q = parseQuestion(lines);
  if (q) return { kind: 'question', text: q.question, options: q.options };
  const plan = parsePlan(lines);
  if (plan) return { kind: 'plan', text: plan.title, options: plan.options, ...(plan.body ? { body: plan.body } : {}) };
  const d = parseDialog(lines);
  const command = d?.subject.match(SHELL_SUBJECT)?.[1];
  return d ? { kind: 'permission', text: dialogText(d), ...(command ? { command } : {}) } : null;
}

/** The kind of request the dialog on screen answers, read in keysFor's order (the skip field is still the approval's), or null. */
function shownKind(lines: string[]): 'permission' | 'question' | 'plan' | null {
  if (parseTrust(lines)) return 'permission';
  if (parseQuestion(lines)) return 'question';
  if (parsePlan(lines)) return 'plan';
  return lines.some(l => TELL_INSTEAD.test(l)) || parseDialog(lines) ? 'permission' : null;
}

/** Any dialog Ledge reads (approval, trust, question, plan) ends the pane. */
const anyDialog = (lines: string[]) => !!(parseDialog(lines) || parseTrust(lines) || parseQuestion(lines) || parsePlan(lines));

/**
 * Works on the server's short capture (the last lines of the pane). The skip field counts as the prompt:
 * a deny whose Enter was lost leaves the agent waiting there, and that must not read as done.
 */
function promptStillVisible(lastLines: string): boolean {
  const lines = toLines(lastLines);
  const end = lastNonBlank(lines);
  if (end >= 0 && lines[end]!.trim().startsWith('╰') && lines.some(l => TRUST_FOOTER.test(l))) return true;
  if (lines.some(l => TELL_INSTEAD.test(l))) return true;
  if (end >= 0 && lines[end]!.trim().startsWith('└') && lines.some(l => QUESTION_FOOTER.test(l) || /\(p or Esc\)\s*│?$/.test(l))) return true;
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

/**
 * After keys were sent: the prompt that was answered is no longer the one on screen. A dialog that follows (the next
 * question, the same agent asking for another command) is a new prompt, not a failed answer; the skip field is not gone.
 */
function promptGone(pane: string, pending: Pending): boolean {
  const lines = toLines(pane);
  if (inSkipField(lines.slice(0, lastNonBlank(lines) + 1).slice(-5).join('\n'))) return false;
  const m = detectPrompt(pane);
  return !m || m.kind !== pending.kind || m.text !== pending.text;
}

const onChoice = (i: number, what: 'cursor' | 'checked') => (lastLines: string) => {
  const q = parseQuestion(toLines(lastLines));
  return !!q && (what === 'cursor' ? q.cursor === i : !!q.checked[i]);
};

/** Ticks option `n` (1-based) of the question on screen and moves on: to it, Space unless already ticked, Enter. */
function answerPlan(q: Question, n: number): KeyPlan {
  const i = n - 1;
  if (i < 0 || i >= q.options.length) throw new Error(`the question has no option ${n}`);
  const from = q.cursor < 0 ? 0 : q.cursor;
  const moves = Array<string>(Math.abs(i - from)).fill(i > from ? 'Down' : 'Up');
  return [
    ...(moves.length ? [{ keys: moves }, { until: onChoice(i, 'cursor') }] : []),
    ...(q.checked[i] ? [] : [{ text: ' ' }, { until: onChoice(i, 'checked') }]),
    { keys: ['Enter'] }
  ];
}

function previewLines(pane: string): string[] {
  const lines = toLines(pane);
  if (anyDialog(lines)) return lines;
  const i = inputLine(lines);
  return i < 0 ? lines : lines.slice(0, i);
}

/** The input line is on screen, no dialog or skip field replaces it and no turn is running. */
function atRest(pane: string): boolean {
  const lines = toLines(pane);
  if (anyDialog(lines)) return false;
  const i = inputLine(lines);
  return i >= 0 && !TELL_INSTEAD.test(lines[i]!) && !lines.slice(i).some(l => BUSY.test(l));
}

/**
 * Deny with a note: n opens the skip field and p the plan's revision field; the note goes in once the field is on
 * screen, Enter once the field holds it (sent with the text, Enter is lost in the paste).
 */
function notePlan(lines: string[], note: string): KeyPlan {
  if (parseTrust(lines) || parseQuestion(lines)) throw new Error(NO_NOTE);
  const text = flatten(note);
  const typeIt: KeyPlan = [{ text }, { until: typed(text) }, { keys: ['Enter'] }];
  if (lines.some(l => TELL_INSTEAD.test(l))) return typeIt; // already in the skip field
  if (parsePlan(lines)) return [{ text: 'p' }, { until: p => REVISE.test(p) }, ...typeIt];
  return [{ text: 'n' }, { until: inSkipField }, ...typeIt];
}

export const cursorAdapter: Adapter = {
  tool: 'cursor',
  detectPrompt,
  promptStillVisible,
  previewLines,
  atRest,
  promptGone,
  keysFor(decision, pending, pane, note) {
    const lines = pane ? toLines(pane) : [];
    if (pane) assertDialogIs(pending, shownKind(lines));
    // « Add … to allowlist » is permanent and « Run Everything » opens everything: no « for this session » here.
    if (decision === 'always') throw new Error(NO_ALWAYS);
    if (decision === 'deny' && note) return notePlan(lines, note);
    if (parseTrust(lines)) return [{ text: decision === 'accept' ? 'a' : 'q' }];
    const q = parseQuestion(lines);
    if (q) return decision === 'accept' ? answerPlan(q, 1) : [{ keys: ['Escape'] }];
    // Refusing a plan asks how to revise it: the field waits for text, which a reply from Ledge then types.
    if (parsePlan(lines)) return decision === 'accept' ? [{ text: 'b' }] : [{ text: 'p' }, { until: p => REVISE.test(p) }];
    // Each key waits for the screen it is meant for. Sent in one burst, `n` then Enter reach the dialog together and
    // Enter picks the highlighted "Run (once)"; Esc then y reads as Alt+y.
    if (lines.some(l => TELL_INSTEAD.test(l))) {
      // Already in the skip field (n pressed in the terminal): Esc goes back to the dialog, an empty Enter skips.
      return decision === 'accept' ? [{ keys: ['Escape'] }, { until: inDialog }, { text: 'y' }] : [{ keys: ['Enter'] }];
    }
    return decision === 'accept' ? [{ text: 'y' }] : [{ text: 'n' }, { until: inSkipField }, { keys: ['Enter'] }];
  },
  replyPlan(text: string, pending?: Pending, pane?: string): KeyPlan {
    const q = pending?.kind === 'question' && /^[1-9]$/.test(text.trim()) && pane ? parseQuestion(toLines(pane)) : null;
    if (q) return answerPlan(q, Number(text.trim()));
    // An Enter that comes with the text in one read is taken as part of a paste and lost: it waits for the text to be
    // in the input line.
    const flat = flatten(text);
    return [{ text: flat }, { until: typed(flat) }, { keys: ['Enter'] }];
  },
  // Ctrl-C aborts a running turn; at rest it only clears the input line, it never quits.
  interruptKeys: () => ['C-c']
};
