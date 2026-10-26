import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoticeItem, ReceivedItem, SentItem, SessionEvent, Task, TaskTransmission, ThreadItem, ToolItem } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';
import { filesOf } from './files.js';
import { agentMessages } from './transcript.js';
import { QUESTION_TOOLS } from './state.js';
import { quote } from './tasks.js';
import { crossSession, crossSessionNotices, stripNote, ledgeBody, ledgeMessages, ledgeNotice, ledgeTask, ledgeTeamNotice, mailId, type CrossSessionNotice } from './crossSession.js';
export { crossSession } from './crossSession.js';

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
  // The frame is at column zero, the report indented: a report that opens on a link (`  [page](url)`) is not a frame.
  while (lines.length && (!lines[0]!.trim() || /^\[[^\]]*\]/.test(lines[0]!))) lines.shift();
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.length - l.trimStart().length));
  return { helperId: m[1]!, report: lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n').trim() };
}

export class History {
  private threads = new Map<string, ThreadItem[]>();
  private turns = new Map<string, number>();
  private synced = new Map<string, number>();
  private listeners = new Set<Listener>();
  private writes: Promise<void> = Promise.resolve();
  /** The rids of the cards Ledge's mailbox recorded: their result is the mailbox's, not the tool call's (their `via`, read back at load). */
  private readonly mailed = new Set<string>();
  private readonly dir: string;
  /** The Ledge session a SendMessage address or a sender's name is, when it is one (peers.ts). */
  private readonly peerOf: (target: string) => string | undefined;
  constructor(opts: { dir?: string; peerOf?: (target: string) => string | undefined } = {}) {
    this.dir = opts.dir ?? paths().history; this.peerOf = opts.peerOf ?? (() => undefined);
  }

