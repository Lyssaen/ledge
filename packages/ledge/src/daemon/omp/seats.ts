import { homedir } from 'node:os';
import { join } from 'node:path';
import { open, readFile, stat } from 'node:fs/promises';
import { isArchived, type Session } from '@ledge/protocol';
import { log } from '../../log.js';
import type { Store } from '../store.js';

/**
 * The state of the OMP seats of OpenRig: working or idle, read from OMP's own journal; stopped is their pane gone (the poller).
 *
 * OpenRig runs an OMP seat behind its runner (`omp --mode rpc` in the seat's tmux pane), whose stdin and stdout are its own,
 * and no hook of it reaches Ledge. OMP appends the conversation to its journal one JSON entry per line
 * (`<OPENRIG_HOME>/state/omp/<seat>/sessions/*.jsonl`, the file named by the runner's `runner-state.json`): a prompt, a tool
 * call or an assistant message that calls a tool means a turn runs; an assistant message that ends the turn (done, aborted,
 * failed) means the seat waits. Only that is read: nothing of the conversation is shown or kept.
 */

/** Where OpenRig keeps its OMP seats: `<OPENRIG_HOME>/state/omp`. */
export const ompSeatsRoot = (env: NodeJS.ProcessEnv = process.env): string => join(env.OPENRIG_HOME?.trim() || join(homedir(), '.openrig'), 'state', 'omp');

/** A seat seen for the first time is read from this far back: enough to hold the entry that tells its state. */
export const TAIL_BYTES = 256 * 1024;
/** At most this much journal per seat and tick: a burst is read over the next ticks. */
export const READ_BYTES = 4 * 1024 * 1024;

/** A session Ledge follows as an OpenRig OMP seat (one Ledge launches itself is `omp-rpc`). */
export const isOmpSeat = (s: Pick<Session, 'source' | 'tool' | 'backend'>): boolean => s.source === 'rig' && s.tool === 'omp' && s.backend === undefined;

/** The state one journal entry says the seat is in, and since when; null for an entry that says nothing about it. */
export function entryState(raw: unknown): { state: 'working' | 'idle'; at?: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const at = typeof e.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp)) ? new Date(e.timestamp).toISOString() : undefined;
  const of = (state: 'working' | 'idle') => ({ state, ...(at ? { at } : {}) });
  // A background job's result wakes the agent; a tool starting is work.
  if (e.type === 'custom_message') return of('working');
  if (e.type === 'custom') return e.customType === 'tool_execution_start' ? of('working') : null;
  if (e.type !== 'message' || !e.message || typeof e.message !== 'object') return null;
  const m = e.message as Record<string, unknown>;
  if (m.role === 'user' || m.role === 'toolResult') return of('working');
  if (m.role !== 'assistant') return null;
  // A turn goes on after a message that calls a tool; any other end (`stop`, `aborted`, `error`, `length`) leaves it waiting.
  return typeof m.stopReason === 'string' ? of(m.stopReason === 'toolUse' ? 'working' : 'idle') : null;
}

interface Follow { file: string; offset: number }

export interface OmpSeatsDeps {
  store: Store;
  /** `<OPENRIG_HOME>/state/omp`. */
  root?: string;
  intervalMs?: number;
}

export function createOmpSeats(deps: OmpSeatsDeps) {
  const { store } = deps;
  const root = deps.root ?? ompSeatsRoot();
  const follows = new Map<string, Follow>();
  let running = false, timer: NodeJS.Timeout | null = null;

  /** The journal the seat's runner writes now, from its `runner-state.json`; null when it has none yet. */
  async function journalOf(seat: string): Promise<string | null> {
    try {
      const file = (JSON.parse(await readFile(join(root, seat, 'runner-state.json'), 'utf8')) as { sessionFile?: unknown }).sessionFile;
      return typeof file === 'string' && file ? file : null;
    } catch { return null; }
  }

  async function followOne(s: Session): Promise<void> {
    const file = await journalOf(s.rig!.seat);
    if (!file) return;
    let size: number;
    try { size = (await stat(file)).size; } catch { return; }
    let f = follows.get(s.id);
    // A seat new to this daemon, or a new conversation of the seat: its recent part holds its state.
    if (!f || f.file !== file) { f = { file, offset: Math.max(0, size - TAIL_BYTES) }; follows.set(s.id, f); }
    // A journal shorter than what was read was rewritten: what follows is new.
    if (size < f.offset) { f.offset = size; return; }
    if (size === f.offset) return;
    const fh = await open(file, 'r');
    let chunk: Buffer;
    try {
      const want = Math.min(size - f.offset, READ_BYTES);
      chunk = Buffer.alloc(want);
      chunk = chunk.subarray(0, (await fh.read(chunk, 0, want, f.offset)).bytesRead);
    } finally { await fh.close(); }
    // Only whole lines: the one OMP is still writing is read on a next tick. A read that starts mid-journal drops its cut first line.
    const end = chunk.lastIndexOf(0x0a);
    if (end === -1) { if (chunk.length === READ_BYTES) f.offset += chunk.length; return; }
    const lines = chunk.subarray(0, end).toString('utf8').split('\n');
    f.offset += end + 1;
    let last: ReturnType<typeof entryState> = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { continue; }
      last = entryState(entry) ?? last;
    }
    if (!last) return;
    const cur = store.get(s.id);
    if (!cur || cur.state === 'exited') return;
    const at = last.at ?? new Date().toISOString();
    if (cur.state !== last.state || at > cur.lastActivityAt) store.upsert({ ...cur, state: last.state, lastActivityAt: at > cur.lastActivityAt ? at : cur.lastActivityAt });
  }

  async function tick(): Promise<void> {
    if (running) return; running = true;
    try {
      const live = new Set<string>();
      for (const s of store.all()) {
        if (!isOmpSeat(s) || !s.rig || s.state === 'exited' || isArchived(s)) continue;
        live.add(s.id);
        try { await followOne(s); }
        catch (e) { log(`omp seats: journal of ${s.rig.seat} not read: ${(e as Error).message}`); }
      }
      for (const id of follows.keys()) if (!live.has(id)) follows.delete(id);
    } finally { running = false; }
  }

  return {
    tick,
    start(): void { if (!timer) { timer = setInterval(() => { void tick(); }, deps.intervalMs ?? 1000); timer.unref?.(); } },
    stop(): void { if (timer) clearInterval(timer); timer = null; }
  };
}
export type OmpSeats = ReturnType<typeof createOmpSeats>;
