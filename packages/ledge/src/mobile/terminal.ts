// An agent's terminal on the phone (spec 2026-11-02 mobile terminal): a tmux control client per open terminal, never a
// pseudo-terminal. It reads the pane's output, batches it within the relay's limits, and types what a phone that holds
// the hand sends. Logs carry counts and reasons, never a byte of the terminal.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { TERM_OUTPUT_MAX, TERM_SCREEN_MAX, type PhoneServerMessage, type TermExitWhy, type TermReleaseWhy } from '@ledge/protocol';

/** A batch leaves at most this often: ≤ 100 frames per 10 s, half the outbox's budget. */
export const TICK_MS = 100;
/** Past either, the waiting output is dropped and a fresh screen sent instead. */
export const BEHIND_CHARS = 262_144;
export const BEHIND_MS = 2_000;
/** A hold ends after this long without a key, and this long after it began. */
export const HOLD_IDLE_MS = 5 * 60_000;
export const HOLD_MAX_MS = 30 * 60_000;
/** An open that has not shown its first screen by then failed. */
const OPEN_TIMEOUT_MS = 5_000;
/** Bytes per `send-keys -H`: a paste of 4 096 characters goes as several commands. */
const KEYS_PER_COMMAND = 512;
/** How long a phone's keys wait for a delivery or a relay that is typing into the same session. */
const TYPING_WAIT_MS = 5_000;

/** `%output`'s payload: bytes below 32 and the backslash come as `\ooo`, the rest as they are. */
export function unescapeOutput(b: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i]!;
    if (c === 0x5c && i + 3 < b.length && isOctal(b[i + 1]!) && isOctal(b[i + 2]!) && isOctal(b[i + 3]!)) {
      out[j++] = ((b[i + 1]! - 0x30) << 6) | ((b[i + 2]! - 0x30) << 3) | (b[i + 3]! - 0x30);
      i += 3;
    } else out[j++] = c;
  }
  return out.subarray(0, j);
}
const isOctal = (c: number) => c >= 0x30 && c <= 0x37;

export type ControlEvent =
  | { kind: 'output'; pane: string; data: Buffer }
  /** tmux stopped sending a pane's output to this client (`pause-after`, or asked with `refresh-client -A %N:pause`): what the
   *  pane writes meanwhile is never sent; `continue` says it sends again (#297). */
  | { kind: 'pause'; pane: string }
  | { kind: 'continue'; pane: string }
  | { kind: 'layout'; cols: number; rows: number }
  | { kind: 'reply'; ok: boolean; lines: string[] }
  | { kind: 'exit' };

/** Splits a control client's stdout into its notifications and its command replies (`%begin` … `%end` or `%error`). */
export class ControlParser {
  private rest: Buffer = Buffer.alloc(0);
  /** The reply being read, and the `%begin` arguments its `%end` repeats. */
  private block: { tail: string; lines: string[] } | null = null;

  push(chunk: Uint8Array): ControlEvent[] {
    const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : Buffer.from(chunk);
    const events: ControlEvent[] = [];
    let start = 0;
    for (;;) {
      const nl = buf.indexOf(0x0a, start);
      if (nl < 0) break;
      let line = buf.subarray(start, nl);
      if (line[line.length - 1] === 0x0d) line = line.subarray(0, -1);
      start = nl + 1;
      this.line(line, events);
    }
    this.rest = Buffer.from(buf.subarray(start));
    return events;
  }

