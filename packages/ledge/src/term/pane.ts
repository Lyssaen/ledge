// The desktop's terminals: one tmux control client per watcher, on the session's machine. xterm.js is the only emulator.
// A shell is its own short session (`owned`): closing it kills that session and never takes the agent's typing lock.
// The phone uses the same control client and keeps its own batching. Logs carry reasons, never a byte of the pane.
import { PaneExitWhy, type TermModes, TERM_CHUNK, TERM_CHUNK_B64, TERM_PANE_SCREEN_MAX } from '@ledge/protocol';
import { NO_SIZE, SIZE_MARK, dimsOf, keptOf, markOf, optionValue, restoreCommands, type KeptWindow } from './windowSize.js';
import { keyCommands, openControl, spawnControl, type ControlClient, type ControlEvent, type SpawnControl } from '../mobile/terminal.js';

/** A batch leaves at the first of this and `TERM_CHUNK` bytes. Desktop has no relay budget to stay under. */
const TICK_MS = 16;
/** Past this, what is waiting is dropped and a fresh screen is sent. */
const BEHIND_BYTES = 262_144;
const OPEN_TIMEOUT_MS = 5_000;
const RESTORE_MS = 20;

type PaneMsg =
  | { type: 'term.opened'; id: string; shell?: string; cols: number; rows: number; screen: string; cursor: { x: number; y: number }; modes?: TermModes; nonce?: string }
  | { type: 'term.output'; id: string; shell?: string; data: string }
  | { type: 'term.size'; id: string; shell?: string; cols: number; rows: number }
  | { type: 'term.exit'; id: string; shell?: string; why: PaneExitWhy };

export interface PaneReply { (msg: PaneMsg): void }

/** `nonce`: a free shell's integration key (#299), sent with each screen so the front can tell the shell's own marks. */
export interface PaneSession { id: string; tmuxName: string; shell?: string; owned?: boolean; nonce?: string }

export interface PaneHost {
  /** `size` null: read-only, the pane's size stays whatever it is. A new watch replaces only the same shell of the same session. */
  watch(reply: PaneReply, session: PaneSession, size: { cols: number; rows: number } | null): void;
  input(reply: PaneReply, id: string, data: string, shell?: string): void;
  resize(reply: PaneReply, id: string, cols: number, rows: number, shell?: string): void;
  /** The front closed one screen. No `shell`: the harness pane of `id`. */
  unwatch(reply: PaneReply, id: string, shell?: string): void;
  /** The socket closed: every watch on it ends. An owned shell is told `gone`. */
  release(reply: PaneReply): void;
  /** The session is gone: every watcher of it is told `ended`. */
  drop(sessionId: string): void;
  stop(): void;
}

export interface PaneDeps {
  controlArgs(tmuxName: string): string[] | null;
  spawn?: SpawnControl;
  /** Sessions something is already typing into: a watcher's keys wait, then hold the same set. Shells do not. */
  typing?: Set<string>;
  /** An owned shell's tmux session, killed when its watch ends. */
  killSession?(tmuxName: string): void;
  log(line: string): void;
  now?: () => number;
  timer?: (fn: () => void, ms: number) => { stop(): void };
}

/** A Ledge session (`ledge-<id>`, `sh-<hex>`) or an OpenRig seat (`pod-member@rig`); the target is quoted, `@` included. */
const SAFE_NAME = /^[A-Za-z0-9_.-]+(?:@[A-Za-z0-9_.-]+)?$/;
/** The pane's place and size, then the modes xterm cannot see once the program set them before the watch. */
const INFO_FORMAT = '#{pane_id} #{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{alternate_on}#{cursor_flag}#{keypad_cursor_flag}#{keypad_flag}#{mouse_standard_flag}#{mouse_button_flag}#{mouse_any_flag}#{mouse_sgr_flag}#{wrap_flag}#{insert_flag}';
const INFO = /^(%\d+) (\d+) (\d+) (\d+) (\d+)(?: ([01]{10}))?$/;

/** The flags `INFO_FORMAT` prints, in its order. `paste` is the caller's: tmux does not say. */
export function modesOf(flags: string | undefined, paste: boolean): TermModes | undefined {
  if (!flags) return undefined;
  const f = (i: number) => flags[i] === '1';
  const mouse = f(6) ? 'any' : f(5) ? 'button' : f(4) ? 'standard' : 'none';
  return { alt: f(0), cursor: f(1), appCursor: f(2), appKeypad: f(3), mouse, sgr: f(7), wrap: f(8), insert: f(9), ...(paste ? { paste: true } : {}) };
}
const targetOf = (name: string) => `'=${name}:'`;

