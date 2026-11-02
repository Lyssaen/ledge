import { z } from 'zod';

/**
 * OpenRig's messages in a seat's thread (docs/mockups/ledge-openrig-messages.html, validated 2026-11-02).
 *
 * OpenRig types its messages into a seat's terminal, so they reach Ledge as the seat's prompt. Each one is an envelope
 * (OpenRig's `wrapPaneEnvelope`, `@openrig/cli` 0.7):
 *
 *   From: <sender>            the seat (`pilot-lead@ledge-dev-2`), OpenRig itself (`daemon@kernel`, `system:*`), a person
 *   To: <recipient>           through Ledge (`ledge@external`), or `<unknown sender>`; To may be a list or `broadcast to …`
 *   Sent: MM-DD HH:MMZ · gen <8 hex> · delivered +Ns      (the line, the gen and the delay are each optional)
 *   ---
 *   <body>                    any lines
 *   ---
 *   ↩ Reply: rig send <sender> "..."   |   ↩ Sent by OpenRig itself, not by a seat. Act on the row it names.
 *                                      |   ↩ Reply if needed: rig queue create --destination <sender> … --verify
 *
 * A wake that may be delivered twice starts with `Recovered queue notification: …`, and OpenRig joins several waiting
 * envelopes with a newline. `parseRigPrompt` reads that text once, in the daemon, which puts the result on the thread
 * items (`rig`, below): no client reads the text again.
 *
 * `gen` is the sender's occupant generation, shared by all of its messages: it does not name a message. A repeated
 * delivery is the same sender, recipient, stamp, gen and body (`rigKey`).
 */

/** A queue row's id: `qitem-20261102190205-c0704682203041b9`, `qitem-recovery-a665841e4deeba48`. */
export const QitemIdSchema = z.string().regex(/^qitem-[A-Za-z0-9-]{1,120}$/, 'not a qitem');
const QITEM = 'qitem-[A-Za-z0-9-]+';

/** What an OpenRig block is.
 *  - `message`: a seat's `rig send`, a received bubble (or a sent one, from the seat's own Bash call);
 *  - `handoff`: a queue row handed to this seat (`Queue handoff: …`), or passed by it (its own `rig queue handoff|create`);
 *  - `unblocked`: a row this seat had parked is pending again (`Blocker … resolved; parked qitem … is pending`);
 *  - `openrig`: OpenRig's own notice (`daemon@kernel`, `system:*`, or the `[OpenRig …]` note a scheduler appends);
 *  - `unreadable`: starts like an envelope but does not read to its end: shown as is, never as the user's words. */
export const RigKindSchema = z.enum(['message', 'handoff', 'unblocked', 'openrig', 'unreadable']);
export type RigKind = z.infer<typeof RigKindSchema>;

/**
 * The OpenRig side of a thread item (`received`, `sent`, `notice`). Absent: not an OpenRig block. An older front that does
 * not know the field shows the item as it shows any other of its kind.
 */
