import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEvent, ThreadItem, ToolItem } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';
import { filesOf } from './files.js';
import { agentMessages } from './transcript.js';

/** Native tracking (spec 2026-10-13 §3–4): one thread per session, reduced from the events the store applies. */
export const MAX_ITEMS = 400;
export const SYNC_MS = 1000;
type Listener = (id: string, item: ThreadItem) => void;

/** What an action's row shows when unfolded: the command, or the input as JSON. */
function inputText(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const cmd = input.command;
  if (typeof cmd === 'string') return cmd;
  if (Array.isArray(cmd)) return cmd.map(String).join(' ');
  const text = JSON.stringify(input, null, 2);
  return text === '{}' ? undefined : text;
}

export class History {
  private threads = new Map<string, ThreadItem[]>();
  private turns = new Map<string, number>();
  private synced = new Map<string, number>();
  private listeners = new Set<Listener>();
  private writes: Promise<void> = Promise.resolve();
  private readonly dir: string;
  constructor(opts: { dir?: string } = {}) { this.dir = opts.dir ?? paths().history; }

  items(id: string): ThreadItem[] { return this.threads.get(id) ?? []; }
  onItem(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  /** Waits for the journal writes issued so far (tests, shutdown). */
  flush(): Promise<void> { return this.writes; }

  /** Reads every `<id>.jsonl`: one item per line, the last line of an id wins, a bad line is skipped. */
  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      const byId = new Map<string, ThreadItem>();
      for (const line of (await readFile(join(this.dir, name), 'utf8')).split('\n')) {
        if (!line.trim()) continue;
        try { const it = JSON.parse(line) as ThreadItem; if (typeof it?.id === 'string') byId.set(it.id, it); /* a Map keeps the first position: the thread order survives */ } catch { /* a partial or corrupt line: skip it */ }
      }
      const items = [...byId.values()].slice(-MAX_ITEMS);
      this.threads.set(id, items);
      this.turns.set(id, items.reduce((n, it) => (typeof it.turn === 'number' ? Math.max(n, it.turn) : n), 0));
    }
  }

  forget(id: string): void {
    this.threads.delete(id); this.turns.delete(id);
    this.writes = this.writes.then(() => rm(join(this.dir, `${id}.jsonl`), { force: true })).catch(e => log(`history not removed for ${id}: ${(e as Error).message}`));
  }

  /** The user's own decision, sent from the overlay: it lands on the last permission still undecided or only seen to vanish. */
  decide(id: string, decision: 'accept' | 'deny'): ThreadItem | undefined {
    const perm = [...this.items(id)].reverse().find(i => i.kind === 'permission' && (i.decision === undefined || i.decision === 'unknown'));
    return perm && perm.kind === 'permission' ? this.put(id, { ...perm, decision }) : undefined;
  }

  record(id: string, ev: SessionEvent): ThreadItem | undefined {
    const turn = this.turns.get(id) ?? 0;
    const common = { at: ev.at, turn, ...(ev.helperId ? { helperId: ev.helperId } : {}) };
    switch (ev.name) {
      case 'UserPromptSubmit': {
        if (!ev.text) return undefined;
        this.turns.set(id, turn + 1);
        return this.put(id, { kind: 'prompt', id: `prompt-${turn + 1}`, at: ev.at, turn: turn + 1, text: ev.text });
      }
      case 'PreToolUse': {
        if (!ev.tool) return undefined;
        const existing = ev.toolUseId && this.items(id).find(i => i.id === ev.toolUseId);
        if (existing) return existing; // the result came first (parallel hooks): keep what it said
        const input = inputText(ev.toolInput);
        return this.put(id, { kind: 'tool', id: ev.toolUseId ?? `tool-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, label: ev.text ?? ev.tool, ...(input ? { input } : {}), status: 'running', files: filesOf(ev.tool, ev.toolInput) });
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (!ev.tool) return undefined;
        const failed = ev.name === 'PostToolUseFailure';
        const row = this.callFor(id, ev);
        const base: ToolItem = row ?? { kind: 'tool', id: ev.toolUseId ?? `tool-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, label: ev.text ?? ev.tool, status: 'running', files: filesOf(ev.tool, ev.toolInput) };
        const error = failed ? ev.error ?? (ev.interrupt ? 'interrupted' : 'failed') : undefined;
        return this.put(id, { ...base, status: failed ? 'failed' : 'success', ...(ev.output !== undefined ? { output: ev.output } : {}), ...(error ? { error } : {}), ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}) });
      }
      case 'PermissionRequest': {
        if (!ev.tool || !ev.text) return undefined;
        const last = [...this.items(id)].reverse().find(i => i.kind === 'permission');
        if (last && last.kind === 'permission' && last.decision === undefined && last.text === ev.text) return last;
        return this.put(id, { kind: 'permission', id: `perm-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, text: ev.text });
      }
      case 'Decided': {
        const perm = [...this.items(id)].reverse().find(i => i.kind === 'permission' && i.decision === undefined);
        return perm && perm.kind === 'permission' ? this.put(id, { ...perm, decision: ev.decision ?? 'unknown' }) : undefined;
      }
      case 'Stop': return ev.text ? this.put(id, { kind: 'reply', id: `reply-${turn}`, at: ev.at, turn, text: ev.text }) : undefined;
      case 'SubagentStart': {
        if (!ev.helperId) return undefined;
        const task = ev.text ?? ev.task ?? '';
        const prev = this.items(id).find(i => i.id === ev.helperId);
        if (prev) return prev;
        return this.put(id, { kind: 'helper', id: ev.helperId, at: ev.at, turn, task, ...(ev.tool ? { agentType: ev.tool } : {}), state: 'working' });
      }
      case 'SubagentStop': {
        if (!ev.helperId) return undefined;
        const prev = this.items(id).find(i => i.id === ev.helperId);
        const row = prev && prev.kind === 'helper' ? prev : { kind: 'helper' as const, id: ev.helperId, at: ev.at, turn, task: ev.task ?? '', ...(ev.tool ? { agentType: ev.tool } : {}), state: 'working' as const };
        this.put(id, { ...row, state: 'exited' });
        return ev.text ? this.put(id, { kind: 'reply', id: `report-${ev.helperId}`, at: ev.at, turn, helperId: ev.helperId, text: ev.text }) : undefined;
      }
      default: return undefined;
    }
  }

  /** The row a result belongs to: by id, else the last running call of that tool in the same thread (Cursor gives no id). */
  /** Inserts the agent's messages the transcript holds and the thread lacks, from the current turn's prompt on (or the
   *  helper's start). At most once a second per thread unless forced (end of a turn). */
  sync(id: string, path: string, opts: { helperId?: string; force?: boolean; now?: number } = {}): ThreadItem[] {
    const key = `${id}/${opts.helperId ?? ''}`; const now = opts.now ?? Date.now();
    if (!opts.force && now - (this.synced.get(key) ?? 0) < SYNC_MS) return [];
    this.synced.set(key, now);
    const items = this.items(id);
    const since = opts.helperId ? items.find(i => i.id === opts.helperId)?.at : [...items].reverse().find(i => i.kind === 'prompt')?.at;
    if (!since) return []; // a daemon that joined mid-turn: the old tail would flood the thread
    const have = new Set(items.map(i => i.id));
    const turn = this.turns.get(id) ?? 0;
    const added: ThreadItem[] = [];
    for (const m of agentMessages(path, { sidechain: !!opts.helperId })) {
      if (m.at < since || have.has(`msg-${m.id}`)) continue;
      added.push(this.put(id, { kind: 'message', id: `msg-${m.id}`, at: m.at, turn, text: m.text, ...(opts.helperId ? { helperId: opts.helperId } : {}) }));
    }
    return added;
  }

  private callFor(id: string, ev: SessionEvent): ToolItem | undefined {
    const items = this.items(id);
    if (ev.toolUseId) { const hit = items.find(i => i.id === ev.toolUseId); if (hit?.kind === 'tool') return hit; }
    return [...items].reverse().find((i): i is ToolItem => i.kind === 'tool' && i.tool === ev.tool && i.status === 'running' && i.helperId === ev.helperId);
  }

  private put(id: string, item: ThreadItem): ThreadItem {
    const items = [...this.items(id)];
    const at = items.findIndex(i => i.id === item.id);
    if (at >= 0) items[at] = item; else items.push(item);
    this.threads.set(id, items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items);
    for (const l of this.listeners) { try { l(id, item); } catch (e) { log(`history listener failed: ${(e as Error).message}`); } }
    const line = JSON.stringify(item) + '\n';
    this.writes = this.writes.then(() => mkdir(this.dir, { recursive: true })).then(() => appendFile(join(this.dir, `${id}.jsonl`), line)).catch(e => log(`history not written for ${id}: ${(e as Error).message}`));
    return item;
  }
}
