import { createHash } from 'node:crypto';
import type { Tool } from '@ledge/protocol';

/** Claude Code delivers another session's SendMessage as a prompt: one `<cross-session-message from="<address>"
 *  from-name="<name>" …>` block per message queued, the transcript prefixing a line « Another Claude session sent a
 *  message: ». Attributes come in any order, `from-name` may be missing, and the closing tag too (the hook keeps only
 *  the start of a long prompt); the next opening tag ends a block only at a line start, so a body may quote one. Returns each block's sender and body, or undefined for a prompt that is not one.
 *  Imports nothing of the daemon: state.ts and history.ts both read it. */
const FIRST_LINE = /^Another Claude session sent a message:\s*\n/;
const BLOCK = /<cross-session-message\b([^>]*)>([\s\S]*?)(?:<\/cross-session-message>|(?=\n[ \t]*<cross-session-message\b)|$)/g;
const ATTR = /([\w-]+)="([^"]*)"/g;
export function crossSession(text: string): { from: string; name?: string; text: string }[] | undefined {
  const body = text.trimStart().replace(FIRST_LINE, '');
  if (!body.startsWith('<cross-session-message')) return undefined;
  const out: { from: string; name?: string; text: string }[] = [];
  for (const m of body.matchAll(BLOCK)) {
    const attrs = new Map([...m[1]!.matchAll(ATTR)].map(a => [a[1]!, a[2]!] as const));
    const from = attrs.get('from'); const name = attrs.get('from-name');
    if (from) out.push({ from, ...(name ? { name } : {}), text: m[2]!.trim() });
  }
  return out.length ? out : undefined;
}

/** What Ledge types into a session's prompt for a message from another one (Codex has no SendMessage of its own): one
 *  line, since `tmux.sendText` takes no newline, naming the sender and how to answer from the receiver's side before the
 *  body. The body's `<` becomes `‹`: no tag it quotes, in any case or spacing, closes the frame. Another agent's text may
 *  carry control bytes (test output in colour): tmux would type them as keys (Esc, Ctrl-U, Ctrl-C), so none is left. */
const LEDGE_CLOSE = '</ledge-message>';
const LEDGE_BLOCK = /^<ledge-message\b([^>]*)>([\s\S]*?)(?:<\/ledge-message>|$)/;
export const messageNote = (from: string, to: Tool): string =>
  `(message de la session ${from}, pas de l'utilisateur ; pour répondre : ${to === 'claude' ? `SendMessage vers ${from}` : `ledge send ${from} "…"`})`;
const NOTE_SENDER = /^\(message de la session (.+?), pas de l'utilisateur ; /;
/** A message body without the note that opens it (either reply hint), with the sender that note names. */
export function stripNote(text: string): { sender?: string; text: string } {
  const body = text.trimStart(); const sender = NOTE_SENDER.exec(body)?.[1];
  const lead = sender === undefined ? undefined : [messageNote(sender, 'codex'), messageNote(sender, 'claude')].find(n => body.startsWith(n));
  return lead ? { sender, text: body.slice(lead.length).trim() } : { text };
}
/** ANSI sequences: CSI (`ESC [ … final`), a string ended by BEL or ST (OSC, DCS, APC, PM, SOS), any other `ESC … final`. */
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]PX^_][^\x07\x1b]*(?:\x07|\x1b\\)|[ -/]*[0-~])/g;
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/g;
/** The text with its escape sequences stripped, its line breaks as `newline`, any control byte left a space. */
const typable = (text: string, newline: string) => text.replace(ESCAPES, '').replace(/\r\n|\r|\n/g, newline).replace(CONTROLS, ' ');
/** A body as the receiver's prompt carries it: on one line, escaped. The history pairs a received body with its sent card on this form. */
export const ledgeBody = (text: string): string => typable(text.replaceAll('<', '‹'), ' ⏎ ');
/** Past this many characters or lines, a body is typed as its start and a pointer: `ledge read <id>` prints it whole. */
export const INLINE_MAX = 800;
export const INLINE_LINES = 8;
/** What a pointer shows of the body: the summary, else the first line, cut to this. */
const POINTER_HEAD = 200;
const lineCount = (text: string) => text.split(/\r\n|\r|\n/).length;
/** A message's short id, from its rid: the mailbox and the history each compute it, so a pointer pairs with its sent card
 *  without asking the mailbox. `length` grows only when two rids meet on the shorter one in the mailbox. */