  private line(line: Buffer, events: ControlEvent[]): void {
    if (this.block) {
      const head = line.toString('latin1', 0, Math.min(line.length, 64));
      // Only the `%end` or `%error` with the same time, number and flags closes the reply: a pane line may start with "%end".
      if (head === `%end ${this.block.tail}` || head === `%error ${this.block.tail}`) {
        events.push({ kind: 'reply', ok: head.startsWith('%end'), lines: this.block.lines });
        this.block = null;
      } else this.block.lines.push(line.toString('utf8'));
      return;
    }
    if (startsWith(line, '%begin ')) { this.block = { tail: line.toString('latin1', 7), lines: [] }; return; }
    if (startsWith(line, '%output ')) {
      const sp = line.indexOf(0x20, 8);
      if (sp < 0) return;
      events.push({ kind: 'output', pane: line.toString('latin1', 8, sp), data: unescapeOutput(line.subarray(sp + 1)) });
      return;
    }
    // With `pause-after` set, output comes as `%extended-output %N <age> … : <data>`: what follows the first « : » is the payload.
    if (startsWith(line, '%extended-output ')) {
      const sp = line.indexOf(0x20, 17);
      const colon = line.indexOf(' : ', 17);
      if (sp < 0 || colon < 0) return;
      events.push({ kind: 'output', pane: line.toString('latin1', 17, sp), data: unescapeOutput(line.subarray(colon + 3)) });
      return;
    }
    if (startsWith(line, '%pause ')) { events.push({ kind: 'pause', pane: line.toString('latin1', 7).trim() }); return; }
    if (startsWith(line, '%continue ')) { events.push({ kind: 'continue', pane: line.toString('latin1', 10).trim() }); return; }
    if (startsWith(line, '%layout-change ')) {
      const m = /^%layout-change \S+ [0-9a-f]{4},(\d+)x(\d+),/.exec(line.toString('latin1'));
      if (m) events.push({ kind: 'layout', cols: Number(m[1]), rows: Number(m[2]) });
      return;
    }
    if (startsWith(line, '%exit')) events.push({ kind: 'exit' });
  }
}
const startsWith = (b: Buffer, s: string) => b.length >= s.length && b.toString('latin1', 0, s.length) === s;

/** A running control client. */
export interface ControlProcess {
  write(text: string): void;
  kill(): void;
  onData(fn: (chunk: Buffer) => void): void;
  onExit(fn: () => void): void;
}
export type SpawnControl = (argv: string[]) => ControlProcess;

/** One tmux control process: the reply queue and the parser. The phone and the desktop each batch and policy on top. */
export interface ControlClient {
  /**
   * Sends a command; resolves with its reply. `onReply` runs synchronously when the parser hands the reply out, before the events that
   * follow it in the same block of stdout: what comes after it (a pane's `%output`) is after the command in tmux's order, which an
   * awaited promise, resolved only once the whole block is handled, cannot tell (#296).
   */
  command(line: string, onReply?: (r: { ok: boolean; lines: string[] }) => void): Promise<{ ok: boolean; lines: string[] }>;
  write(text: string): void;
  kill(): void;
}

export function openControl(argv: string[], spawn: SpawnControl, onEvent: (e: Exclude<ControlEvent, { kind: 'reply' }>) => void): ControlClient {
  const proc = spawn(argv);
  const parser = new ControlParser();
  let closed = false;
  type Reply = { ok: boolean; lines: string[] };
  // The attach command's own reply comes first and belongs to nobody.
  const replies: Array<{ done: (r: Reply) => void; onReply?: (r: Reply) => void }> = [{ done: () => {} }];
  const fail = () => { for (const r of replies.splice(0)) r.done({ ok: false, lines: [] }); };
  proc.onData(chunk => {
    for (const e of parser.push(chunk)) {
      if (closed) return;
      if (e.kind === 'reply') {
        const r = replies.shift();
        r?.onReply?.(e);
        r?.done(e);
        continue;
      }
      onEvent(e);
    }
  });
  proc.onExit(() => {
    if (closed) return;
    closed = true;
    fail();
    onEvent({ kind: 'exit' });
  });
  return {
    command(line, onReply) {
      return new Promise(done => {
        if (closed) return done({ ok: false, lines: [] });
        replies.push({ done, ...(onReply ? { onReply } : {}) });
        proc.write(`${line}\n`);
      });
    },
    write(text) { if (!closed) proc.write(text); },
    kill() {
      if (closed) return;
      closed = true;
      fail();
      proc.kill();
    }
  };
}

