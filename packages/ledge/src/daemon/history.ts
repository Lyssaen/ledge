import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TurnSchema, type Session, type SessionEvent, type Turn } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';

/** Turns kept per session. */
export const HISTORY_MAX = 200;

type NewTurn = Omit<Turn, 'seq' | 'at'>;

/**
 * What an event adds to the thread, or null. A request that vanishes on anything but a decision of ours (Decided) or the
 * end of the session was settled in the terminal: `resolved`. The decision turn itself is recorded where the decision is made.
 */
export function turnFromEvent(ev: SessionEvent, before: Session | undefined, after: Session | undefined): NewTurn | null {
  if (ev.name === 'UserPromptSubmit' && ev.text) return { kind: 'prompt', text: ev.text };
  if (ev.name === 'Stop' && ev.text) return { kind: 'reply', text: ev.text };
  if (before?.pending && !after?.pending && ev.name !== 'Decided' && ev.name !== 'SessionEnd' && ev.name !== 'PaneGone') {
    return { kind: 'resolved', source: 'pc', ...(before.pending.id ? { pendingId: before.pending.id } : {}) };
  }
  return null;
}

interface Counters { seq: number; replySeq: number; lines: number }

const SAFE_ID = /^[\w.-]{1,128}$/;
/** `.` and `..` match SAFE_ID but name folders: they are hashed like any other odd id. */
const fileName = (id: string) => (SAFE_ID.test(id) && !/^\.+$/.test(id) ? id : createHash('sha256').update(id).digest('hex')) + '.jsonl';

function parseLines(raw: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { const r = TurnSchema.safeParse(JSON.parse(line)); if (r.success) turns.push(r.data); } catch { /* a torn line is skipped */ }
  }
  return turns;
}

/**
 * Each session's thread, one JSON line per turn in `~/.ledge/history/<id>.jsonl` (folder 0700, files 0600). Numbering and
 * counters move synchronously in `next`; the disk follows through a single queue, so `read` waits for what was added.
 */
export class HistoryStore {
  private readonly dir: string;
  private readonly max: number;
  private counters = new Map<string, Counters>();
  private queue: Promise<void> = Promise.resolve();

  constructor(o: { dir?: string; max?: number } = {}) {
    this.dir = o.dir ?? paths().history;
    this.max = o.max ?? HISTORY_MAX;
  }

  private file(id: string) { return join(this.dir, fileName(id)); }

  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch(e => log(`history write failed: ${(e as Error).message}`));
  }

  /** The counters of a session; the first access after a restart reads its file. */
  private state(id: string): Counters {
    let c = this.counters.get(id);
    if (c) return c;
    c = { seq: 0, replySeq: 0, lines: 0 };
    try {
      const raw = readFileSync(this.file(id), 'utf8');
      c.lines = raw.split('\n').filter(Boolean).length;
      for (const t of parseLines(raw)) { c.seq = Math.max(c.seq, t.seq); if (t.kind === 'reply') c.replySeq = Math.max(c.replySeq, t.seq); }
    } catch { /* no file yet */ }
    this.counters.set(id, c);
    return c;
  }

  next(id: string, turn: Omit<Turn, 'seq'>): Turn {
    const c = this.state(id);
    const full: Turn = { ...turn, seq: ++c.seq };
    if (full.kind === 'reply') c.replySeq = full.seq;
    c.lines++;
    this.enqueue(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await appendFile(this.file(id), `${JSON.stringify(full)}\n`, { mode: 0o600 });
    });
    if (c.lines > this.max * 1.25) {
      c.lines = this.max;
      this.enqueue(() => this.compact(id));
    }
    return full;
  }

  /** The `max` last lines, written next to the file and moved over it. */
  private async compact(id: string): Promise<void> {
    const path = this.file(id);
    const kept = parseLines(await readFile(path, 'utf8')).slice(-this.max);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, kept.map(t => `${JSON.stringify(t)}\n`).join(''), { mode: 0o600 });
    await rename(tmp, path);
  }

  async read(id: string): Promise<Turn[]> {
    await this.flush();
    try { return parseLines(await readFile(this.file(id), 'utf8')).slice(-this.max); }
    catch { return []; }
  }

  lastSeq(id: string): number { return this.state(id).seq; }
  lastReplySeq(id: string): number { return this.state(id).replySeq; }

  async remove(id: string): Promise<void> {
    this.counters.set(id, { seq: 0, replySeq: 0, lines: 0 });
    this.enqueue(() => rm(this.file(id), { force: true }));
    await this.flush();
  }

  /**
   * Drops the threads of sessions that no longer exist and the leftovers of an interrupted compaction, and closes an
   * existing folder to its owner. A file that cannot be removed is logged and skipped: it never stops the daemon.
   */
  async prune(keep: ReadonlySet<string>): Promise<void> {
    await this.flush();
    const wanted = new Set([...keep].map(fileName));
    let names: string[];
    try { names = await readdir(this.dir); } catch { return; }
    try { await chmod(this.dir, 0o700); } catch (e) { log(`history folder not restricted: ${(e as Error).message}`); }
    for (const name of names) {
      const stale = name.endsWith('.jsonl.tmp') || (name.endsWith('.jsonl') && !wanted.has(name));
      if (!stale) continue;
      try { await rm(join(this.dir, name), { force: true }); }
      catch (e) { log(`history ${name} not pruned: ${(e as Error).message}`); }
    }
    this.counters.clear();
  }

  async flush(): Promise<void> { await this.queue; }
}
