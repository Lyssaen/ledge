import { randomBytes } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Session } from '@ledge/protocol';
import { pickName } from '@ledge/protocol';
import { agentEnv, PARENT_AGENT_VARS } from '../../spawn.js';
import { log } from '../../log.js';
import type { Store } from '../store.js';
import { OmpRpc, RpcError, type Frame, type RpcOptions } from './rpc.js';
import { answerFor, newTracking, project, requestEvent, type Tracking } from './project.js';

/**
 * The daemon owns one `omp --mode rpc-ui` process per live OMP session and projects its stream onto the store
 * (spec 2026-10-20 §4 and §6). No pane, no keys: replies, interrupts and answers are commands and `extension_ui_response`s.
 */

export const OMP_BIN = 'omp';
/** The permission policy at launch: ask before writes and executions. OMP's own default is `yolo`, never inherited silently. */
export const APPROVAL_MODE = 'always-ask';

export interface OmpLaunch {
  cwd: string; name?: string; dirs?: string[]; model?: string; effort?: string;
  /** Reuses this Ledge id (a resumed session keeps its own). */
  id?: string;
  /** The exact journal of the conversation to continue. */
  resumeFile?: string;
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
}

interface Live { rpc: OmpRpc; tracking: Tracking; closing: boolean; generation: number }

/** `--model` takes `provider/id`; the id alone is ambiguous across providers, so the picker's ids carry both. */
export const ompModelArgs = (model?: string, effort?: string): string[] => [...(model ? ['--model', model] : []), ...(effort ? ['--thinking', effort] : [])];

export function ompArgs(o: { dir: string; cwd: string; dirs?: string[]; model?: string; effort?: string; resumeFile?: string }): string[] {
  return ['--mode', 'rpc-ui', '--session-dir', o.dir, '--cwd', o.cwd, '--approval-mode', APPROVAL_MODE, ...ompModelArgs(o.model, o.effort), ...(o.dirs ?? []).flatMap(d => ['--add-dir', d]), ...(o.resumeFile ? ['--resume', o.resumeFile] : [])];
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
    const env = agentEnv({ ...(await deps.env()), LEDGE_SESSION: id }, {});
    for (const v of PARENT_AGENT_VARS) delete env[v];
    const rpc = await OmpRpc.start({ command, args: ompArgs({ dir, ...o }), cwd: o.cwd, env, ...(deps.spawn ? { spawn: deps.spawn } : {}) });
    try {
      // Protocol 1 only: a protocol-2 frame never reaches us because we never ask for it.
      const state = await rpc.request<OmpState>('get_state');
      return { rpc, state };
    } catch (e) { await rpc.close(); throw e; }
  }

  function attach(id: string, rpc: OmpRpc): Live {
    const l: Live = { rpc, tracking: newTracking(), closing: false, generation: ++generations };
    live.set(id, l);
    rpc.onFrame(f => {
      if (live.get(id) !== l) return;
      const events = project(f, l.tracking, now());
      for (const e of events) store.apply(id, e);
    });
    rpc.onBad(reason => log(`omp ${id}: dropped a frame (${reason})`));
    rpc.onExit(e => {
      if (live.get(id) === l) live.delete(id);
      if (l.closing) return;
      const detail = e.stderr.trim().split('\n').pop() ?? '';
      log(`omp ${id} ended unexpectedly (code ${e.code}, signal ${e.signal})${detail ? `: ${detail}` : ''}`);
      // The reason first (an `error` state keeps its text through the exit), then the end.
      if (e.code !== 0 && detail) store.apply(id, { name: 'StopFailure', at: now(), source: 'daemon', text: detail.slice(0, 300) });
      store.apply(id, { name: 'SessionEnd', at: now(), source: 'daemon', exitCode: e.code });
    });
    return l;
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
        ...((o.model ?? model) ? { model: o.model ?? model! } : {}), ...((o.effort ?? state.thinkingLevel) ? { effort: o.effort ?? state.thinkingLevel! } : {})
      };
      attach(id, rpc);
      store.upsert(session);
      return session;
    },

    /** An instruction at rest starts a turn; while OMP works, it waits for the turn's end (`follow_up`), or redirects it (`steer`). */
    async send(id: string, text: string, mode: 'prompt' | 'follow_up' | 'steer' = 'prompt'): Promise<void> {
      const l = live.get(id); if (!l) throw new Error('the session is not running');
      if (mode === 'prompt') store.apply(id, { name: 'UserPromptSubmit', at: now(), source: 'daemon', text });
      l.tracking.working = mode === 'prompt' ? true : l.tracking.working;
      try { await l.rpc.request(mode, { message: text }); }
      catch (e) {
        if (mode === 'prompt') { l.tracking.working = false; store.apply(id, { name: 'StopFailure', at: now(), source: 'daemon', text: (e as Error).message }); }
        throw e;
      }
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
