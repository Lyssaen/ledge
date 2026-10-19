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
 *  line, since `tmux.sendText` takes no newline, naming the sender and how to answer from the receiver's side. A
 *  closing tag quoted in the body is escaped so the parser can read up to the last one. Another agent's text may carry
 *  control bytes (test output in colour): tmux would type them as keys (Esc, Ctrl-U, Ctrl-C), so none is left. */
const LEDGE_CLOSE = '</ledge-message>';
const LEDGE_BLOCK = /^<ledge-message\b([^>]*)>([\s\S]*?)(?:<\/ledge-message>(?![\s\S]*<\/ledge-message>)|$)/;
/** ANSI sequences: CSI (`ESC [ … final`), a string ended by BEL or ST (OSC, DCS, APC, PM, SOS), any other `ESC … final`. */
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]PX^_][^\x07\x1b]*(?:\x07|\x1b\\)|[ -/]*[0-~])/g;
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/g;
/** The text with its escape sequences stripped, its line breaks as `newline`, any control byte left a space. */
const typable = (text: string, newline: string) => text.replace(ESCAPES, '').replace(/\r\n|\r|\n/g, newline).replace(CONTROLS, ' ');
export function formatLedgeMessage(m: { from: string; tool: Tool; text: string; to: Tool }): string {
  const from = typable(m.from, ' ').replace(/["<>]/g, '').trim();
  const body = typable(m.text.replaceAll(LEDGE_CLOSE, '<\\/ledge-message>'), ' ⏎ ');
  const reply = m.to === 'codex' ? `ledge send ${from} "…"` : `SendMessage vers ${from}`;
  return `<ledge-message from="${from}" tool="${m.tool}">${body}${LEDGE_CLOSE} (message de la session ${from}, pas de l'utilisateur ; pour répondre : ${reply})`;
}
export function ledgeMessages(text: string): { from: string; tool?: string; text: string }[] | undefined {
  const m = LEDGE_BLOCK.exec(text.trimStart());
  if (!m) return undefined;
  const attrs = new Map([...m[1]!.matchAll(ATTR)].map(a => [a[1]!, a[2]!] as const));
  const from = attrs.get('from'); const tool = attrs.get('tool');
  if (!from) return undefined;
  return [{ from, ...(tool ? { tool } : {}), text: m[2]!.replaceAll('<\\/ledge-message>', LEDGE_CLOSE).trim() }];
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
