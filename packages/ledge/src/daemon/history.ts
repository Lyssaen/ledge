import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEvent, ThreadItem, ToolItem } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';
import { filesOf } from './files.js';
import { agentMessages } from './transcript.js';
import { QUESTION_TOOLS } from './state.js';

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

/** Claude Code hands a backgrounded helper's report back as a prompt: `<agent-message from="<id>">`, a `[...]` frame
 *  line, the report indented. Returns the helper and the report, or undefined for a real prompt. The report may be
 *  empty: the hook keeps only the start of a prompt. */
const HANDBACK = /^<agent-message from="([^"]+)">\n?([\s\S]*?)(?:<\/agent-message>\s*)?$/;
export function handBack(text: string): { helperId: string; report: string } | undefined {
  const m = HANDBACK.exec(text.trimStart());
  if (!m) return undefined;
  const lines = m[2]!.split('\n');
  while (lines.length && (!lines[0]!.trim() || /^\s*\[[^\]]*\]/.test(lines[0]!))) lines.shift();
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.length - l.trimStart().length));
  return { helperId: m[1]!, report: lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n').trim() };
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

  /** Reads every `<id>.jsonl`: one item per line, the last line of an id wins, a bad line is skipped. A file that cannot
   *  be read is logged and left alone: the thread is a display, it must not keep the daemon from starting. A journal
   *  holding more lines than items (updates, evicted items) is rewritten with the items kept, through the write chain. */
  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    for (const entry of await readdir(this.dir, { withFileTypes: true })) {
      const name = entry.name;
      if (!entry.isFile() || !name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      let text: string;
      try { text = await readFile(join(this.dir, name), 'utf8'); }
      catch (e) { log(`history not read for ${id}: ${(e as Error).message}`); continue; }
      const byId = new Map<string, ThreadItem>(); let lines = 0;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        lines++;
        try { const it = JSON.parse(line) as ThreadItem; if (typeof it?.id === 'string') byId.set(it.id, it); /* a Map keeps the first position: the thread order survives */ } catch { /* a partial or corrupt line: skip it */ }
      }
      const items = [...byId.values()].slice(-MAX_ITEMS);
      this.threads.set(id, items);
      this.turns.set(id, items.reduce((n, it) => (typeof it.turn === 'number' ? Math.max(n, it.turn) : n), 0));
      if (lines > items.length) this.compact(id, items);
    }
  }

  /** The ids of the threads held, loaded or recorded. */
  ids(): string[] { return [...this.threads.keys()]; }

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
    // Claude 2.1 starts a helper without its task; the hook reads it later, on the helper's own events.
    if (ev.helperId && ev.task) {
      const helper = this.items(id).find(i => i.id === ev.helperId);
      if (helper?.kind === 'helper' && !helper.task) this.put(id, { ...helper, task: ev.task });
    }
    switch (ev.name) {
      case 'UserPromptSubmit': {
        if (!ev.text) return undefined;
        const back = handBack(ev.text);
        if (back) { // not a turn: the helper's report
          const helper = this.items(id).find(i => i.id === back.helperId);
          if (helper?.kind === 'helper' && helper.state !== 'exited') this.put(id, { ...helper, state: 'exited' });
          if (helper?.kind === 'helper') this.settle(id, i => i.helperId === back.helperId);
          return back.report ? this.put(id, { kind: 'reply', id: `report-${back.helperId}`, at: ev.at, turn: helper?.turn ?? turn, helperId: back.helperId, text: back.report }) : undefined;
        }
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
        // A question's tool row already shows it and its options; its permission text is only the raw input.
        if (QUESTION_TOOLS.has(ev.tool)) return undefined;
        const last = [...this.items(id)].reverse().find(i => i.kind === 'permission');
        if (last && last.kind === 'permission' && last.decision === undefined && last.text === ev.text) return last;
        return this.put(id, { kind: 'permission', id: `perm-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, text: ev.text });
      }
      case 'Decided': {
        const perm = [...this.items(id)].reverse().find(i => i.kind === 'permission' && i.decision === undefined);
        return perm && perm.kind === 'permission' ? this.put(id, { ...perm, decision: ev.decision ?? 'unknown' }) : undefined;
      }
      case 'Stop': {
        if (!ev.helperId) this.settle(id, i => i.turn === turn && !i.helperId);
        return ev.text ? this.put(id, { kind: 'reply', id: `reply-${turn}`, at: ev.at, turn, text: ev.text }) : undefined;
      }
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
        // Claude's placeholder stop for a backgrounded Task: never started, no transcript, the parent's reply as report.
        // With a transcript it is a real helper whose start was lost (a daemon restart): it gets its row.
        if (!prev && !ev.transcriptPath) return undefined;
        const row = prev && prev.kind === 'helper' ? prev : { kind: 'helper' as const, id: ev.helperId, at: ev.at, turn, task: ev.task ?? '', ...(ev.tool ? { agentType: ev.tool } : {}), state: 'working' as const };
        this.put(id, { ...row, state: 'exited' });
        this.settle(id, i => i.helperId === ev.helperId);
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

  /** The turn (or the helper) is over: an action still running will not get its result from this side. It shows as
   *  unknown, not as waiting forever; a result that arrives later still settles it (callFor finds it by id). */
  private settle(id: string, mine: (i: ToolItem) => boolean): void {
    for (const i of this.items(id)) if (i.kind === 'tool' && i.status === 'running' && mine(i)) this.put(id, { ...i, status: 'unknown' });
  }

  private callFor(id: string, ev: SessionEvent): ToolItem | undefined {
    const items = this.items(id);
    if (ev.toolUseId) { const hit = items.find(i => i.id === ev.toolUseId); if (hit?.kind === 'tool') return hit; }
    return [...items].reverse().find((i): i is ToolItem => i.kind === 'tool' && i.tool === ev.tool && i.status === 'running' && i.helperId === ev.helperId);
  }

  /** Rewrites a journal with one line per item, via a temporary file so a crash leaves the old journal whole. */
  private compact(id: string, items: ThreadItem[]): void {
    const file = join(this.dir, `${id}.jsonl`); const tmp = `${file}.tmp`;
    const text = items.map(it => JSON.stringify(it) + '\n').join('');
    this.writes = this.writes.then(() => writeFile(tmp, text)).then(() => rename(tmp, file)).catch(e => log(`history not compacted for ${id}: ${(e as Error).message}`));
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