export const RigInfoSchema = z.object({
  kind: RigKindSchema,
  /** The envelope's From, as written (`pilot-lead@ledge-dev-2`, `daemon@kernel`, `ledge@external`, `<unknown sender>`).
   *  On the seat's own `sent`: absent (it is the seat). The item's `peer` is the Ledge session of that seat, when known. */
  from: z.string().optional(),
  /** The envelope's To, as written (a seat, a list `a, b`, or `broadcast to <rig> (n seats)`); on an outgoing item, the
   *  destination the command named. */
  to: z.string().optional(),
  /** The envelope's `Sent:` stamp as an ISO time (OpenRig gives no year: the year of receipt, or the year before when
   *  that would put it in the future). Absent when the envelope has no `Sent:` line. */
  sentAt: z.string().datetime().optional(),
  /** The sender's generation (8 hex), when the stamp carries one. */
  gen: z.string().optional(),
  /** The row the item is about. `handoff`: the row handed (outgoing: the new row, when the command's output names it);
   *  `unblocked`: the parked row now pending; `openrig`: the row it names (a stuck sweep: the stalled row). */
  qitem: QitemIdSchema.optional(),
  /** `handoff`: the row's summary as OpenRig carried it (one line, at most 120 characters, `…` when cut). */
  summary: z.string().optional(),
  /** `unblocked`: the row whose closing unblocked it. */
  blocker: QitemIdSchema.optional(),
  /** `openrig`: the recovery row OpenRig opened for it (a stuck sweep comes as a handoff of a `qitem-recovery-…` row). */
  recovery: QitemIdSchema.optional(),
  /** `openrig`: `stalled` a stuck sweep (a seat that does not move: amber), `custody` a custody check; else absent. */
  alert: z.enum(['stalled', 'custody']).optional(),
  /** `openrig` with an alert: how long, in minutes, as OpenRig said. */
  minutes: z.number().int().nonnegative().optional(),
  /** The seat's own command (an outgoing `sent` or `handoff`): the Bash command, as run. */
  command: z.string().optional(),
  /** OpenRig said the delivery may repeat (`Recovered queue notification`). */
  recovered: z.literal(true).optional(),
  /** Received that many times (2 or more): the same block came again, and this item stands for all of them. */
  count: z.number().int().min(2).optional(),
  /** Blocks pasted together in one prompt: the prompt's id, this block's place and how many there were. The front shows
   *  one raw for the packet, the raws of its items joined. */
  packet: z.object({ id: z.string().min(1), index: z.number().int().nonnegative(), count: z.number().int().min(2) }).optional(),
  /** The block exactly as received (every delivery, separated by a blank line, when `count` is set); outgoing: the command
   *  and what it printed. Always there. */
  raw: z.string()
});
export type RigInfo = z.infer<typeof RigInfoSchema>;

/** One block read from a prompt. `text`: words around the envelopes that are not OpenRig's: the user's own, shown as theirs. */
export type RigBlock =
  | { kind: 'text'; text: string }
  | { kind: 'unreadable'; raw: string }
  | { kind: 'message' | 'handoff' | 'unblocked' | 'openrig'; raw: string; from?: string; to?: string; sentAt?: string; gen?: string; body: string;
      qitem?: string; summary?: string; blocker?: string; recovery?: string; alert?: 'stalled' | 'custody'; minutes?: number; recovered?: true };

const isOpenRigSender = (from: string): boolean => from === 'daemon@kernel' || from.startsWith('system:');

/** The `↩` footers OpenRig writes; what follows one on its line is something else glued to it. */
const FOOTERS = [
  /^↩ Reply: rig send \S+(?: \S+)* "\.\.\."/,
  /^↩ Sent by OpenRig itself, not by a seat\. Act on the row it names\./,
  /^↩ Reply if needed: rig queue create .*?--verify/
];
const RECOVERED = /^Recovered queue notification: .*$/;
const SENT = /^Sent: (\d\d)-(\d\d) (\d\d):(\d\d)Z(?: · gen ([0-9a-f]+))?(?: · delivered \+\d+s)?$/;
const HANDOFF = new RegExp(`^Queue handoff: (${QITEM}) - check your queue\\.(?: Summary: (.*))?$`);
const BLOCKER = new RegExp(`^Blocker (${QITEM}) resolved; parked qitem (${QITEM}) is pending\\.`);
const STALLED = new RegExp(`^Stuck sweep: \\S+ on (${QITEM}) \\((\\d+) min\\)`);
const CUSTODY = new RegExp(`^Custody not checked\\b.*?(?:for |of )(${QITEM}).*?\\((\\d+) min\\)`);

/** `MM-DD HH:MM` (UTC) as an ISO time, in the year of `at` (or the one before, when that is more than a day after `at`). */
function stamp(m: RegExpExecArray, at: string): string | undefined {
  const ref = new Date(at);
  if (Number.isNaN(ref.getTime())) return undefined;
  const [mo, d, h, mi] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  let t = Date.UTC(ref.getUTCFullYear(), mo - 1, d, h, mi);
  if (t - ref.getTime() > 86_400_000) t = Date.UTC(ref.getUTCFullYear() - 1, mo - 1, d, h, mi);
  const out = new Date(t);
  return out.getUTCMonth() === mo - 1 && out.getUTCDate() === d ? out.toISOString() : undefined;
}

