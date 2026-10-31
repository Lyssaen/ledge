import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { BrainStatus, Session, Tool } from '@ledge/protocol';
import type { Store } from '../store.js';
import type { Memory } from './memory.js';
import { brainInstructions, BRAIN_DECISIONS } from './persona.js';
import { isBrainTool, readBrainSettings, writeBrainSettings, type BrainSettings } from './settings.js';
import { log } from '../../log.js';

export const RESTARTS_MAX = 3, RESTART_WINDOW_MS = 600_000;
/** The first brain's id (tmux `ledge-brain`); a relief or a replacement takes `brain-<hex>`. */
export const BRAIN_ID = 'brain';
export const BRAIN_NAME = 'Ledge';
export const SHIM_TEXT = "Le cerveau de Ledge passe par `ledge brain …` (rig, tmux et l'API d'OpenRig lui sont fermés).";
const SHIM = `#!/bin/sh\necho "${SHIM_TEXT.replace(/[`"$\\]/g, c => `\\${c}`)}" >&2\nexit 1\n`;
/**
 * The Claude brain may run `ledge brain …` without asking, and nothing else is widened (ruling C12): the user's own settings
 * merge with these, so the default mode is pinned here (and by `brainArgs`, which beats every settings file) and the doors
 * the brain must not use are denied.
 */
export const BRAIN_CLAUDE_SETTINGS = { permissions: { defaultMode: 'default', allow: ['Bash(ledge brain:*)'],
  deny: ['Bash(rig:*)', 'Bash(tmux:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'WebFetch'] } };

/** Arguments every brain launch and resume carries: a Claude brain never inherits auto or bypass mode from the user's settings. */
export function brainArgs(tool: Tool): string[] {
  return tool === 'claude' ? ['--permission-mode', 'default'] : [];
}

/** The brain's own environment on top of the agent's: the shims first in PATH, and LEDGE_BRAIN. */
export function brainEnv(dir: string, base: NodeJS.ProcessEnv): Record<string, string> {
  return { PATH: `${join(dir, 'bin')}:${base.PATH ?? ''}`, LEDGE_BRAIN: '1' };
}

export interface BrainLaunch {
  tool: Tool; cwd: string; env: Record<string, string>; id: string; name: string; prompt?: string;
  /** An exited brain record whose conversation is taken up again (`session.resume`). */
  resume?: Session;
}

export interface Brain {
  status(): BrainStatus;
  /** The live `brain: true` session. */
  session(): Session | undefined;
  /** Refuses a tool that cannot be the brain (OMP) by throwing, in French. */
  set(o: { enabled: boolean; tool?: Tool }): Promise<void>;
  start(): Promise<void>;
  /** Closes the live brain on purpose (no relaunch); the settings are left as they are. */
  stop(): Promise<void>;
  /** An exit of this session about to happen is not a death: a relief closing the old brain (Task 10). */
  expectExit(id: string): void;
  onStatus(fn: (s: BrainStatus) => void): () => void;
  /** Resolves once no launch is under way (tests, and callers that need the outcome of a relaunch). */
  settled(): Promise<void>;
  dispose(): void;
}

export interface BrainDeps {
  store: Store; settingsPath: string; dir: string;
  launch(o: BrainLaunch): Promise<Session>;
  close(s: Session): Promise<unknown>;
  mandate(): Promise<string>;
  memory: Memory;
  /** The agents' environment (login shell): its PATH goes after the shims. */
  env?: () => Promise<NodeJS.ProcessEnv>;
  now?: () => number;
}

const liveBrain = (s: Session): boolean => s.brain === true && s.state !== 'exited' && s.archivedAt === undefined;

export function createBrain(d: BrainDeps): Brain {
  const now = d.now ?? Date.now;
  const env = d.env ?? (async () => process.env);
  let settings: BrainSettings = readBrainSettings(d.settingsPath);
  /** Relaunch times inside the window. */
  let restarts: number[] = [];
  let down: string | undefined;
  /** A launch under way: nothing alive in the store yet, but the brain is starting. */
  let launching: Promise<void> | null = null;
  /** A brain that died while a launch was in flight, judged once that launch is over. */
  let deferred: string | undefined;
  /** Ids whose next exit is intended (stop, disable, relief). */
  const expected = new Set<string>();
  /** Each brain session's state last seen, so a death is seen once, on the change to exited. */
  const seen = new Map<string, Session['state']>();
  const listeners = new Set<(s: BrainStatus) => void>();
  let last = '';

  const session = (): Session | undefined => d.store.all().find(liveBrain);

  const status = (): BrainStatus => {
    const s = session();
    const t = now();
    const base = { tool: settings.tool, enabled: settings.enabled, restarts: restarts.filter(x => t - x < RESTART_WINDOW_MS).length };
    const alive = (): BrainStatus => {
      const ctx = s!.context;
      return { state: s!.state === 'starting' ? 'starting' : 'on', ...base, sessionId: s!.id, ...(ctx && ctx.window > 0 ? { contextPct: Math.round(ctx.used / ctx.window * 100) } : {}) };
    };
    // A brain still alive is never shown off (a close that failed leaves it running).
    if (settings.enabled !== true) return s ? alive() : { state: 'off', ...base };
    if (down !== undefined) return { state: 'down', ...base, reason: down };
    if (!s) return { state: 'starting', ...base };
    return alive();
  };
  const emit = (): void => {
    const s = status(); const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    for (const fn of [...listeners]) { try { fn(s); } catch (e) { log(`brain status listener failed: ${(e as Error).message}`); } }
  };

  /** CLAUDE.md, AGENTS.md, the shims and (Claude) the narrow allowlist, rewritten at every start. */
  async function prepare(tool: Tool): Promise<void> {
    const bin = join(d.dir, 'bin');
    await mkdir(bin, { recursive: true });
    for (const shim of ['rig', 'tmux']) { const f = join(bin, shim); await writeFile(f, SHIM); await chmod(f, 0o755); }
    const text = brainInstructions({ mandate: await d.mandate(), rules: d.memory.rules(), decisions: d.memory.decisions({ limit: BRAIN_DECISIONS }), tool });
    await writeFile(join(d.dir, 'CLAUDE.md'), text);
    await writeFile(join(d.dir, 'AGENTS.md'), text);
    if (tool === 'claude') {
      await mkdir(join(d.dir, '.claude'), { recursive: true });
      await writeFile(join(d.dir, '.claude', 'settings.json'), `${JSON.stringify(BRAIN_CLAUDE_SETTINGS, null, 2)}\n`);
    }
  }

  const freeId = (): string => {
    if (!d.store.get(BRAIN_ID)) return BRAIN_ID;
    let id: string; do id = `brain-${randomBytes(2).toString('hex')}`; while (d.store.get(id));
    return id;
  };

  /** Launches the brain (taking up `resume`'s conversation when given); a failed launch marks it down. */
  function run(resume?: Session): Promise<void> {
    if (launching) return launching;
    const tool = settings.tool;
    const p = (async () => {
      try {
        await prepare(tool);
        const e = brainEnv(d.dir, await env());
        const usable = resume && resume.tool === tool ? resume : undefined;
        const s = await d.launch({ tool, cwd: d.dir, env: e, id: usable?.id ?? freeId(), name: BRAIN_NAME, ...(usable ? { resume: usable } : {}) });
        seen.set(s.id, s.state);
      } catch (err) {
        down = `Le cerveau n'a pas pu démarrer : ${(err as Error).message}`;
        log(`brain launch failed: ${(err as Error).message}`);
      }
    })().finally(() => {
      launching = null;
      // A death that landed while this launch was in flight was set aside: looked at again now.
      const id = deferred; deferred = undefined;
      const dead = id !== undefined ? d.store.get(id) : undefined;
      if (dead && dead.state === 'exited' && dead.archivedAt === undefined) onExit(dead);
      emit();
    });
    launching = p;
    emit();
    return p;
  }

  async function start(): Promise<void> {
    settings = readBrainSettings(d.settingsPath);
    if (settings.enabled !== true || down !== undefined) return emit();
    if (launching) return launching;
    const alive = session();
    if (alive) { seen.set(alive.id, alive.state); return emit(); } // adopted as it is
    const exited = d.store.all().filter(s => s.brain === true && s.state === 'exited' && s.archivedAt === undefined)
      .sort((a, b) => (b.exitedAt ?? '').localeCompare(a.exitedAt ?? ''))[0];
    return run(exited);
  }

  async function stop(): Promise<void> {
    if (launching) await launching;
    const s = session(); if (!s) return emit();
    expected.add(s.id);
    try { await d.close(s); }
    catch (e) { expected.delete(s.id); log(`brain close failed: ${(e as Error).message}`); throw e; }
    finally { emit(); }
  }

  async function set(o: { enabled: boolean; tool?: Tool }): Promise<void> {
    if (o.tool !== undefined && !isBrainTool(o.tool)) throw new Error(`${o.tool === 'omp' ? 'OMP' : o.tool} ne peut pas être le cerveau de Ledge : choisis Claude Code, Codex ou Cursor.`);
    const tool = o.tool ?? settings.tool;
    const changed = tool !== settings.tool;
    settings = { ...readBrainSettings(d.settingsPath), enabled: o.enabled, tool };
    await writeBrainSettings(d.settingsPath, settings);
    if (!o.enabled) { down = undefined; restarts = []; await stop(); return emit(); }
    if (down !== undefined) { down = undefined; restarts = []; }
    const alive = session();
    if (alive && (changed || alive.tool !== tool)) await stop();
    else if (alive) return emit();
    if (launching) await launching;
    if (session()) return emit();
    // A new tool starts a new conversation; otherwise the last exited brain's is taken up.
    const exited = changed ? undefined : d.store.all().filter(s => s.brain === true && s.state === 'exited' && s.archivedAt === undefined && s.tool === tool)
      .sort((a, b) => (b.exitedAt ?? '').localeCompare(a.exitedAt ?? ''))[0];
    await run(exited);
  }

  /** A brain session gone to exited: intended, a handover's, or a death the breaker counts. */
  function onExit(s: Session): void {
    if (expected.delete(s.id)) return;
    const h = s.handover?.state;
    if (h === 'launching' || h === 'done') return; // the relief closes the old brain (C10; Task 10 completes it)
    if (launching) { deferred = s.id; return; } // looked at again once that launch is over
    if (settings.enabled !== true || down !== undefined || session()) return;
    const t = now();
    restarts = restarts.filter(x => t - x < RESTART_WINDOW_MS);
    if (restarts.length >= RESTARTS_MAX) {
      down = s.lastError?.trim() ? s.lastError.trim().split('\n').slice(-3).join('\n') : s.exitCode != null ? `sorti avec le code ${s.exitCode}` : `Le cerveau est tombé ${RESTARTS_MAX + 1} fois en 10 min.`;
      log(`brain down after ${RESTARTS_MAX} restarts: ${down}`);
      return emit();
    }
    restarts.push(t);
    log(`brain ${s.id} exited, relaunched (${restarts.length}/${RESTARTS_MAX})`);
    void run(s);
  }

  for (const s of d.store.all()) if (s.brain === true) seen.set(s.id, s.state); // a brain loaded from the journal dies like any other
  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'removed') { seen.delete(c.id); expected.delete(c.id); return emit(); }
    if (c.type !== 'updated' || c.session.brain !== true) return;
    const was = seen.get(c.session.id); seen.set(c.session.id, c.session.state);
    if (c.session.state === 'exited' && was !== undefined && was !== 'exited') onExit(c.session);
    emit();
  });

  return {
    status, session, set, start, stop,
    expectExit: id => { expected.add(id); },
    onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    settled: async () => { while (launching) await launching; },
    dispose: () => { unsubscribe(); listeners.clear(); }
  };
}