interface Watch {
  reply: PaneReply; id: string; shell: string; tmuxName: string; sizing: boolean; owned: boolean; lock: boolean; nonce?: string;
  client: ControlClient;
  /** `capturing`: output is dropped (it is in the screen being taken); `pending`: the capture's reply is in, so what follows is after
   *  the screen: kept, sent once `term.opened` is; `live`: kept and sent. */
  state: 'capturing' | 'pending' | 'live' | 'closed';
  pane: string | null; cols: number; rows: number;
  /** The grid the watcher asked for. `cols`/`rows` are what the pane last reported. */
  want: { cols: number; rows: number } | null;
  buffer: Buffer; since: number | null;
  /** Output after the capture, before `display-message` says which pane the screen is (a first open, or a pane switched since the
   *  last screen), with the pane it came from: a window may have several, and only the watched one's bytes are kept once known. */
  early: Array<{ pane: string; data: Buffer }>;
  queued: string[]; typing: Promise<void>;
  timer: { stop(): void }; openTimer: { stop(): void } | null;
}

/** The longest head of `buf` that fits one frame and does not split a UTF-8 character. */
export function takeBytes(buf: Buffer): Buffer {
  if (buf.length <= TERM_CHUNK) return buf;
  let n = TERM_CHUNK;
  while (n > 0 && (buf[n]! & 0xc0) === 0x80) n--;
  return buf.subarray(0, n === 0 ? TERM_CHUNK : n);
}