/** What a complete envelope's body says. */
function classify(from: string, footer: string, body: string): Omit<Extract<RigBlock, { body: string }>, 'raw' | 'from' | 'to' | 'sentAt' | 'gen' | 'body'> {
  const line = body.trim();
  const handoff = HANDOFF.exec(line);
  if (isOpenRigSender(from) || footer.startsWith('↩ Sent by OpenRig itself')) {
    const said = handoff?.[2] ?? line;
    const stalled = STALLED.exec(said), custody = stalled ? null : CUSTODY.exec(said);
    const alert = stalled ? { alert: 'stalled' as const, qitem: stalled[1]!, minutes: Number(stalled[2]) }
      : custody ? { alert: 'custody' as const, qitem: custody[1]!, minutes: Number(custody[2]) } : {};
    return { kind: 'openrig', ...(handoff ? { recovery: handoff[1]! } : {}), ...(!('qitem' in alert) && handoff ? { qitem: handoff[1]! } : {}), ...alert, ...(handoff?.[2] ? { summary: handoff[2] } : {}) };
  }
  if (handoff) return { kind: 'handoff', qitem: handoff[1]!, ...(handoff[2] ? { summary: handoff[2] } : {}) };
  const blocker = BLOCKER.exec(line);
  if (blocker) return { kind: 'unblocked', blocker: blocker[1]!, qitem: blocker[2]! };
  return { kind: 'message' };
}

/** The `<pasted_content …>` lines Claude Code puts around a pasted prompt. */
const PASTE_TAG = /^<\/?pasted_content(?: [^>]*)?>$/;

/** An envelope starts here: a `From:` line, then a `To:` line. */
const startsEnvelope = (lines: string[], i: number): boolean => lines[i]!.startsWith('From: ') && (lines[i + 1] ?? '').startsWith('To: ');

/**
 * Reads a seat's prompt. Returns its blocks in order, or undefined when it holds no OpenRig envelope (a prompt of the
 * user's). `at`: when it was received, to date the stamps.
 *
 * - An envelope that does not read to its `↩` footer is `unreadable` up to the next envelope (or the end); but a prompt
 *   that opens on the user's own words and has no complete envelope is the user's prompt (undefined).
 * - Words before, between or after the envelopes are `text` (the user's), except the `[OpenRig …]` note a scheduler
 *   appends, which is an `openrig` notice.
 * - `Recovered queue notification` marks the envelope after it `recovered`.
 */
export function parseRigPrompt(prompt: string, at: string): RigBlock[] | undefined {
  const lines = prompt.split('\n').filter(l => !PASTE_TAG.test(l.trim()));
  const first = lines.findIndex(l => l.trim() !== '');
  if (first < 0) return undefined;
  const opensOnEnvelope = startsEnvelope(lines, first) || (RECOVERED.test(lines[first]!) && first + 1 < lines.length && startsEnvelope(lines, first + 1));
  if (!opensOnEnvelope && !lines.some((_, i) => startsEnvelope(lines, i))) return undefined;

  const out: RigBlock[] = [];
  let loose: string[] = [];
  let recovered = false;
  const flush = () => {
    const text = loose.join('\n').trim();
    loose = [];
    if (!text) return;
    if (text.startsWith('[OpenRig ')) out.push({ kind: 'openrig', raw: text, body: text });
    else out.push({ kind: 'text', text });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (RECOVERED.test(line) && i + 1 < lines.length && startsEnvelope(lines, i + 1)) { flush(); recovered = true; i++; continue; }
    if (!startsEnvelope(lines, i)) { loose.push(line); i++; continue; }
    flush();
    const start = i;
    const from = line.slice('From: '.length).trim(), to = lines[i + 1]!.slice('To: '.length).trim();
    let j = i + 2;
    const sent = j < lines.length ? SENT.exec(lines[j]!) : null;
    if (sent) j++;
    // the body: from the `---` after the header to the `---` right before a footer
    let end = -1, footer = '', glued = '';
    if (lines[j] === '---') {
      for (let k = j + 1; k + 1 < lines.length; k++) {
        if (startsEnvelope(lines, k)) break; // the next envelope: this one has no end
        if (lines[k] !== '---' || !lines[k + 1]!.startsWith('↩ ')) continue;
        const f = lines[k + 1]!;
        const m = FOOTERS.map(re => re.exec(f)).find(Boolean);
        footer = m ? m[0] : f; glued = m ? f.slice(m[0].length) : '';
        end = k;
        break;
      }
    }
    if (end < 0) { // not to its end: up to the next envelope
      let k = i + 1;
      while (k < lines.length && !startsEnvelope(lines, k) && !(RECOVERED.test(lines[k]!) && k + 1 < lines.length && startsEnvelope(lines, k + 1))) k++;
      if (!opensOnEnvelope && out.every(b => b.kind === 'text')) return undefined; // the user's words, then something that only looks like an envelope
      out.push({ kind: 'unreadable', raw: lines.slice(start, k).join('\n').trimEnd() });
      recovered = false; i = k; continue;
    }
    const body = lines.slice(j + 1, end).join('\n');
    const raw = [...lines.slice(start, end + 1), footer].join('\n');
    const sentAt = sent ? stamp(sent, at) : undefined;
    out.push({ ...classify(from, footer, body), raw, from, to, ...(sentAt ? { sentAt } : {}), ...(sent?.[5] ? { gen: sent[5] } : {}), body, ...(recovered ? { recovered: true as const } : {}) });
    recovered = false;
    i = end + 2;
    if (glued.trim()) loose.push(glued);
  }
  flush();
  if (!out.some(b => b.kind !== 'text')) return undefined;
  return out;
}

