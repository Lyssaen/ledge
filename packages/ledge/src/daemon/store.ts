import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RecentSchema, SessionSchema, type Recent, type Session, type SessionEvent } from '@ledge/protocol';
import { reduce } from './state.js';
import { paths } from '../paths.js';
import { log } from '../log.js';

export type StoreChange = { type: 'updated'; session: Session } | { type: 'removed'; id: string } | { type: 'recents'; recents: Recent[] };

/** How many folders the launch form remembers. */
export const MAX_RECENTS = 12;

export class Store {
  private sessions = new Map<string, Session>();
  private recentList: Recent[] = [];
  private listeners = new Set<(c: StoreChange) => void>();
  private eventListeners = new Set<(id: string, event: SessionEvent) => void>();
  private timer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();
  private readonly journalPath: string;

  constructor(opts: { journalPath?: string } = {}) {
    this.journalPath = opts.journalPath ?? paths().journal;
  }

  async load(): Promise<void> {
    let raw: string;
    try { raw = await readFile(this.journalPath, 'utf8'); } catch { return; }
    if (!raw.trim()) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (e) { log(`journal unreadable, starting empty: ${(e as Error).message}`); return; }
    const list = (parsed as { sessions?: unknown[] })?.sessions;
    if (!Array.isArray(list)) { log('journal unreadable, starting empty: no sessions array'); return; }
    for (const item of list) {
      const r = SessionSchema.safeParse(item);
      if (r.success) this.sessions.set(r.data.id, r.data);
      else log(`journal entry dropped: ${r.error.issues[0]?.message ?? 'invalid'}`);
    }
    // Journals from before the launch form have no recents: they simply start empty.
    const recents = (parsed as { recents?: unknown[] })?.recents;
    if (Array.isArray(recents)) {
      for (const item of recents) { const r = RecentSchema.safeParse(item); if (r.success) this.recentList.push(r.data); }
      this.recentList = this.recentList.slice(0, MAX_RECENTS);
    }
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
  patch(id: string, fields: Partial<Pick<Session, 'repo' | 'repoPath' | 'branch' | 'worktree' | 'repoId'>>): void {
    const cur = this.sessions.get(id); if (!cur) return;
    if ((Object.keys(fields) as Array<keyof typeof fields>).every(k => cur[k] === fields[k])) return;
    this.upsert({ ...cur, ...fields });
  }

  /** Every event applied to a known session, before the reducer decides whether it changes anything. */
  onEvent(listener: (id: string, event: SessionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  apply(id: string, event: SessionEvent): Session | undefined {
    const cur = this.sessions.get(id);
    if (!cur) return undefined;
    for (const l of this.eventListeners) { try { l(id, event); } catch (e) { log(`event listener failed: ${(e as Error).message}`); } }
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
    await writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), sessions: this.all(), recents: this.recentList }, null, 2));
    await rename(tmp, this.journalPath);
  }

  private emit(c: StoreChange): void {
    for (const l of this.listeners) { try { l(c); } catch (e) { log(`listener failed: ${(e as Error).message}`); } }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.save().catch(e => log(`journal save failed: ${(e as Error).message}`)); }, 200);
  }
}
