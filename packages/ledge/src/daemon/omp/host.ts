import { randomBytes } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { AttachmentRef, OmpApproval, Session, SessionEvent } from '@ledge/protocol';
import { pickName } from '@ledge/protocol';
import { agentEnv, PARENT_AGENT_VARS } from '../../spawn.js';
import { log } from '../../log.js';
import type { Store } from '../store.js';
import type { AttachmentStore } from '../attachments.js';
import { withImages } from '../../attachmentText.js';
import { OmpRpc, RpcError, type Frame, type RpcOptions } from './rpc.js';
import { reapOwner, writeOwner } from './owner.js';
import { answerFor, askAnswerFor, newTracking, project, requestEvent, type Tracking } from './project.js';

/**
 * The daemon owns one `omp --mode rpc-ui` process per live OMP session and projects its stream onto the store
 * (spec 2026-10-20 §4 and §6). No pane, no keys: replies, interrupts and answers are commands and `extension_ui_response`s.
 */

export const OMP_BIN = 'omp';
/** The permission policy at launch unless the person chose another: ask before writes and executions. OMP's own default is `yolo`,
 *  never inherited silently; `write` or `yolo` (auto mode) only when asked for at launch, and kept by a resume. */
export const APPROVAL_MODE: OmpApproval = 'always-ask';

export interface OmpLaunch {
  cwd: string; name?: string; dirs?: string[]; model?: string; effort?: string; approval?: OmpApproval;
  /** Reuses this Ledge id (a resumed session keeps its own). */
  id?: string;
  /** The exact journal of the conversation to continue. */
  resumeFile?: string;
  /** A seat's role and team as its context (roles spec §3.5), and LEDGE_ROLE / LEDGE_TEAM. */
  appendSystemPrompt?: string; seatEnv?: Record<string, string>;
}
export interface OmpHostDeps {
  store: Store;
  /** The login-shell environment, as for a tmux agent. */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** Where each session's OMP journal lives: `<dir>/<id>`. */
  dir: string;
  command?: string[];
  spawn?: RpcOptions['spawn'];
  now?: () => string;
  /** Where pasted images are read from (a session reply that carries some). */
  attachments?: AttachmentStore;
}

/** How often a message still being written reaches the thread: a card updated this often reads as live without a frame per token. */
/** One JSONL frame, newline included (OMP's MAX_RPC_FRAME_BYTES): what Ledge sends must fit, there is no chunking in this direction. */
export const OMP_FRAME_MAX = 1_048_576;
/** Room for the request id and the command name around the message and the images. */
const FRAME_SLACK = 128;

export const STREAM_MS = 120;
interface Live { rpc: OmpRpc; tracking: Tracking; closing: boolean; generation: number; held: Map<string, SessionEvent>; flush: NodeJS.Timeout | null }

/** `--model` takes `provider/id`; the id alone is ambiguous across providers, so the picker's ids carry both. */
export const ompModelArgs = (model?: string, effort?: string): string[] => [...(model ? ['--model', model] : []), ...(effort ? ['--thinking', effort] : [])];

export function ompArgs(o: { dir: string; cwd: string; dirs?: string[]; model?: string; effort?: string; approval?: OmpApproval; resumeFile?: string; appendSystemPrompt?: string }): string[] {
  return ['--mode', 'rpc-ui', '--session-dir', o.dir, '--cwd', o.cwd, '--approval-mode', o.approval ?? APPROVAL_MODE, ...ompModelArgs(o.model, o.effort), ...(o.dirs ?? []).flatMap(d => ['--add-dir', d]), ...(o.resumeFile ? ['--resume', o.resumeFile] : []),
    ...(o.appendSystemPrompt ? ['--append-system-prompt', o.appendSystemPrompt] : [])];
}

interface OmpState { sessionFile?: string; sessionId?: string; model?: { id?: string; provider?: string }; thinkingLevel?: string }

