// The phone's side of an agent's terminal (spec 2026-11-02 mobile terminal): opens the stream, paints the first screen,
// follows `seq` (a gap asks for a fresh screen), and types what the user keys while the hand is held. Lives outside React:
// output comes far too often for a render each time.
import { TERM_INPUT_MAX, type Assertion, type OperationReason, type PhoneClientMessage, type PhoneServerMessage, type TermExitWhy, type TermReleaseWhy } from '@ledge/protocol';

/** The xterm the controller paints. */
export interface TermScreen {
  reset(cols: number, rows: number): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

/** The link, as far as the terminal needs it. */
export interface TermWire {
  send(m: PhoneClientMessage): void;
  onMessage(fn: (m: PhoneServerMessage) => void): () => void;
  ready(): boolean;
  /** `fn` runs on every change of the link: the controller reopens once it is ready again. */
  subscribe(fn: () => void): () => void;
}

export type TermPhase = 'connecting' | 'live' | 'offline' | 'ended' | 'refused';

export interface TermView {
  phase: TermPhase;
  cols: number; rows: number;
  /** A subagent's page: its parent's pane, never typed into. */
  readOnly: boolean;
  /** The hand is the phone's until `until` (epoch ms), and no longer than 5 min after `lastKey`. */
  held: { until: number; lastKey: number } | null;
  /** A hold asked and not answered yet. */
  holding: boolean;
  released: TermReleaseWhy | null;
  exit: TermExitWhy | null;
  /** Why the PC refused to open the terminal, or the last hold. */
  refused: OperationReason | null;
  holdRefused: OperationReason | null;
}

/** Keys are gathered this long, then sent together. */
export const INPUT_BATCH_MS = 30;
/** What the phone's xterm answers on its own to the pane's queries: the PC's terminal answers them already. */
const REPORT = /^(?:\x1b\[\??\d+(?:;\d+)*[Rc]|\x1b\[[?>][\d;]*c|\x1b\][0-9]+;rgb:[0-9a-f/]+(?:\x07|\x1b\\)|\x1b\[[IO])$/i;

const INITIAL: TermView = { phase: 'connecting', cols: 80, rows: 24, readOnly: false, held: null, holding: false, released: null, exit: null, refused: null, holdRefused: null };

/** The longest head of `s` that fits one `term.input` and never splits a surrogate pair. */
export function inputChunk(s: string): string {
  if (s.length <= TERM_INPUT_MAX) return s;
  let n = TERM_INPUT_MAX;
  const c = s.charCodeAt(n - 1);
  if (c >= 0xd800 && c <= 0xdbff) n -= 1;
  return s.slice(0, n);
}

/** What paints a first screen: home, clear (the scrollback too: a fresh screen replaces the history it carries, #298), the lines,
 *  then the cursor where the pane has it, from the top of the grid: the lines past it (the history) scroll into the scrollback. */
export function paintScreen(screen: string, cursor: { x: number; y: number }): string {
  return `\x1b[H\x1b[2J\x1b[3J${screen.replace(/\n/g, '\r\n')}\x1b[${cursor.y + 1};${cursor.x + 1}H`;
}

export class TermController {
  private view: TermView = INITIAL;
  private readonly listeners = new Set<() => void>();
  private tid: string | null = null;
  private openOp: string | null = null;
  private holdOp: { op: string; done: (r: OperationReason | null) => void } | null = null;
  private seq = 0;
  private resyncing = false;
  private n = 0;
  private pending = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wasReady = false;
  private offs: Array<() => void> = [];
  private stopped = false;

  constructor(private readonly wire: TermWire, private readonly sessionId: string, private readonly screen: TermScreen, private readonly uuid: () => string = () => crypto.randomUUID()) {}

  get state(): TermView { return this.view; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  start(): void {
    this.offs.push(this.wire.onMessage(m => this.onMessage(m)));
    this.offs.push(this.wire.subscribe(() => this.onLink()));
    this.wasReady = this.wire.ready();
    if (this.wasReady) this.open(); else this.set({ phase: 'offline' });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.flushKeys();
    if (this.tid && this.wire.ready()) this.wire.send({ type: 'term.close', tid: this.tid });
    for (const off of this.offs.splice(0)) off();
    if (this.timer) clearTimeout(this.timer);
    this.holdOp?.done('invalid');
    this.holdOp = null;
  }

  /** « Prendre la main », with the passkey made for this session; resolves with the refusal, or null once held. */
  hold(assertion: Assertion): Promise<OperationReason | null> {
    if (!this.tid || this.view.phase !== 'live' || this.view.readOnly || !this.wire.ready()) return Promise.resolve('invalid');
    this.holdOp?.done('invalid');
    const op = this.uuid();
    const tid = this.tid;
    return new Promise(done => {
      this.holdOp = { op, done: r => { this.holdOp = null; this.set({ holding: false, holdRefused: r }); done(r); } };
      this.set({ holding: true, holdRefused: null, released: null });
      this.wire.send({ type: 'term.hold', op, tid, assertion });
    });
  }

  release(): void {
    if (!this.tid || !this.view.held) return;
    this.flushKeys();
    this.wire.send({ type: 'term.release', tid: this.tid });
  }

  /** What the user keyed, as xterm or the key row produced it. Dropped unless the hand is held. */
  type(data: string): void {
    if (!this.view.held || !this.tid || REPORT.test(data)) return;
    this.pending += data;
    this.set({ held: { ...this.view.held, lastKey: Date.now() } });
    if (this.timer === null) this.timer = setTimeout(() => { this.timer = null; this.flushKeys(); }, INPUT_BATCH_MS);
  }

  private flushKeys(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.tid || !this.pending || !this.wire.ready()) { this.pending = ''; return; }
    while (this.pending) {
      const data = inputChunk(this.pending);
      this.pending = this.pending.slice(data.length);
      this.wire.send({ type: 'term.input', tid: this.tid, n: this.n++, data });
    }
  }

  private open(): void {
    this.openOp = this.uuid();
    this.tid = null;
    this.n = 0;
    this.resyncing = false;
    this.set({ phase: 'connecting', held: null, holding: false, exit: null, refused: null });
    this.wire.send({ type: 'term.open', op: this.openOp, id: this.sessionId });
  }

  private onLink(): void {
    const ready = this.wire.ready();
    if (ready === this.wasReady || this.stopped) return;
    this.wasReady = ready;
    if (!ready) {
      // The PC ended the terminal with the link; what was keyed and not sent is lost with it.
      this.pending = '';
      this.holdOp?.done('invalid');
      this.tid = null;
      if (this.view.phase !== 'ended' && this.view.phase !== 'refused') this.set({ phase: 'offline', held: null, released: this.view.held ? 'link' : this.view.released });
      return;
    }
    if (this.view.phase === 'offline') this.open();
  }

  private onMessage(m: PhoneServerMessage): void {
    if (this.stopped) return;
    switch (m.type) {
      case 'term.opened': {
        const mine = m.op !== undefined ? m.op === this.openOp : m.tid === this.tid;
        if (!mine) return;
        this.tid = m.tid;
        this.seq = m.seq;
        this.resyncing = false;
        this.screen.reset(m.cols, m.rows);
        this.screen.write(paintScreen(m.screen, m.cursor));
        this.set({ phase: 'live', cols: m.cols, rows: m.rows, readOnly: m.readOnly === true });
        return;
      }
      case 'term.output':
        if (m.tid !== this.tid || this.resyncing) return;
        if (m.seq !== this.seq) {
          // A frame went missing: the screen is wrong from here, a fresh one replaces it.
          this.resyncing = true;
          this.wire.send({ type: 'term.resync', tid: m.tid });
          return;
        }
        this.seq++;
        this.screen.write(m.data);
        return;
      case 'term.size':
        if (m.tid !== this.tid) return;
        this.screen.resize(m.cols, m.rows);
        this.set({ cols: m.cols, rows: m.rows });
        return;
      case 'term.held':
        if (m.tid !== this.tid) return;
        this.set({ held: { until: Date.parse(m.until), lastKey: Date.now() }, released: null });
        return;
      case 'term.released':
        if (m.tid !== this.tid) return;
        this.pending = '';
        this.set({ held: null, released: m.why === 'asked' ? null : m.why });
        return;
      case 'term.exit':
        if (m.tid !== this.tid) return;
        this.tid = null;
        this.set({ phase: 'ended', held: null, exit: m.why });
        return;
      case 'operation.result':
        if (m.op === this.openOp && m.status === 'rejected') { this.openOp = null; this.set({ phase: 'refused', refused: m.reason ?? 'invalid' }); return; }
        if (m.op === this.openOp && m.status === 'failed') { this.openOp = null; this.set({ phase: 'refused', refused: 'unavailable' }); return; }
        if (this.holdOp && m.op === this.holdOp.op && m.status !== 'received') this.holdOp.done(m.status === 'applied' ? null : m.reason ?? 'invalid');
        return;
      default:
        return;
    }
  }

  private set(patch: Partial<TermView>): void {
    this.view = { ...this.view, ...patch };
    for (const fn of [...this.listeners]) fn();
  }
}