export function createPaneHost(deps: PaneDeps): PaneHost {
  const now = deps.now ?? Date.now;
  const spawnIt = deps.spawn ?? spawnControl;
  const timer = deps.timer ?? ((fn: () => void, ms: number) => {
    const id = setInterval(fn, ms);
    return { stop: () => clearInterval(id) };
  });
  /** One shot, unlike `timer`: a restore or an open deadline must not repeat. */
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    return { stop: () => clearTimeout(id) };
  };
  const watches = new Set<Watch>();
  /** How many sizing watchers a tmux session has. The last one to leave gives the window back to whatever attaches. */
  const sizing = new Map<string, number>();
  const find = (reply: PaneReply, id: string, shell = '') => [...watches].find(w => w.reply === reply && w.id === id && w.shell === shell && w.state !== 'closed');

  /** The window's own `window-size` (`NO_SIZE` for none) and its dimensions before Ledge held it, read once per hold: a second
   *  watch waits for the first one's read, so it never takes Ledge's `manual` and size for the window's own. */
  const kept = new Map<string, Promise<KeptWindow>>();
  const keep = (w: Watch, target: string): Promise<KeptWindow> => {
    let k = kept.get(w.tmuxName);
    if (!k) {
      k = (async () => {
        // A mark already there is a hold a dead daemon left: what it keeps is still the window's own, so it stays.
        const mark = await w.client.command(`show-options -wq -t ${target} ${SIZE_MARK}`);
        const left = mark.ok ? optionValue(mark.lines, SIZE_MARK) : null;
        if (left !== null) return keptOf(left);
        const [cur, dims] = await Promise.all([
          w.client.command(`show-options -wq -t ${target} window-size`),
          w.client.command(`display-message -p -t ${target} '#{window_width}x#{window_height}'`)
        ]);
        const own: KeptWindow = { ...keptOf(cur.ok ? optionValue(cur.lines, 'window-size') : null), ...(dims.ok ? dimsOf(dims.lines[0]) ?? {} : {}) };
        await w.client.command(`set-option -w -t ${target} ${SIZE_MARK} ${markOf(own)}`);
        return own;
      })();
      kept.set(w.tmuxName, k);
    }
    return k;
  };
  const hold = (name: string) => sizing.set(name, (sizing.get(name) ?? 0) + 1);
  const releaseSize = (name: string): boolean => {
    const n = (sizing.get(name) ?? 1) - 1;
    if (n <= 0) { sizing.delete(name); return true; }
    sizing.set(name, n);
    return false;
  };

  const stamp = (w: Watch, msg: PaneMsg): PaneMsg => (w.shell ? { ...msg, shell: w.shell } : msg);
  const send = (w: Watch, msg: PaneMsg) => { if (w.state !== 'closed' || msg.type === 'term.exit') w.reply(stamp(w, msg)); };

  const end = (w: Watch, why: PaneExitWhy | null) => {
    if (w.state === 'closed') return;
    w.state = 'closed';
    w.timer.stop();
    w.openTimer?.stop();
    watches.delete(w);
    const restore = w.sizing && releaseSize(w.tmuxName);
    const own = restore ? kept.get(w.tmuxName) : undefined;
    if (restore) kept.delete(w.tmuxName);
    if (w.owned) { deps.killSession?.(w.tmuxName); w.client.kill(); }
    else if (own && SAFE_NAME.test(w.tmuxName)) {
      // The window gets back its dimensions and the size it had of its own (none, or the person's), then the mark goes. The commands have to leave
      // the process before it is killed. A window never held (the watch ended before it was sized) has nothing to give back.
      const target = targetOf(w.tmuxName);
      void own.catch((): KeptWindow => ({ size: NO_SIZE })).then(k => {
        for (const line of restoreCommands(target, k)) w.client.write(`${line}\n`);
        later(() => w.client.kill(), RESTORE_MS);
      });
    } else {
      // A read of the window's own size may still be going through this client, and another watch waits on it: let it finish.
      const reading = w.sizing && !w.owned ? kept.get(w.tmuxName) : undefined;
      if (reading) void reading.catch(() => undefined).then(() => w.client.kill()); else w.client.kill();
    }
    if (why) w.reply(stamp(w, { type: 'term.exit', id: w.id, why }));
    deps.log(`pane ${w.id}${w.shell ? ` shell ${w.shell}` : ''} ended (${why ?? 'closed'})`);
  };

  const flush = (w: Watch) => {
    if (w.state !== 'live' || w.buffer.length === 0) return;
    if (w.buffer.length > BEHIND_BYTES || (w.since !== null && now() - w.since > 2_000)) {
      deps.log(`pane ${w.id} behind (${w.buffer.length} bytes): fresh screen`);
      w.buffer = Buffer.alloc(0); w.since = null;
      void screen(w);
      return;
    }
    const chunk = takeBytes(w.buffer);
    w.buffer = w.buffer.subarray(chunk.length);
    w.since = w.buffer.length ? now() : null;
    // One frame stays under the schema: a character walked back still fits.
    const data = Buffer.from(chunk).toString('base64');
    if (data.length <= TERM_CHUNK_B64) send(w, { type: 'term.output', id: w.id, data });
  };

  const screen = async (w: Watch) => {
    if (w.state === 'closed') return;
    w.state = 'capturing';
    w.buffer = Buffer.alloc(0); w.since = null; w.early = [];
    const target = targetOf(w.tmuxName);
    let sized: { cols: number; rows: number } | null = null;
    if (w.sizing && w.want) {
      // A shell born here is killed when its watch ends: there is no size of its own to give back.
      if (!w.owned) {
        await keep(w, target);
        if ((w.state as Watch['state']) === 'closed') return;
      }
      const set = await w.client.command(`set-option -w -t ${target} window-size manual`);
      if ((w.state as Watch['state']) === 'closed') return;
      sized = { ...w.want };
      if (set.ok) await w.client.command(`resize-window -x ${sized.cols} -y ${sized.rows} -t ${target}`);
      if ((w.state as Watch['state']) === 'closed') return;
    }
    // Written together, so tmux runs both before reading the pane again: the cursor is the one of the captured screen. The capture's
    // reply is the boundary (#296): from it, output is after the screen and kept, not dropped.
    const [cap, info] = await Promise.all([
      w.client.command(`capture-pane -p -e -t ${target}`, () => { if (w.state === 'capturing') w.state = 'pending'; }),
      w.client.command(`display-message -p -t ${target} '${INFO_FORMAT}'`)
    ]);
    if ((w.state as Watch['state']) === 'closed') return;
    const m = info.ok ? INFO.exec(info.lines[0] ?? '') : null;
    if (!m || !cap.ok) return end(w, 'failed');
    w.pane = m[1]!; w.cols = Number(m[2]); w.rows = Number(m[3]);
    // The output kept before the pane was known: only the watched pane's, in the order it came.
    for (const e of w.early.splice(0)) if (e.pane === w.pane) w.buffer = w.buffer.length ? Buffer.concat([w.buffer, e.data]) : e.data;
    if (w.buffer.length) w.since ??= now();
    let lines = cap.lines;
    let text = lines.join('\n');
    while (text.length > TERM_PANE_SCREEN_MAX && lines.length > 1) { lines = lines.slice(1); text = lines.join('\n'); }
    if (text.length > TERM_PANE_SCREEN_MAX) text = text.slice(-TERM_PANE_SCREEN_MAX);
    w.state = 'live';
    w.openTimer?.stop(); w.openTimer = null;
    const modes = modesOf(m[6], !w.owned);
    send(w, { type: 'term.opened', id: w.id, cols: w.cols, rows: w.rows, screen: text, cursor: { x: Number(m[4]), y: Number(m[5]) }, ...(modes ? { modes } : {}), ...(w.nonce ? { nonce: w.nonce } : {}) });
    // What tmux sent after the capture, kept while the screen was answered, follows the screen at once.
    flush(w);
    // A resize that arrived while the screen was taken: the capture shows the old grid, so the window follows now.
    if (w.want && sized && (w.want.cols !== sized.cols || w.want.rows !== sized.rows)) void w.client.command(`resize-window -x ${w.want.cols} -y ${w.want.rows} -t ${target}`);
    void drain(w);
  };

  const typeKeys = async (w: Watch, data: string) => {
    const lock = w.lock ? deps.typing : undefined;
    const deadline = now() + 5_000;
    while (lock?.has(w.id) && now() < deadline && w.state !== 'closed') await new Promise(r => setTimeout(r, 20));
    if (w.state !== 'live' || !w.pane || lock?.has(w.id)) return;
    lock?.add(w.id);
    try {
      for (const line of keyCommands(w.pane, data)) {
        const r = await w.client.command(line);
        if (!r.ok) { deps.log(`pane ${w.id}: keys refused by tmux`); return; }
      }
    } finally { lock?.delete(w.id); }
  };

  const drain = (w: Watch) => {
    const next = w.queued.splice(0);
    for (const data of next) w.typing = w.typing.then(() => typeKeys(w, data)).catch(() => {});
  };

  const onEvent = (w: Watch, e: Exclude<ControlEvent, { kind: 'reply' }>) => {
    switch (e.kind) {
      case 'output': {
        if (w.state !== 'live' && w.state !== 'pending') return;
        // Between the capture's reply and display-message's, which pane is watched is not known yet (it may have changed since the
        // last screen): kept with its pane, sorted once it is.
        if (w.state === 'pending') { w.early.push({ pane: e.pane, data: e.data }); return; }
        if (e.pane !== w.pane) return;
        w.buffer = w.buffer.length ? Buffer.concat([w.buffer, e.data]) : e.data;
        w.since ??= now();
        return;
      }
      case 'layout':
        if (w.state === 'closed' || (e.cols === w.cols && e.rows === w.rows)) return;
        w.cols = e.cols; w.rows = e.rows;
        if (w.state === 'live') send(w, { type: 'term.size', id: w.id, cols: e.cols, rows: e.rows });
        return;
      case 'exit': return end(w, 'gone');
    }
  };

  const fail = (reply: PaneReply, session: PaneSession) => {
    if (session.owned) deps.killSession?.(session.tmuxName);
    reply({ type: 'term.exit', id: session.id, ...(session.shell ? { shell: session.shell } : {}), why: 'failed' });
  };

  return {
    watch(reply, session, size) {
      const tag = session.shell ?? '';
      const prev = find(reply, session.id, tag);
      if (prev) end(prev, null);
      if (!SAFE_NAME.test(session.tmuxName)) { fail(reply, session); return; }
      const argv = deps.controlArgs(session.tmuxName);
      if (!argv || argv.length === 0) { fail(reply, session); return; }
      let w!: Watch;
      const client = openControl(argv, spawnIt, e => { if (w.state === 'closed') return; onEvent(w, e); });
      w = {
        reply, id: session.id, shell: tag, tmuxName: session.tmuxName, sizing: size !== null, owned: !!session.owned, lock: !session.owned,
        ...(session.nonce ? { nonce: session.nonce } : {}),
        client, state: 'capturing', pane: null, cols: size?.cols ?? 0, rows: size?.rows ?? 0,
        want: size ? { ...size } : null,
        buffer: Buffer.alloc(0), since: null, early: [], queued: [], typing: Promise.resolve(),
        timer: timer(() => flush(w), TICK_MS), openTimer: null
      };
      if (w.sizing) hold(session.tmuxName);
      w.openTimer = later(() => { if (w.state !== 'closed') end(w, 'failed'); }, OPEN_TIMEOUT_MS);
      watches.add(w);
      deps.log(`pane ${w.id}${w.shell ? ` shell ${w.shell}` : ''} opened${w.sizing ? '' : ' read-only'}`);
      void screen(w);
    },
    input(reply, id, data, shell) {
      const w = find(reply, id, shell ?? '');
      if (!w || !w.sizing) return;
      w.queued.push(data);
      if (w.state === 'live') drain(w);
    },
    resize(reply, id, cols, rows, shell) {
      const w = find(reply, id, shell ?? '');
      if (!w || !w.want || w.state === 'closed') return;
      if (w.want.cols === cols && w.want.rows === rows) return;
      w.want = { cols, rows };
      if (w.state === 'live') void w.client.command(`resize-window -x ${cols} -y ${rows} -t ${targetOf(w.tmuxName)}`);
    },
    unwatch(reply, id, shell) { const w = find(reply, id, shell ?? ''); if (w) end(w, null); },
    release(reply) { for (const w of [...watches]) if (w.reply === reply) end(w, w.owned ? 'gone' : null); },
    drop(sessionId) { for (const w of [...watches]) if (w.id === sessionId) end(w, 'ended'); },
    stop() { for (const w of [...watches]) end(w, null); }
  };
}
