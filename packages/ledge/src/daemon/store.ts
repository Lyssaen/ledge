import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SessionSchema, type Session, type SessionEvent } from '@ledge/protocol';
import { reduce } from './state.js';
import { paths } from '../paths.js';
import { log } from '../log.js';

export type StoreChange = { type: 'updated'; session: Session } | { type: 'removed'; id: string };

export class Store {
  private sessions = new Map<string, Session>();
  private listeners = new Set<(c: StoreChange) => void>();
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
  }

  all(): Session[] { return [...this.sessions.values()]; }
  get(id: string): Session | undefined { return this.sessions.get(id); }

  upsert(session: Session): void {
    this.sessions.set(session.id, session);
    this.emit({ type: 'updated', session });
  }

  apply(id: string, event: SessionEvent): Session | undefined {
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
    await writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), sessions: this.all() }, null, 2));
    await rename(tmp, this.journalPath);
  }

  private emit(c: StoreChange): void {
    for (const l of this.listeners) { try { l(c); } catch (e) { log(`listener failed: ${(e as Error).message}`); } }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.save().catch(e => log(`journal save failed: ${(e as Error).message}`)); }, 200);
  }
}