export const spawnControl: SpawnControl = argv => {
  const p = spawn('tmux', argv, { stdio: ['pipe', 'pipe', 'ignore'] });
  let exited = false;
  const exits: Array<() => void> = [];
  const end = () => { if (exited) return; exited = true; for (const fn of exits) fn(); };
  p.on('exit', end);
  p.on('error', end);
  p.stdin.on('error', () => { /* the client is gone: its exit says so */ });
  return {
    write: text => { if (!exited) p.stdin.write(text); },
    kill: () => { p.kill(); },
    onData: fn => { p.stdout.on('data', (c: Buffer) => fn(c)); },
    onExit: fn => { exits.push(fn); }
  };
};

/** Hex bytes for `send-keys -H`, in commands of at most `KEYS_PER_COMMAND` bytes. */
export function keyCommands(target: string, data: string): string[] {
  const bytes = Buffer.from(data, 'utf8');
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += KEYS_PER_COMMAND) {
    const hex = [...bytes.subarray(i, i + KEYS_PER_COMMAND)].map(b => b.toString(16).padStart(2, '0')).join(' ');
    out.push(`send-keys -t ${target} -H ${hex}`);
  }
  return out;
}

/** The first screen, cut from the top so that it fits. */
export function fitScreen(lines: string[]): string {
  let screen = lines.join('\n');
  while (screen.length > TERM_SCREEN_MAX && lines.length > 1) { lines = lines.slice(1); screen = lines.join('\n'); }
  return screen.length > TERM_SCREEN_MAX ? screen.slice(-TERM_SCREEN_MAX) : screen;
}

/** The longest head of `s` that fits one `term.output` and never splits a surrogate pair. */
export function takeChunk(s: string): string {
  if (s.length <= TERM_OUTPUT_MAX) return s;
  let n = TERM_OUTPUT_MAX;
  const c = s.charCodeAt(n - 1);
  if (c >= 0xd800 && c <= 0xdbff) n -= 1;
  return s.slice(0, n);
}

export type HoldRefusal = 'unknown' | 'read_only' | 'conflict';

export interface TerminalHost {
  /** Starts streaming the session's pane to the device, ending the device's other terminal; the first screen answers `op`. */
  open(deviceId: string, op: string, session: { id: string; tmuxName: string; readOnly?: boolean }): string;
  /** The session a device's terminal shows, for the passkey's subject. */
  sessionOf(deviceId: string, tid: string): string | undefined;
  hold(deviceId: string, tid: string): HoldRefusal | null;
  input(deviceId: string, tid: string, n: number, data: string): void;
  release(deviceId: string, tid: string): void;
  resync(deviceId: string, tid: string): void;
  close(deviceId: string, tid: string): void;
  /** The app went to the background: its hold ends. */
  deviceHidden(deviceId: string): void;
  /** The device's channel fell or it was revoked: its terminal ends with nothing sent. */
  deviceGone(deviceId: string): void;
  /** The session ended: its terminals say so and end. */
  sessionEnded(sessionId: string): void;
  /** The PC takes the hand back on a session, or on every session (the setting turned off). */
  releaseSession(sessionId: string): void;
  releaseAll(): void;
  /** The device holding the session's input, if any. */
  holder(sessionId: string): string | undefined;
  stop(): void;
}

export interface TerminalDeps {
  /** The argv of `tmux … -C attach-session` on the session, read-only and never sizing its window. */
  controlArgs(tmuxName: string): string[] | null;
  spawn?: SpawnControl;
  send(deviceId: string, msg: PhoneServerMessage, key: string): void;
  /** Whether the outbox still holds the device's message with this key. */
  queued(deviceId: string, key: string): boolean;
  /** Why the terminal of a session ended on its own: its session ended, or only its tmux went. */
  exitWhy?(sessionId: string): TermExitWhy;
  /** The sessions something is typing into (deliveries, the chat relay): a phone's keys wait for them. */
  typing?: Set<string>;
  /** Someone started or stopped holding a session's input: the local fronts show it. */
  onHolder?(sessionId: string, deviceId: string | null): void;
  log(line: string): void;
  now?(): number;
}