export function createOmpHost(deps: OmpHostDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const command = deps.command ?? [OMP_BIN];
  const live = new Map<string, Live>();
  let generations = 0;

  async function startProcess(id: string, o: OmpLaunch): Promise<{ rpc: OmpRpc; state: OmpState }> {
    const dir = join(deps.dir, id);
    await mkdir(dir, { recursive: true });
    // A process left by a daemon that died is ended first: one writer per conversation.
    if (await reapOwner(dir)) log(`omp ${id}: ended the process a previous daemon left`);
    const env = agentEnv({ ...(await deps.env()), LEDGE_SESSION: id }, o.seatEnv ?? {});
    for (const v of PARENT_AGENT_VARS) delete env[v];
    const rpc = await OmpRpc.start({ command, args: ompArgs({ dir, ...o }), cwd: o.cwd, env, ...(deps.spawn ? { spawn: deps.spawn } : {}) });
    await writeOwner(dir, rpc.pid).catch(() => undefined);
    try {
      // One card for all the questions of an `ask` call; a refusal leaves OMP asking them one by one as `select`s, which work too.
      await rpc.request('set_ask_dialog', { enabled: true }).catch(() => undefined);
      // The subagents' lifecycle and events (not only their progress): what the thread and the sidebar show of a helper.
      await rpc.request('set_subagent_subscription', { level: 'events' }).catch(() => undefined);
      const state = await rpc.request<OmpState>('get_state');
      return { rpc, state };
    } catch (e) { await rpc.close(); throw e; }
  }

  /** Sends the held messages, oldest first. */
  function drain(id: string, l: Live): void {
    if (l.flush) { clearTimeout(l.flush); l.flush = null; }
    const held = [...l.held.values()]; l.held.clear();
    for (const e of held) store.apply(id, e);
  }

  function attach(id: string, rpc: OmpRpc): Live {
    const l: Live = { rpc, tracking: newTracking(randomBytes(3).toString('hex')), closing: false, generation: ++generations, held: new Map(), flush: null };
    live.set(id, l);
    rpc.onFrame(f => {
      if (live.get(id) !== l) return;
      for (const e of project(f, l.tracking, now())) {
        // A message in progress is held and sent as its latest text every STREAM_MS; anything else (its end included) goes at
        // once, after what was held, so the thread never shows an older text over a newer.
        if (e.name === 'AgentMessage' && e.streaming && e.messageId) {
          l.held.set(e.messageId, e);
          l.flush ??= setTimeout(() => { l.flush = null; drain(id, l); }, STREAM_MS);
          continue;
        }
        drain(id, l);
        store.apply(id, e);
      }
    });
    rpc.onBad(reason => log(`omp ${id}: dropped a frame (${reason})`));
    rpc.onExit(e => {
      if (live.get(id) === l) live.delete(id);
      if (l.closing) { if (l.flush) clearTimeout(l.flush); return; }
      drain(id, l);
      const detail = e.stderr.trim().split('\n').pop() ?? '';
      log(`omp ${id} ended unexpectedly (code ${e.code}, signal ${e.signal})${detail ? `: ${detail}` : ''}`);
      // The reason first (an `error` state keeps its text through the exit), then the end.
      if (e.code !== 0 && detail) store.apply(id, { name: 'StopFailure', at: now(), source: 'daemon', text: detail.slice(0, 300) });
      store.apply(id, { name: 'SessionEnd', at: now(), source: 'daemon', exitCode: e.code });
    });
    return l;
  }

  /** The message and the images that go in one frame: images are taken in order while the serialized command stays within OMP's limit; the others become brackets. */
  async function fitImages(text: string, refs: AttachmentRef[]): Promise<{ message: string; native: Array<{ type: 'image'; data: string; mimeType: string }> }> {
    if (refs.length === 0) return { message: text, native: [] };
    const store = deps.attachments; if (!store) throw new Error('images are not available');
    const loaded: Array<{ path: string; item: { type: 'image'; data: string; mimeType: string } | null }> = [];
    for (const r of refs) {
      const path = store.path(r.id); const file = await store.read(r.id);
      if (!path || !file) throw new Error('attachment missing');
      loaded.push({ path, item: { type: 'image', data: file.data.toString('base64'), mimeType: r.mime } });
    }
    // The message is sized as if every image were a bracket (the worst case), so moving one to a bracket never overflows.
    let used = Buffer.byteLength(JSON.stringify({ message: withImages(text, loaded.map(x => x.path)), images: [] })) + FRAME_SLACK + 1;
    for (const x of loaded) {
      const cost = Buffer.byteLength(JSON.stringify(x.item)) + 1;
      if (used + cost <= OMP_FRAME_MAX) used += cost; else x.item = null;
    }
    return { message: withImages(text, loaded.filter(x => !x.item).map(x => x.path)), native: loaded.flatMap(x => (x.item ? [x.item] : [])) };
  }

  return {
    /**
     * Starts OMP, waits for its handshake and its state, and records the session `idle`: usable. The record is not in the
     * store before that, so a launch that fails (no binary, no credentials) leaves nothing behind and throws the reason.
     */
    async launch(o: OmpLaunch): Promise<Session> {
      const taken = store.all();
      const used = new Set(taken.map(s => s.id));
      let id = o.id; if (id === undefined) do id = randomBytes(2).toString('hex'); while (used.has(id));
      const name = pickName(taken.filter(s => s.id !== id && s.state !== 'exited').map(s => s.name), o.name);
      const project = basename(o.cwd) || o.cwd;
      let started;
      try { started = await startProcess(id, o); }
      catch (e) { throw new Error(e instanceof RpcError || e instanceof Error ? e.message : String(e)); }
      const { rpc, state } = started;
      const at = now();
      const model = state.model?.provider && state.model.id ? `${state.model.provider}/${state.model.id}` : undefined;
      const session: Session = {
        id, name, tool: 'omp', backend: 'omp-rpc', cwd: o.cwd, project, title: `${name} · ${project}`, tmuxSession: null, state: 'idle', helpers: [],
        startedAt: at, lastActivityAt: at, source: 'launcher',
        ...(state.sessionId ? { agentSessionId: state.sessionId } : {}), ...(state.sessionFile ? { agentSessionFile: state.sessionFile } : {}),
        ...((o.model ?? model) ? { model: o.model ?? model! } : {}), ...((o.effort ?? state.thinkingLevel) ? { effort: o.effort ?? state.thinkingLevel! } : {}),
        ...(o.approval && o.approval !== APPROVAL_MODE ? { approval: o.approval } : {})
      };
      attach(id, rpc);
      store.upsert(session);
      return session;
    },

    /**
     * An instruction at rest starts a turn; while OMP works, it waits for the turn's end (`follow_up`), or redirects it (`steer`).
     * Images go natively (base64 content) while the frame fits OMP's limit; the rest are `[Image attached: <path>]` brackets in the message.
     */
    async send(id: string, text: string, mode: 'prompt' | 'follow_up' | 'steer' = 'prompt', images: AttachmentRef[] = []): Promise<void> {
      const l = live.get(id); if (!l) throw new Error('the session is not running');
      const { message, native } = await fitImages(text, images);
      const attachments = images.map(r => r.id);
      const entry = { text: message.trim(), attachments, ...(message !== text ? { shown: text.trim() } : {}) };
      if (mode === 'prompt') { l.tracking.echo.push(message.trim()); store.apply(id, { name: 'UserPromptSubmit', at: now(), source: 'daemon', text, ...(attachments.length > 0 ? { attachments } : {}) }); l.tracking.working = true; }
      else l.tracking.queued.push(entry);
      try { await l.rpc.request(mode, { message, ...(native.length > 0 ? { images: native } : {}) }); }
      catch (e) {
        if (mode === 'prompt') { l.tracking.working = false; l.tracking.echo.pop(); store.apply(id, { name: 'StopFailure', at: now(), source: 'daemon', text: (e as Error).message }); }
        else { const i = l.tracking.queued.lastIndexOf(entry); if (i !== -1) l.tracking.queued.splice(i, 1); }
        throw e;
      }
      // Accepted into OMP's queue: the thread shows it when its turn starts; the session moves now, so a front sees the instruction land.
      if (mode !== 'prompt') store.apply(id, { name: 'Notification', at: now(), source: 'daemon' });
    },

    /** `abort_and_restore_queue`: stops the work and takes back what waited in OMP's queue (the draft returned, nothing sent again), each with its images. */
    async interruptAndRestore(id: string): Promise<{ entries: Array<{ text: string; attachments: string[] }>; imagesDropped: boolean }> {
      const l = live.get(id); if (!l) throw new Error('the session is not running');
      const r = await l.rpc.request<{ steering?: Array<{ text?: unknown }>; followUp?: Array<{ text?: unknown }>; imagesDropped?: unknown }>('abort_and_restore_queue');
      const imagesDropped = r.imagesDropped === true;
      const entries = [...(r.steering ?? []), ...(r.followUp ?? [])].map(x => (typeof x.text === 'string' ? x.text : '')).map(text => {
        // Paired by text, in order: OMP's own entries carry the words, the host remembers which images went with them.
        const i = l.tracking.queued.findIndex(q => q.text === text.trim());
        const q = i === -1 ? undefined : l.tracking.queued.splice(i, 1)[0];
        return { text: q?.shown ?? text, attachments: imagesDropped ? [] : q?.attachments ?? [] };
      }).filter(e => e.text !== '' || e.attachments.length > 0);
      l.tracking.queued = [];
      return { entries, imagesDropped };
    },

    /** `abort` stops the work, not the session: the state follows OMP's own `session_settled`. */
    async interrupt(id: string): Promise<void> {
      const l = live.get(id); if (!l) throw new Error('the session is not running');
      await l.rpc.request('abort');
    },

    /** Answers the dialog OMP waits on. Null once written, the refusal otherwise; an answer to a request that is gone is refused. */
    async answer(id: string, text: string): Promise<string | null> {
      const l = live.get(id); if (!l) return 'the session is not running';
      const open = l.tracking.requests[0]; if (!open) return 'nothing to answer';
      const a = answerFor(open, text);
      if ('refused' in a) return a.refused;
      l.tracking.requests.shift(); // before the write: a second answer in flight finds the next dialog, never this one again
      try { await l.rpc.write(a.frame); }
      catch (e) { l.tracking.requests.unshift(open); return (e as Error).message; }
      store.apply(id, { name: 'Decided', at: now(), source: 'daemon' });
      const next = l.tracking.requests[0];
      if (next) store.apply(id, requestEvent(next, now()));
      return null;
    },

    /**
     * Changes the model and then the effort of a live session without restarting it (spec §3.4). The two commands are not one
     * transaction: a model that changed stays changed when its effort is refused, and the error says so. OMP clears the level
     * for an unknown name instead of refusing it, so the effort is checked against the levels the new model offers first.
     * The caller holds the session at rest.
     */
    async setModel(id: string, pick: { model?: string; effort?: string }): Promise<void> {
      const l = live.get(id); if (!l) throw new Error('the session is not running');
      if (pick.model) {
        const slash = pick.model.indexOf('/');
        if (slash < 1 || slash === pick.model.length - 1) throw new Error('an OMP model is named provider/id');
        await l.rpc.request('set_model', { provider: pick.model.slice(0, slash), modelId: pick.model.slice(slash + 1) });
      }
      let failure: Error | null = null;
      if (pick.effort) {
        try {
          const { levels } = await l.rpc.request<{ levels?: string[] }>('get_available_thinking_levels');
          if (!levels?.includes(pick.effort)) throw new Error(`this model offers no effort “${pick.effort}”`);
          await l.rpc.request('set_thinking_level', { level: pick.effort });
        } catch (e) { failure = e as Error; }
      }
      const state = await l.rpc.request<OmpState>('get_state');
      const cur = store.get(id);
      if (cur) {
        const { modelNext: _n, ...rest } = cur;
        const model = state.model?.provider && state.model.id ? `${state.model.provider}/${state.model.id}` : cur.model;
        const { effort: _e, model: _m, ...bare } = rest;
        store.upsert({ ...bare, ...(model ? { model } : {}), ...(state.thinkingLevel ? { effort: state.thinkingLevel } : {}) });
      }
      if (failure) throw new Error(`the model changed, but its effort did not: ${failure.message}`);
    },

    /**
     * Answers the `ask` dialog `requestId` with every question's answer, or declines it (`cancel`). Refused when that dialog is not
     * the one OMP waits on now (another front answered it, OMP withdrew it): nothing is written for a stale view.
     */
    async answerAsk(id: string, requestId: string, answers: ReadonlyArray<{ id: string; selected: string[]; text?: string }>, cancel = false): Promise<string | null> {
      const l = live.get(id); if (!l) return 'the session is not running';
      const open = l.tracking.requests[0];
      if (!open || open.id !== requestId) return 'the request changed, look again';
      const a = cancel ? { frame: { type: 'extension_ui_response', id: open.id, cancelled: true } } : askAnswerFor(open, answers);
      if ('refused' in a) return a.refused;
      l.tracking.requests.shift();
      try { await l.rpc.write(a.frame); }
      catch (e) { l.tracking.requests.unshift(open); return (e as Error).message; }
      store.apply(id, { name: 'Decided', at: now(), source: 'daemon' });
      const next = l.tracking.requests[0];
      if (next) store.apply(id, requestEvent(next, now()));
      return null;
    },

    /** Stops the process the way the owner asks: its input closes, OMP saves and leaves. The caller records the end. */
    async close(id: string): Promise<void> {
      const l = live.get(id); if (!l) return;
      l.closing = true; live.delete(id);
      await l.rpc.close();
    },
    async closeAll(): Promise<void> { await Promise.all([...live.keys()].map(id => this.close(id))); },
    isLive: (id: string) => live.has(id),
    pidOf: (id: string) => live.get(id)?.rpc.pid,
    liveCount: () => live.size,
    /** The `models.list` of OMP: a process of its own, no session, closed once asked. */
    async catalog(cwd: string): Promise<{ models: unknown[]; current?: { id?: string; provider?: string } }> {
      const env = await deps.env();
      const rpc = await OmpRpc.start({ command, args: ['--mode', 'rpc-ui', '--cwd', cwd, '--no-session', '--no-extensions', '--approval-mode', APPROVAL_MODE], cwd, env, ...(deps.spawn ? { spawn: deps.spawn } : {}) });
      try {
        const [list, state] = await Promise.all([rpc.request<{ models?: unknown[] }>('get_available_models'), rpc.request<OmpState>('get_state')]);
        return { models: list.models ?? [], ...(state.model ? { current: state.model } : {}) };
      } finally { await rpc.close(); }
    }
  };
}
export type OmpHost = ReturnType<typeof createOmpHost>;
export type { Frame };