export const mailId = (rid: string, length = 6): string => `m${createHash('sha1').update(rid).digest('hex').slice(0, length)}`;
/** A body short enough to be typed whole. */
export const inline = (text: string): boolean => text.length <= INLINE_MAX && lineCount(text) <= INLINE_LINES;
/** A value safe inside a tag's attribute. */
const attr = (s: string) => typable(s, ' ').replace(/["<>]/g, '').trim();
export function formatLedgeMessage(m: { from: string; tool: Tool; text: string; to: Tool; id?: string; summary?: string }): string {
  const from = attr(m.from);
  const open = `<ledge-message from="${from}" tool="${m.tool}"${m.id ? ` id="${attr(m.id)}"` : ''}>${messageNote(from, m.to)} `;
  if (!m.id || inline(m.text)) return `${open}${ledgeBody(m.text)}${LEDGE_CLOSE}`;
  const first = m.summary?.trim() || m.text.trim().split(/\r\n|\r|\n/)[0]!.trim();
  const head = ledgeBody(first.length > POINTER_HEAD ? `${first.slice(0, POINTER_HEAD)}…` : first);
  return `${open}${head} … [message de ${m.text.length} caractères, ${lineCount(m.text)} lignes : lis-le en entier avec ledge read ${attr(m.id)}]${LEDGE_CLOSE}`;
}
/** Every message of a prompt: the mailbox types a batch as blocks one after the other on one line. */
export function ledgeMessages(text: string): { from: string; tool?: string; id?: string; text: string }[] | undefined {
  const out: { from: string; tool?: string; id?: string; text: string }[] = [];
  let rest = text.trimStart(); let m: RegExpExecArray | null;
  while (rest && (m = LEDGE_BLOCK.exec(rest))) {
    const attrs = new Map([...m[1]!.matchAll(ATTR)].map(a => [a[1]!, a[2]!] as const));
    const from = attrs.get('from'); const tool = attrs.get('tool'); const id = attrs.get('id');
    if (!from) break;
    out.push({ from, ...(tool ? { tool } : {}), ...(id ? { id } : {}), text: stripNote(m[2]!).text.trim() });
    rest = rest.slice(m[0].length).trimStart();
  }
  return out.length ? out : undefined;
}

/** What Ledge types into a sender's prompt when it gives up on one of its messages: one line, never the user's words. */
const NOTICE_BLOCK = /^<ledge-notice\b([^>]*)>([\s\S]*?)(?:<\/ledge-notice>|$)/;
const NOTICE_QUOTE = 80;
const NOTICE_REASON = ' ») : ';
export function formatLedgeNotice(n: { to: string; text: string; reason: string }): string {
  const to = attr(n.to); const flat = typable(n.text, ' ').trim();
  const quote = ledgeBody(flat.length > NOTICE_QUOTE ? `${flat.slice(0, NOTICE_QUOTE)}…` : flat);
  return `<ledge-notice to="${to}">Ledge n'a pas pu remettre ton message à ${to} (« ${quote}${NOTICE_REASON}${ledgeBody(n.reason)}</ledge-notice>`;
}
/** What Ledge types to a session that joins a team at its next free moment (spec 2026-10-25 roles §3.3): its role and
 *  its teammates, the lines its next start would give it. */
export function formatTeamNotice(n: { team: string; text: string }): string {
  return `<ledge-notice team="${attr(n.team)}">${ledgeBody(n.text)}</ledge-notice>`;
}
/** What Ledge types to a running session whose role's prompt changed (spec 2026-10-28 mobile teams §3.6): the new prompt in full. */
export function formatRoleNotice(n: { role: string; text: string }): string {
  return `<ledge-notice role="${attr(n.role)}">${ledgeBody(n.text)}</ledge-notice>`;
}
const TEAM_NOTICE = /^<ledge-notice\b([^>]*\bteam="[^"]*"[^>]*)>([\s\S]*?)(?:<\/ledge-notice>|$)/;
/** A prompt that is Ledge telling a session it joined a team: the team and the lines it carries. */
export function ledgeTeamNotice(text: string): { team: string; text: string } | undefined {
  const m = TEAM_NOTICE.exec(text.trimStart());
  if (!m) return undefined;
  const team = new Map([...m[1]!.matchAll(ATTR)].map(a => [a[1]!, a[2]!] as const)).get('team');
  return team ? { team, text: m[2]!.trim() } : undefined;
}
/** What Ledge types about a task (spec 2026-10-25 session tasks §3.3): one line naming the task and the session the
 *  change comes from, never the user's words. `text` is Ledge's own wording around the title and result, escaped here. */
const TASK_BLOCK = /^<ledge-task\b([^>]*)>([\s\S]*?)(?:<\/ledge-task>|$)/;
export function formatLedgeTask(t: { id: string; from: string; text: string }): string {
  return `<ledge-task id="${attr(t.id)}" from="${attr(t.from)}">${ledgeBody(t.text)}</ledge-task>`;
}
export function ledgeTask(text: string): { id: string; from?: string; text: string } | undefined {
  const m = TASK_BLOCK.exec(text.trimStart());
  if (!m) return undefined;
  const attrs = new Map([...m[1]!.matchAll(ATTR)].map(a => [a[1]!, a[2]!] as const));
  const id = attrs.get('id'); const from = attrs.get('from');
  return id ? { id, ...(from ? { from } : {}), text: m[2]!.trim() } : undefined;
}
/** A prompt that is a Ledge notice: the target it names, the reason that ends it, and its text. */
export function ledgeNotice(text: string): { to: string; reason?: string; text: string } | undefined {
  const m = NOTICE_BLOCK.exec(text.trimStart());
  if (!m) return undefined;
  const to = new Map([...m[1]!.matchAll(ATTR)].map(a => [a[1]!, a[2]!] as const)).get('to');
  if (!to) return undefined;
  const body = m[2]!.trim(); const at = body.lastIndexOf(NOTICE_REASON);
  return { to, ...(at >= 0 ? { reason: body.slice(at + NOTICE_REASON.length) } : {}), text: body };
}

/** Claude Code's automated notices about messages between sessions (2.1.303), delivered as a prompt as if the user had
 *  typed them: `[Cross-session idle notice]` answers a `notify_when_idle` (the session went idle, exited, does not hold
 *  the subscription, or the subscription expired); `[Cross-session delivery notice]` says a message was held, denied,
 *  expired, released, refused or dropped. Never the user's words: the thread shows them as system events. */
export type CrossSessionNotice = { text: string } & (
  | { kind: 'idle'; peer: string; time?: string; summary?: string }
  | { kind: 'exited'; peer: string; time?: string }
  | { kind: 'unavailable'; peer: string; reason?: string }
  | { kind: 'expired'; peer: string }
  | { kind: 'delivery'; status: DeliveryStatus; count: number; recipients: string[]; reason?: string }
  | { kind: 'other' });
export type DeliveryStatus = 'held' | 'denied' | 'expired' | 'delivered' | 'refused' | 'dropped' | 'unknown';

const NOTICE_HEAD = /^\[Cross-session ([\w -]+?) notice\]/;
/** A notice starts at a line start: a session's summary may quote one mid-line. */
const NOTICE_SPLIT = /\n\s*(?=\[Cross-session [\w -]+? notice\])/;
const DELIVERY: [RegExp, DeliveryStatus][] = [
  [/\bheld by that session\b/, 'held'], [/\bdenied by the recipient\b/, 'denied'], [/\bnot approved before expiry\b/, 'expired'],
  [/\bapproved and released\b/, 'delivered'], [/\bdropped at that session's inbox\b/, 'dropped'], [/\b(?:was|were) refused\b/, 'refused']
];

/** Each notice of a prompt made only of them (the wording read tolerantly: the quoted session, an optional time, the
 *  summary between « »), or undefined for anything else — a prompt the user wrote around a notice stays a prompt. */
export function crossSessionNotices(text: string): CrossSessionNotice[] | undefined {
  const body = text.trim();
  if (!NOTICE_HEAD.test(body)) return undefined;
  return body.split(NOTICE_SPLIT).map(part => notice(part.trim()));
}

function notice(text: string): CrossSessionNotice {
  const kind = NOTICE_HEAD.exec(text)![1];
  if (kind === 'idle') {
    const peer = /"([^"]*)"/.exec(text)?.[1] ?? '';
    if (/^\[[^\]]*\]\s*No idle signal arrived from "/.test(text)) return { kind: 'expired', peer, text };
    const exited = /\bhas exited(?: \(at ([^)]+)\))?/.exec(text);
    if (exited) return { kind: 'exited', peer, ...(exited[1] ? { time: exited[1] } : {}), text };
    const unavailable = /is not holding your idle subscription(?: \(([^)]*)\))?/.exec(text);
    if (unavailable) return { kind: 'unavailable', peer, ...(unavailable[1] ? { reason: unavailable[1] } : {}), text };
    const time = /\bfinished a turn at (.+?)\.(?=\s|$)/.exec(text)?.[1];
    const summary = /Its harness reports:\s*«([\s\S]*?)»/.exec(text)?.[1]?.trim();
    return { kind: 'idle', peer, ...(time ? { time } : {}), ...(summary ? { summary } : {}), text };
  }
  if (kind === 'delivery') {
    const status = DELIVERY.find(([re]) => re.test(text))?.[1] ?? 'unknown';
    const many = /\b(\d+) of your messages\b/.exec(text);
    const to = /\brecipients?:\s*([^;)]*)/.exec(text)?.[1];
    const recipients = to ? to.split(',').map(r => r.trim()).filter(r => r && r !== '…') : [];
    const reason = status === 'dropped' ? /NOT delivered \(([^)]*)\)/.exec(text)?.[1] : undefined;
    return { kind: 'delivery', status, count: many ? Number(many[1]) : 1, recipients, ...(reason ? { reason } : {}), text };
  }
  return { kind: 'other', text };
}