interface Term {
  tid: string; deviceId: string; sessionId: string; tmuxName: string; readOnly: boolean;
  client: ControlClient;
  /** `capturing`: output is dropped until the screen is taken (it is in the screen); `pending`: the capture's reply is in, so what
   *  follows is after the screen: kept, sent once `term.opened` is; `live`: kept and sent. */
  state: 'capturing' | 'pending' | 'live' | 'closed';
  pane: string | null; cols: number; rows: number;
  decoder: StringDecoder; buffer: string; since: number | null;
  /** Output after the capture, before `display-message` says which pane the screen is (a first open, or a pane switched since the
   *  last screen), with the pane it came from: only the watched pane's bytes are kept once it is known. */
  early: Array<{ pane: string; data: Buffer }>;
  seq: number; nextN: number;
  held: { at: number; last: number } | null;
  /** The device's keys, typed in order. */
  typing: Promise<void>;
  timer: ReturnType<typeof setInterval>;
  openTimer: ReturnType<typeof setTimeout> | null;
}

/** tmux names Ledge gives its sessions (`ledge-<id>`): nothing a command line could misread. */
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

export function createTerminalHost(deps: TerminalDeps): TerminalHost {
  const now = deps.now ?? Date.now;
  const spawnIt = deps.spawn ?? spawnControl;
  const terms = new Map<string, Term>();
  const keyOf = (t: Term) => `term:${t.tid}`;
  const mine = (deviceId: string, tid: string) => { const t = terms.get(tid); return t && t.deviceId === deviceId && t.state !== 'closed' ? t : undefined; };
  const send = (t: Term, msg: PhoneServerMessage, key = keyOf(t)) => deps.send(t.deviceId, msg, key);

  const command = (t: Term, line: string) => t.client.command(line);

  const setHeld = (t: Term, held: Term['held']) => {
    const was = t.held !== null;
    t.held = held;
    if (was !== (held !== null)) deps.onHolder?.(t.sessionId, held ? t.deviceId : null);
  };

  const end = (t: Term, why: TermExitWhy | null) => {
    if (t.state === 'closed') return;
    if (t.held) setHeld(t, null);
    t.state = 'closed';
    clearInterval(t.timer);
    if (t.openTimer) clearTimeout(t.openTimer);
    terms.delete(t.tid);
    t.client.kill();
    if (why) send(t, { type: 'term.exit', tid: t.tid, why });
    deps.log(`phone terminal ${t.tid} ended (${why ?? 'dropped'})`);
  };

  const releaseHold = (t: Term, why: TermReleaseWhy) => {
    if (!t.held) return;
    setHeld(t, null);
    send(t, { type: 'term.released', tid: t.tid, why }, `term.hold:${t.tid}`);
    deps.log(`phone terminal ${t.tid} released (${why})`);
  };

  /** Takes the screen afresh: output before it is in it, output after it follows it. Answers `op` when an open asked. */
  const screen = async (t: Term, op?: string) => {
    t.state = 'capturing';
    t.buffer = '';
    t.since = null;
    t.early = [];
    t.decoder = new StringDecoder('utf8');
    const target = `'=${t.tmuxName}:'`;
    // Written together, the capture first, so tmux runs both before reading the pane again: the cursor is the captured screen's. The
    // capture's reply is the boundary (#296): from it, output is after the screen and kept, not dropped.
    const [cap, info] = await Promise.all([
      t.client.command(`capture-pane -p -e -t ${target}`, () => { if (t.state === 'capturing') t.state = 'pending'; }),
      command(t, `display-message -p -t ${target} '#{pane_id} #{pane_width} #{pane_height} #{cursor_x} #{cursor_y}'`)
    ]);
    // Ended while it waited: the awaits above widen nothing for TypeScript.
    if ((t.state as Term['state']) === 'closed') return;
    const m = info.ok ? /^(%\d+) (\d+) (\d+) (\d+) (\d+)$/.exec(info.lines[0] ?? '') : null;
    if (!m || !cap.ok) return end(t, 'failed');
    t.pane = m[1]!; t.cols = Number(m[2]); t.rows = Number(m[3]);
    // The output kept before the pane was known: only the watched pane's, in the order it came.
    for (const e of t.early.splice(0)) if (e.pane === t.pane) t.buffer += t.decoder.write(e.data);
    if (t.buffer) t.since ??= now();
    t.state = 'live';
    if (t.openTimer) { clearTimeout(t.openTimer); t.openTimer = null; }
    send(t, {
      type: 'term.opened', ...(op ? { op } : {}), tid: t.tid, id: t.sessionId, cols: t.cols, rows: t.rows,
      screen: fitScreen(cap.lines), cursor: { x: Number(m[4]), y: Number(m[5]) }, seq: t.seq, ...(t.readOnly ? { readOnly: true as const } : {})
    });
  };

  const onEvent = (t: Term, e: Exclude<ControlEvent, { kind: 'reply' }>) => {
    switch (e.kind) {
      case 'output': {
        if (t.state !== 'live' && t.state !== 'pending') return;
        // Between the capture's reply and display-message's, which pane is watched is not known yet (it may have changed since the
        // last screen): kept with its pane, sorted once it is.
        if (t.state === 'pending') { t.early.push({ pane: e.pane, data: e.data }); return; }
        if (e.pane !== t.pane) return;
        const text = t.decoder.write(e.data);
        if (!text) return;
        t.buffer += text;
        t.since ??= now();
        return;
      }
      case 'layout':
        if (t.state === 'closed' || (e.cols === t.cols && e.rows === t.rows)) return;
        t.cols = e.cols; t.rows = e.rows;
        if (t.state === 'live') send(t, { type: 'term.size', tid: t.tid, cols: e.cols, rows: e.rows }, `term.size:${t.tid}`);
        return;
      // The phone sets no `pause-after` (#297 is Desktop's): tmux never pauses its panes.
      case 'pause': case 'continue': return;
      case 'exit': return end(t, deps.exitWhy?.(t.sessionId) ?? 'gone');
    }
  };

  const tick = (t: Term) => {
    if (t.state === 'closed') return;
    const at = now();
    if (t.held && (at - t.held.last >= HOLD_IDLE_MS || at - t.held.at >= HOLD_MAX_MS)) releaseHold(t, at - t.held.at >= HOLD_MAX_MS ? 'expired' : 'idle');
    if (t.state !== 'live' || !t.buffer) return;
    if (t.buffer.length > BEHIND_CHARS || (t.since !== null && at - t.since > BEHIND_MS)) {
      deps.log(`phone terminal ${t.tid} behind (${t.buffer.length} chars): fresh screen`);
      void screen(t);
      return;
    }
    if (deps.queued(t.deviceId, keyOf(t))) return;
    const chunk = takeChunk(t.buffer);
    t.buffer = t.buffer.slice(chunk.length);
    t.since = t.buffer ? at : null;
    send(t, { type: 'term.output', tid: t.tid, seq: t.seq++, data: chunk });
  };

  /** Waits for whatever types into the session, then holds it while the keys go. */
  const typeKeys = async (t: Term, data: string) => {
    const lock = deps.typing;
    const deadline = now() + TYPING_WAIT_MS;
    while (lock?.has(t.sessionId) && now() < deadline && t.state !== 'closed') await new Promise(r => setTimeout(r, 50));
    if (t.state === 'closed' || !t.held || !t.pane || lock?.has(t.sessionId)) return;
    lock?.add(t.sessionId);
    try {
      for (const line of keyCommands(t.pane, data)) {
        const r = await command(t, line);
        if (!r.ok) { deps.log(`phone terminal ${t.tid}: keys refused by tmux`); return; }
      }
    } finally { lock?.delete(t.sessionId); }
  };

  return {
    open(deviceId, op, session) {
      for (const t of [...terms.values()]) if (t.deviceId === deviceId) end(t, 'superseded');
      const tid = `t_${randomBytes(12).toString('base64url')}`;
      const argv = SAFE_NAME.test(session.tmuxName) ? deps.controlArgs(session.tmuxName) : null;
      if (!argv || argv.length === 0) throw new Error('no control client for this session');
      let t!: Term;
      const client = openControl(argv, spawnIt, e => { if (t.state === 'closed') return; onEvent(t, e); });
      t = {
        tid, deviceId, sessionId: session.id, tmuxName: session.tmuxName, readOnly: !!session.readOnly, client,
        state: 'capturing', pane: null, cols: 0, rows: 0,
        decoder: new StringDecoder('utf8'), buffer: '', since: null, early: [], seq: 0, nextN: 0, held: null, typing: Promise.resolve(),
        timer: setInterval(() => tick(t), TICK_MS), openTimer: null
      };
      t.openTimer = setTimeout(() => { if (t.openTimer) end(t, 'failed'); }, OPEN_TIMEOUT_MS);
      terms.set(tid, t);
      deps.log(`phone terminal ${tid} opened for device ${deviceId}`);
      void screen(t, op);
      return tid;
    },
    sessionOf: (deviceId, tid) => mine(deviceId, tid)?.sessionId,
    hold(deviceId, tid) {
      const t = mine(deviceId, tid);
      if (!t) return 'unknown';
      if (t.readOnly) return 'read_only';
      for (const o of terms.values()) if (o !== t && o.sessionId === t.sessionId && o.held) return 'conflict';
      const at = now();
      setHeld(t, { at, last: at });
      send(t, { type: 'term.held', tid, until: new Date(at + HOLD_MAX_MS).toISOString() }, `term.hold:${tid}`);
      deps.log(`phone terminal ${tid} held`);
      return null;
    },
    input(deviceId, tid, n, data) {
      const t = mine(deviceId, tid);
      if (!t || !t.held) return;
      if (n < t.nextN) return;
      if (n > t.nextN) deps.log(`phone terminal ${tid}: ${n - t.nextN} input(s) missing`);
      t.nextN = n + 1;
      t.held.last = now();
      t.typing = t.typing.then(() => typeKeys(t, data)).catch(() => {});
    },
    release(deviceId, tid) { const t = mine(deviceId, tid); if (t) releaseHold(t, 'asked'); },
    resync(deviceId, tid) { const t = mine(deviceId, tid); if (t && t.state === 'live') void screen(t); },
    close(deviceId, tid) { const t = mine(deviceId, tid); if (t) end(t, null); },
    deviceHidden(deviceId) { for (const t of terms.values()) if (t.deviceId === deviceId) releaseHold(t, 'background'); },
    deviceGone(deviceId) { for (const t of [...terms.values()]) if (t.deviceId === deviceId) end(t, null); },
    sessionEnded(sessionId) { for (const t of [...terms.values()]) if (t.sessionId === sessionId) end(t, 'ended'); },
    releaseSession(sessionId) { for (const t of terms.values()) if (t.sessionId === sessionId) releaseHold(t, 'pc'); },
    releaseAll() { for (const t of terms.values()) releaseHold(t, 'pc'); },
    holder(sessionId) { for (const t of terms.values()) if (t.sessionId === sessionId && t.held) return t.deviceId; return undefined; },
    stop() { for (const t of [...terms.values()]) end(t, null); }
  };
}
