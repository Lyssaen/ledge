import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RecentSchema, SessionSchema, type Recent, type Session, type SessionEvent } from '@ledge/protocol';
import { reduce } from './state.js';
import { paths } from '../paths.js';
import { log } from '../log.js';

/** What `Store.load` found: `clean` only when the journal was there, read whole, every entry kept. */
export type LoadResult = { clean: true } | { clean: false; reason: string };

export type StoreChange = { type: 'updated'; session: Session } | { type: 'removed'; id: string } | { type: 'recents'; recents: Recent[] };

/** How many folders the launch form remembers. */
export const MAX_RECENTS = 12;
/** How many archived sessions a daemon keeps: past it, the oldest archived goes, with its thread. */
export const ARCHIVE_MAX = 200;

export class Store {
  private sessions = new Map<string, Session>();
  private recentList: Recent[] = [];
  private listeners = new Set<(c: StoreChange) => void>();
  private eventListeners = new Set<(id: string, event: SessionEvent) => void>();
  private timer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();
  private readonly journalPath: string;
  /** Set by an unclean load and saved with the journal: a later clean-looking load must not be trusted for cleanups. */
  private incomplete = false;

  constructor(opts: { journalPath?: string } = {}) {
    this.journalPath = opts.journalPath ?? paths().journal;
  }

  /**
   * Reads the journal. `clean` is false when it was missing, unreadable, or an entry was dropped by the schema, or when
   * an earlier load was so (the mark is saved with the journal): what the store holds may then not be every session,
   * and nothing may be cleaned up on the strength of it (the threads of the sessions it misses).
   */
  async load(): Promise<LoadResult> {
    let raw: string;
    try { raw = await readFile(this.journalPath, 'utf8'); } catch { return { clean: false, reason: 'no journal' }; }
    const bad = async (reason: string): Promise<LoadResult> => {
      this.incomplete = true;
      // The first bad journal is kept aside: the next save overwrites the journal itself.
      await writeFile(`${this.journalPath}.incomplete`, raw, { flag: 'wx' }).catch(() => undefined);
      return { clean: false, reason };
    };
    if (!raw.trim()) return bad('empty journal');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (e) { log(`journal unreadable, starting empty: ${(e as Error).message}`); return bad('unreadable journal'); }
    const list = (parsed as { sessions?: unknown[] })?.sessions;
    if (!Array.isArray(list)) { log('journal unreadable, starting empty: no sessions array'); return bad('no sessions array'); }
    let dropped = 0;
    for (const item of list) {
      const r = SessionSchema.safeParse(item);
      if (r.success) this.sessions.set(r.data.id, r.data);
      else { dropped++; log(`journal entry dropped: ${r.error.issues[0]?.message ?? 'invalid'}`); }
    }
    // Journals from before the launch form have no recents: they simply start empty.
    const recents = (parsed as { recents?: unknown[] })?.recents;
    if (Array.isArray(recents)) {
      for (const item of recents) { const r = RecentSchema.safeParse(item); if (r.success) this.recentList.push(r.data); }
      this.recentList = this.recentList.slice(0, MAX_RECENTS);
    }
    if (dropped) return bad(`${dropped} journal ${dropped === 1 ? 'entry' : 'entries'} dropped`);
    if ((parsed as { incomplete?: unknown }).incomplete === true) { this.incomplete = true; return { clean: false, reason: 'an earlier load was incomplete' }; }
    return { clean: true };
  }

  all(): Session[] { return [...this.sessions.values()]; }
  get(id: string): Session | undefined { return this.sessions.get(id); }
  /** The folders of past sessions, most recent first. */
  recents(): Recent[] { return [...this.recentList]; }

  upsert(session: Session): void {
    this.sessions.set(session.id, session);
    this.emit({ type: 'updated', session });
  }

  /** Records a session's folder as the most recent one (one entry per folder, `MAX_RECENTS` kept). */
  touchRecent(cwd: string, project: string, at: string): void {
    this.recentList = [{ cwd, project, lastAt: at }, ...this.recentList.filter(r => r.cwd !== cwd)].slice(0, MAX_RECENTS);
    this.emit({ type: 'recents', recents: this.recents() });
  }

  /** Facts no event carries (the session's repository): the changed fields only, nothing emitted when they are equal. */
  patch(id: string, fields: Partial<Pick<Session, 'repo' | 'repoPath' | 'branch' | 'worktree' | 'repoId' | 'lastMessage' | 'workdir' | 'modelNext'>>): void {
    const cur = this.sessions.get(id); if (!cur) return;
    if ((Object.keys(fields) as Array<keyof typeof fields>).every(k => cur[k] === fields[k])) return;
    this.upsert({ ...cur, ...fields });
  }

  /** Sets the archive date (kept if already set), then drops the oldest archives past `ARCHIVE_MAX`. */
  archive(id: string, at: string): Session | undefined {
    const cur = this.sessions.get(id); if (!cur) return undefined;
    const next = cur.archivedAt === undefined ? { ...cur, archivedAt: at } : cur;
    if (next !== cur) this.upsert(next);
    const archived = this.all().filter(s => s.archivedAt !== undefined).sort((a, b) => a.archivedAt!.localeCompare(b.archivedAt!));
    for (const old of archived.slice(0, Math.max(0, archived.length - ARCHIVE_MAX))) this.remove(old.id);
    return this.sessions.get(id);
  }

  /** Takes the session out of the archive; `at` (a restore by the user) restarts the retirement clock from then. */
  unarchive(id: string, at?: string): Session | undefined {
    const cur = this.sessions.get(id); if (!cur) return undefined;
    if (cur.archivedAt === undefined) return cur;
    const { archivedAt: _gone, ...rest } = cur;
    const next: Session = at !== undefined ? { ...rest, restoredAt: at } : rest;
    this.upsert(next);
    return next;
  }

  /** Every event applied to a known session, before the reducer decides whether it changes anything. */
  onEvent(listener: (id: string, event: SessionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  apply(id: string, event: SessionEvent): Session | undefined {
    if (!this.sessions.has(id)) return undefined;
    for (const l of this.eventListeners) { try { l(id, event); } catch (e) { log(`event listener failed: ${(e as Error).message}`); } }
    // A listener may have patched the session (a sent message's last message): reduce what it left, not what it found.
    const cur = this.sessions.get(id);
    if (!cur) return undefined;
    const next = reduce(cur, event);
    if (next === cur) return cur;
    this.sessions.set(id, next);
    this.emit({ type: 'updated', session: next });
    return next;
  }

  remove(id: string): void {
    if (!this.sessions.delete(id)) return;
    this.emit({ type: 'removed', id });
  }

  onChange(listener: (c: StoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  save(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const run = this.saving.then(() => this.write());
    this.saving = run.catch(() => undefined);
    return run;
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.journalPath), { recursive: true });
    const tmp = `${this.journalPath}.tmp`;
    await writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), ...(this.incomplete ? { incomplete: true } : {}), sessions: this.all(), recents: this.recentList }, null, 2));
    await rename(tmp, this.journalPath);
  }

  private emit(c: StoreChange): void {
    for (const l of this.listeners) { try { l(c); } catch (e) { log(`listener failed: ${(e as Error).message}`); } }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.save().catch(e => log(`journal save failed: ${(e as Error).message}`)); }, 200);
  }
}