/** What makes two received blocks the same delivery: sender, recipient, stamp, generation and body. Undefined for a
 *  block without stamp (nothing tells two such messages apart from one repeated). */
export function rigKey(b: { from?: string; to?: string; sentAt?: string; gen?: string; body?: string }): string | undefined {
  if (!b.sentAt || b.from === undefined || b.body === undefined) return undefined;
  return JSON.stringify([b.from, b.to ?? '', b.sentAt, b.gen ?? '', b.body]);
}

/** The seat's own OpenRig command in a Bash call, when the call is only that (optionally after `cd <dir> &&`):
 *  `rig send <to> "<body>" …` or `rig queue handoff <qitem> --to <to> …` / `rig queue create --destination <to> …`.
 *  `body`: the message (a send) or the --body (a row), when given inline; `summary`: --summary. */
export type RigCommand =
  | { kind: 'message'; to: string; body?: string }
  | { kind: 'handoff'; op: 'handoff' | 'create'; to: string; from?: string; summary?: string; body?: string };

/** Splits a shell command into words: single and double quotes, backslash escapes. Undefined on what it does not read
 *  as one plain command (an unclosed quote, a pipe, `;`, a substitution, a redirection, a heredoc). `&&` is kept as a word. */
function words(cmd: string): string[] | undefined {
  const out: string[] = [];
  let cur = '', has = false, i = 0;
  while (i < cmd.length) {
    const c = cmd[i]!;
    if (c === "'") { const e = cmd.indexOf("'", i + 1); if (e < 0) return undefined; cur += cmd.slice(i + 1, e); has = true; i = e + 1; continue; }
    if (c === '"') {
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '$' || cmd[i] === '`') return undefined;
        if (cmd[i] === '\\' && i + 1 < cmd.length && '"\\$`\n'.includes(cmd[i + 1]!)) { if (cmd[i + 1] !== '\n') cur += cmd[i + 1]; i += 2; continue; }
        cur += cmd[i]; i++;
      }
      if (i >= cmd.length) return undefined;
      has = true; i++; continue;
    }
    if (c === '\\' && i + 1 < cmd.length) { if (cmd[i + 1] !== '\n') cur += cmd[i + 1]; has = true; i += 2; continue; }
    if (c === ' ' || c === '\t' || c === '\n') { if (has) { out.push(cur); cur = ''; has = false; } i++; continue; }
    if (c === '&' && cmd[i + 1] === '&') { if (has) { out.push(cur); cur = ''; has = false; } out.push('&&'); i += 2; continue; }
    if ('|;<>`$&(){}'.includes(c)) return undefined;
    cur += c; has = true; i++;
  }
  if (has) out.push(cur);
  return out;
}

/** The value of `--name <v>` or `--name=<v>` (the last one given). */
function option(args: string[], name: string): string | undefined {
  let v: string | undefined;
  args.forEach((a, k) => { if (a === name && k + 1 < args.length) v = args[k + 1]; else if (a.startsWith(`${name}=`)) v = a.slice(name.length + 1); });
  return v;
}
/** rig send's options that take a value. */
const SEND_VALUED = new Set(['--to', '--pod', '--rig', '--wait-for-idle', '--reason', '--host', '--from', '--context']);