  items(id: string): ThreadItem[] { return this.threads.get(id) ?? []; }
  onItem(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  /** Waits for the journal writes issued so far (tests, shutdown). */
  flush(): Promise<void> { return this.writes; }

  /** Reads every `<id>.jsonl`: one item per line, the last line of an id wins, a bad line is skipped. A file that cannot
   *  be read is logged and left alone: the thread is a display, it must not keep the daemon from starting. A journal
   *  holding more lines than items (updates, evicted items) is rewritten with the items kept, through the write chain.
   *  The mailbox's queue did not survive the restart: its cards still sending failed. */
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
      const items = [...byId.values()].slice(-MAX_ITEMS); let lost = false;
      items.forEach((it, i) => {
        if (it.kind !== 'sent' || it.via !== 'ledge') return;
        this.mailed.add(it.id);
        if (it.status === 'sending') { items[i] = { ...it, status: 'failed' }; lost = true; }
      });
      this.threads.set(id, items);
      this.turns.set(id, items.reduce((n, it) => (typeof it.turn === 'number' ? Math.max(n, it.turn) : n), 0));
      if (lines > items.length || lost) this.compact(id, items);
    }
  }

  /** The ids of the images the journaled prompts refer to, read from every `<dir>/*.jsonl` once the pending writes landed. */
  async attachmentIds(): Promise<Set<string>> {
    await this.writes;
    const ids = new Set<string>();
    let names: string[];
    try { names = await readdir(this.dir); } catch { return ids; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      let text: string;
      try { text = await readFile(join(this.dir, name), 'utf8'); }
      catch (e) { log(`history not read for ${name}: ${(e as Error).message}`); continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"images"')) continue;
        try { for (const img of (JSON.parse(line) as { images?: Array<{ id?: unknown }> }).images ?? []) if (typeof img?.id === 'string') ids.add(img.id); } catch { /* a partial or corrupt line */ }
      }
    }
    return ids;
  }

  /** The ids of the threads held, loaded or recorded. */
  ids(): string[] { return [...this.threads.keys()]; }

  forget(id: string): void {
    this.threads.delete(id); this.turns.delete(id);
    this.writes = this.writes.then(() => rm(join(this.dir, `${id}.jsonl`), { force: true })).catch(e => log(`history not removed for ${id}: ${(e as Error).message}`));
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
        const messages = crossSession(ev.text);
        if (messages) { // another agent's messages: a turn of their own, a card each, no prompt
          this.turns.set(id, turn + 1);
          let last: ThreadItem | undefined;
          messages.forEach((m, i) => { const { sender, text } = stripNote(m.text); last = this.receive(id, { kind: 'received', id: `recv-${turn + 1}-${i}`, at: ev.at, turn: turn + 1, from: sender ?? m.name ?? m.from, text }, { ...m, ...(sender ? { sender } : {}) }); });
          return last;
        }
        const ledge = ledgeMessages(ev.text);
        if (ledge) { // a Ledge session's message: the same, the sender known by its name alone
          this.turns.set(id, turn + 1);
          let last: ThreadItem | undefined;
          ledge.forEach((m, i) => { last = this.receive(id, { kind: 'received', id: `recv-${turn + 1}-${i}`, at: ev.at, turn: turn + 1, from: m.from, text: m.text }, m); });
          return last;
        }
        const notices = crossSessionNotices(ev.text);
        if (notices) { // the harness's notices: the agent's turn on them, a system event each, no prompt
          this.turns.set(id, turn + 1);
          let last: ThreadItem | undefined;
          notices.forEach((n, i) => { last = this.put(id, this.noticeOf(n, { id: `notice-${turn + 1}-${i}`, at: ev.at, turn: turn + 1 })); });
          return last;
        }
        const failed = ledgeNotice(ev.text);
        if (failed) { // Ledge telling this session one of its messages was not delivered: a system event, no prompt
          this.turns.set(id, turn + 1);
          const peer = this.peerOf(failed.to);
          return this.put(id, { kind: 'notice', id: `notice-${turn + 1}-0`, at: ev.at, turn: turn + 1, notice: 'delivery', status: 'refused', count: 1, recipients: [failed.to],
            name: failed.to, ...(peer ? { peer } : {}), ...(failed.reason ? { reason: failed.reason } : {}), text: failed.text });
        }
        const task = ledgeTask(ev.text);
        if (task) { // Ledge's pointer about a task: a system event, no prompt
          this.turns.set(id, turn + 1);
          const peer = task.from ? this.peerOf(task.from) : undefined;
          return this.put(id, { kind: 'notice', id: `notice-${turn + 1}-0`, at: ev.at, turn: turn + 1, notice: 'other', task: task.id,
            ...(task.from ? { name: task.from } : {}), ...(peer ? { peer } : {}), summary: task.text.replaceAll(' ⏎ ', '\n'), text: task.text });
        }
        const joined = ledgeTeamNotice(ev.text);
        if (joined) { // Ledge seating this session in a team: a system event, no prompt
          this.turns.set(id, turn + 1);
          return this.put(id, { kind: 'notice', id: `notice-${turn + 1}-0`, at: ev.at, turn: turn + 1, notice: 'other', team: joined.team, summary: joined.text.replaceAll(' ⏎ ', '\n'), text: joined.text });
        }
        this.turns.set(id, turn + 1);
        return this.put(id, { kind: 'prompt', id: `prompt-${turn + 1}`, at: ev.at, turn: turn + 1, text: ev.text });
      }
      case 'PreToolUse': {
        if (!ev.tool) return undefined;
        const existing = ev.toolUseId && this.items(id).find(i => i.id === ev.toolUseId);
        if (existing) return existing; // the result came first (parallel hooks): keep what it said
        if (ev.tool === 'SendMessage') return this.put(id, this.sentOf(ev, common, 'sending')); // a message to another agent: its card, not an action row
        const input = inputText(ev.toolInput);
        return this.put(id, { kind: 'tool', id: ev.toolUseId ?? `tool-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, label: ev.text ?? ev.tool, ...(input ? { input } : {}), status: 'running', files: filesOf(ev.tool, ev.toolInput) });
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (!ev.tool) return undefined;
        const failed = ev.name === 'PostToolUseFailure';
        if (ev.tool === 'SendMessage' && ev.toolUseId && this.mailed.has(ev.toolUseId)) return this.items(id).find(i => i.id === ev.toolUseId); // the hook denied it: the mailbox owns the card
        if (ev.tool === 'SendMessage') { // its card says delivered or not; read (the receiver's prompt came first) stays
          const sent = this.items(id).find((i): i is SentItem => i.kind === 'sent' && i.id === ev.toolUseId);
          if (sent?.status === 'read') return sent;
          return this.put(id, sent ? { ...sent, status: failed ? 'failed' : 'delivered' } : this.sentOf(ev, common, failed ? 'failed' : 'delivered')); // the result came first: the card from its input
        }
        const row = this.callFor(id, ev);
        // A harness that only says what changed once the action is done (OMP's edit): the files come from its result.
        const late = row && row.files.length === 0 && ev.toolInput ? filesOf(ev.tool, ev.toolInput) : [];
        // OMP's todo: the list it reports once done replaces the call's own arguments (which only say what changed).
        const plan = row && ev.tool === 'todo' && ev.toolInput ? inputText(ev.toolInput) : undefined;
        const base: ToolItem = row ? { ...row, ...(late.length ? { files: late } : {}), ...(plan ? { input: plan } : {}) } : { kind: 'tool', id: ev.toolUseId ?? `tool-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, label: ev.text ?? ev.tool, status: 'running', files: filesOf(ev.tool, ev.toolInput) };
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
        // Without a decision it answered a question (or the idle input line): no permission of the thread is its. Only a
        // close says so in the thread: it marks the question's own tool row (a question has no permission row) as dismissed.
        if (!ev.decision) {
          if (!ev.byClose) return undefined;
          const q = [...this.items(id)].reverse().find((i): i is ToolItem => i.kind === 'tool' && QUESTION_TOOLS.has(i.tool) && i.status === 'running' && !i.helperId);
          return q ? this.put(id, { ...q, status: 'unknown', byClose: true as const }) : undefined;
        }
        const perm = [...this.items(id)].reverse().find(i => i.kind === 'permission' && i.decision === undefined);
        return perm && perm.kind === 'permission' ? this.put(id, { ...perm, decision: ev.decision, ...(ev.byClose ? { byClose: true as const } : {}) }) : undefined;
      }
      case 'AgentMessage': {
        if (!ev.messageId || !ev.text) return undefined;
        const itemId = `msg-${ev.messageId}`;
        const prev = this.items(id).find(i => i.id === itemId);
        // The card keeps the moment its first words came; its text follows the stream.
        return this.put(id, { kind: 'reply', id: itemId, at: prev?.at ?? ev.at, turn: prev?.turn ?? turn, text: ev.text, ...(ev.helperId ? { helperId: ev.helperId } : {}) });
      }
      case 'Stop': {
        if (!ev.helperId) this.settle(id, i => i.turn === turn && !i.helperId);
        if (ev.streamed) return undefined;
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
    const since = opts.helperId ? items.find(i => i.id === opts.helperId)?.at : [...items].reverse().find(i => i.kind === 'prompt' || i.kind === 'received' || (i.kind === 'notice' && !i.outgoing))?.at; // an outgoing task card is mid-turn: not an anchor
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

  /** The mailbox has a message to send: its card, `sending`. A card of that id already (Claude's own PreToolUse) stays, marked as the mailbox's. */
  recordSent(senderId: string, m: { rid: string; at: string; to: string; peer?: string; text: string; summary?: string }): ThreadItem {
    this.mailed.add(m.rid);
    const existing = this.items(senderId).find((i): i is SentItem => i.kind === 'sent' && i.id === m.rid);
    if (existing) return this.put(senderId, { ...existing, ...(m.peer ? { peer: m.peer } : {}), via: 'ledge' });
    return this.put(senderId, { kind: 'sent', id: m.rid, at: m.at, turn: this.turns.get(senderId) ?? 0, to: m.to, ...(m.peer ? { peer: m.peer } : {}), ...(m.summary ? { summary: m.summary } : {}), text: m.text, status: 'sending', via: 'ledge' });
  }

  /**
   * A task the session handed over (issue #92): its card in the sender's thread, in the turn it is in (not a prompt).
   * One card per transmission: the same one again replaces it.
   */
  recordTask(senderId: string, n: { task: Task; tr: TaskTransmission; peer?: string }): ThreadItem {
    const { task, tr } = n;
    const what = { give: 'confiée à', pass: 'passée à', done: 'rendue à', refuse: 'refusée, rendue à', cancel: 'annulée pour' }[tr.op];
    const said = tr.op === 'pass' ? tr.note : task.result;
    return this.put(senderId, { kind: 'notice', id: `task-${task.id}-${tr.index}`, at: tr.at, turn: this.turns.get(senderId) ?? 0, notice: 'other',
      task: task.id, taskOp: tr.op, outgoing: true, name: tr.toName, ...(n.peer ? { peer: n.peer } : {}),
      summary: said ? `${task.title}\n${quote(said)}` : task.title, text: `Tâche « ${task.title} » ${what} ${tr.toName}${tr.op === 'done' ? ' (terminée)' : ''}` });
  }

  /** The mailbox's outcome for a card; a `read` card stays read. */
  markSent(senderId: string, rid: string, status: 'delivered' | 'failed'): void {
    const sent = this.items(senderId).find((i): i is SentItem => i.kind === 'sent' && i.id === rid);
    if (sent && sent.status !== 'read') this.put(senderId, { ...sent, status });
  }

  /** A SendMessage's card, from its input: `to` the address used, `peer` the Ledge session that address is. */
  private sentOf(ev: SessionEvent, common: { at: string; turn: number; helperId?: string }, status: SentItem['status']): SentItem {
    const input = ev.toolInput ?? {}; const to = typeof input.to === 'string' ? input.to : ''; const peer = to ? this.peerOf(to) : undefined;
    return { kind: 'sent', id: ev.toolUseId ?? `sent-${ev.at}`, ...common, to, ...(peer ? { peer } : {}), ...(typeof input.summary === 'string' && input.summary ? { summary: input.summary } : {}), text: typeof input.message === 'string' ? stripNote(input.message).text : '', status };
  }

  /** A notice as a thread item: the session it is about named, and its Ledge session when it is one. */
  private noticeOf(n: CrossSessionNotice, common: { id: string; at: string; turn: number }): NoticeItem {
    const base = { kind: 'notice' as const, ...common, notice: n.kind, text: n.text };
    if (n.kind === 'other') return base;
    if (n.kind === 'delivery') return { ...base, status: n.status, count: n.count, recipients: n.recipients, ...(n.reason ? { reason: n.reason } : {}) };
    const peer = n.peer ? this.peerOf(n.peer) : undefined;
    return {
      ...base, name: n.peer, ...(peer ? { peer } : {}),
      ...('time' in n && n.time ? { time: n.time } : {}), ...('summary' in n && n.summary ? { summary: n.summary } : {}), ...('reason' in n && n.reason ? { reason: n.reason } : {})
    };
  }

  /** Puts a received card, paired with the sender's sent one when the sender is a Ledge session: the last of its
   *  messages to this session not read yet, the one whose text starts like the body if any (the hook may have cut
   *  either), both read as Ledge types a body (a multi-line one arrives on one line). A message the mailbox typed names
   *  its id: the sent card of that id is the one, and its text replaces a pointer's. That sent one becomes read, in the sender's thread. */
  private receive(id: string, recv: ReceivedItem, m: { from: string; name?: string; sender?: string; id?: string }): ThreadItem {
    const peer = (m.sender ? this.peerOf(m.sender) : undefined) ?? this.peerOf(m.from) ?? (m.name ? this.peerOf(m.name) : undefined);
    if (!peer) return this.put(id, recv);
    const head = (t: string) => ledgeBody(t).trim().slice(0, 200);
    const open = this.items(peer).filter((i): i is SentItem => i.kind === 'sent' && i.peer === id && i.status !== 'read');
    const byId = m.id ? open.find(i => mailId(i.id) === m.id) : undefined;
    const sent = byId ?? [...open].reverse().find(i => head(i.text) === head(recv.text)) ?? open.at(-1);
    if (sent) this.put(peer, { ...sent, status: 'read', received: recv.id });
    return this.put(id, { ...recv, ...(byId ? { text: byId.text } : {}), peer, ...(sent ? { sent: sent.id } : {}) });
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