export function rigCommand(command: string): RigCommand | undefined {
  let w = words(command.trim());
  if (!w || w.length < 2) return undefined;
  if (w[0] === 'cd' && w[2] === '&&') w = w.slice(3);
  if (w.includes('&&') || w[0] !== 'rig') return undefined;
  if (w[1] === 'send') {
    const args = w.slice(2);
    const positional: string[] = [];
    for (let k = 0; k < args.length; k++) {
      const a = args[k]!;
      if (a.startsWith('--')) { if (SEND_VALUED.has(a)) k++; continue; }
      positional.push(a);
    }
    if (args.includes('--raw') || args.includes('--dangerously-interact')) return undefined; // keystrokes, not a message
    const fanOut = option(args, '--to') ?? option(args, '--pod') ?? option(args, '--rig');
    const to = fanOut ?? positional[0];
    if (!to) return undefined;
    const body = fanOut ? positional[0] : positional[1];
    return { kind: 'message', to, ...(body !== undefined ? { body } : {}) };
  }
  if (w[1] === 'queue' && (w[2] === 'handoff' || w[2] === 'create')) {
    const args = w.slice(3);
    const to = w[2] === 'handoff' ? option(args, '--to') : option(args, '--destination');
    if (!to) return undefined;
    const from = w[2] === 'handoff' ? args.find(a => /^qitem-/.test(a)) : undefined;
    const summary = option(args, '--summary'), body = option(args, '--body');
    return { kind: 'handoff', op: w[2], to, ...(from ? { from } : {}), ...(summary ? { summary } : {}), ...(body && body !== '-' ? { body } : {}) };
  }
  return undefined;
}

/** What the command printed, read: `failed` when it failed or `rig send` kept the message (`Retained, not delivered`),
 *  else `delivered`; and the row a handoff or a create made (the first queue id in its output that is not the handed one). */
export function rigCommandResult(cmd: RigCommand, output: string, failed: boolean): { status: 'delivered' | 'failed'; qitem?: string } {
  if (cmd.kind === 'message') return { status: failed || /^Retained, not delivered\b/m.test(output) ? 'failed' : 'delivered' };
  const ids = [...output.matchAll(new RegExp(QITEM, 'g'))].map(m => m[0]).filter(id => id !== cmd.from);
  return { status: failed ? 'failed' : 'delivered', ...(!failed && ids[0] ? { qitem: ids[0] } : {}) };
}

// ── A queue row's state, read live (decision 2: re-read every 30 s while its card is visible) ──

/** How often a front asks again for a visible card's row; the daemon answers from what it read less than that ago. */
export const RIG_ROW_REFRESH_MS = 30_000;

/** A queue row as OpenRig reports it (`rig queue show <id> --json`). `state`: OpenRig's own word (`pending`,
 *  `in-progress`, `handed-off`, `blocked`, `done`…), shown as is when the front does not know it. */
export const RigRowSchema = z.object({
  id: QitemIdSchema, state: z.string().min(1), summary: z.string().optional(),
  /** Who made it and who holds it (seats). */ from: z.string(), to: z.string(),
  /** `handed-off`: the seat it went to. */ handedOffTo: z.string().optional(),
  /** `blocked`: the row it waits on. */ blockedOn: z.string().optional(),
  createdAt: z.string(), claimedAt: z.string().optional(), updatedAt: z.string(),
  /** When Ledge read it. */ at: z.string()
});
export type RigRow = z.infer<typeof RigRowSchema>;

/** A front asks a machine for a row's state. */
export const OpenRigRowSchema = z.object({ type: z.literal('openrig.row'), requestId: z.string().min(1).max(100), qitem: QitemIdSchema, machineId: z.string().optional() });
/** The row, or why not: `not_found` (no such row), `not_installed`, `daemon_stopped`, `failed` (rig said something else),
 *  the fleet's `offline` / `outdated`. Without `row`, the card says « état non suivi ». */
export const OpenRigRowStateSchema = z.object({
  type: z.literal('openrig.rowState'), requestId: z.string(), machineId: z.string().optional(), qitem: z.string(),
  row: RigRowSchema.optional(), error: z.string().optional()
});
export type OpenRigRow = z.infer<typeof OpenRigRowSchema>;
export type OpenRigRowState = z.infer<typeof OpenRigRowStateSchema>;
