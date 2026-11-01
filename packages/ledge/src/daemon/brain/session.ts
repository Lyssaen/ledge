import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { BrainStatus, Session, Tool } from '@ledge/protocol';
import type { Store } from '../store.js';
import type { Memory } from './memory.js';
import { brainInstructions, BRAIN_DECISIONS } from './persona.js';
import { isBrainTool, readBrainSettings, writeBrainSettings, type BrainSettings } from './settings.js';
import { log } from '../../log.js';
import { checkCodexGuard } from './codexGuard.js';

export const RESTARTS_MAX = 3, RESTART_WINDOW_MS = 600_000;
/** The share of its context past which the brain is relieved (Global Constraints). */
export const BRAIN_CONTEXT_RELIEF = 0.7;
/** The tools whose context Ledge measures (`readContext`): a Cursor brain is relieved by the day only (ruling C11). */
const MEASURED: readonly Tool[] = ['claude', 'codex'];

/** A local date, YYYY-MM-DD: the brain's day starts at local midnight. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
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

/**
 * Arguments every brain launch and resume carries, so the brain never inherits an autonomous mode from the user's own config:
 * Claude in its default permission mode, Codex asking on request (what `autonomyArgs` gives `edits`, never `never` nor a bypass).
 * Cursor Agent has no flag that forces asking: it is left without `--force` (its only autonomous switch here), and its own
 * config still applies.
 */
export function brainArgs(tool: Tool): string[] {
  switch (tool) {
    case 'claude': return ['--permission-mode', 'default'];
    case 'codex': return ['--no-daemon', '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'];
    default: return [];
  }
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

/** What the brain's relief launches with (Task 10): its own id, the name « Ledge », its folder, env and fresh instructions. */
export interface BrainRelief { id: string; name: string; cwd: string; env: Record<string, string>; instructions: string }

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
  /**
   * Starts the brain's relief when it is due (Task 10): its context at 70 % (Claude, Codex), or a new day once it is free.
   * Never while one runs. The day is rewritten when a relief starts.
   */
  checkRelief(o: { context?: Session['context']; today: string; idle: boolean }): 'context' | 'day' | null;
  /** Prepares the relief of brain `s` (instructions rewritten with fresh memory, shims): what `handovers` launches it with. */
  relief(s: Session): Promise<BrainRelief>;
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
  /** Override the guard probe in tests. */
  codexGuard?: (cwd: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
  /** The reliefs (daemon/handover.ts), which `checkRelief` starts. */
  handovers?: { start(id: string, o?: { auto?: boolean }): string | null };
}

const liveBrain = (s: Session): boolean => s.brain === true && s.state !== 'exited' && s.archivedAt === undefined;

export function createBrain(d: BrainDeps): Brain {
  const now = d.now ?? Date.now;
  const env = d.env ?? (async () => process.env);
  let settings: BrainSettings = readBrainSettings(d.settingsPath);
  /** brain.json read again, keeping the latest relief day (one written here may not have reached the file yet). */
  const reread = (): BrainSettings => {
    const f = readBrainSettings(d.settingsPath);
    const day = [f.day, settings.day].filter((x): x is string => !!x).sort().at(-1);
    return { ...f, ...(day ? { day } : {}) };
  };
  /** Relaunch times inside the window. */
  let restarts: number[] = [];
  let down: string | undefined;
  /** A launch under way: nothing alive in the store yet, but the brain is starting. */
  let launching: Promise<void> | null = null;
  /** A brain that died while a launch was in flight, judged once that launch is over. */
  let deferred: string | undefined;
  /** Ids whose next exit is intended (stop, disable, relief). */
  const expected = new Set<string>();
  /** Reliefs prepared and not yet seen alive: one that comes up once the brain is off, or on another tool, is closed. */
  const relieving = new Set<string>();
  /** Brains whose exit was left to their relief (handover launching): judged as a death if that relief fails. */
  const leftToRelief = new Set<string>();
  /** Each brain session's state last seen, so a death is seen once, on the change to exited. */
  const seen = new Map<string, Session['state']>();
  const listeners = new Set<(s: BrainStatus) => void>();
  let last = '';

  /** The live brain; while a relief is under way, the relief (the one being handed over is on its way out). */
  const session = (): Session | undefined => {
    const live = d.store.all().filter(liveBrain);
    return live.find(s => s.handover?.state !== 'launching' && s.handover?.state !== 'done') ?? live[0];
  };

  /** brain.json writes, one at a time (they share a temporary file), in the order asked. */
  let writing: Promise<void> = Promise.resolve();
  const save = (make: () => BrainSettings): Promise<void> => {
    const p = writing.then(() => writeBrainSettings(d.settingsPath, make()));
    writing = p.catch(() => undefined);
    return p;
  };
  /** The day of the last relief (or of a fresh launch), kept in brain.json. */
  const markDay = (day: string): void => {
    if (settings.day === day) return;
    settings = { ...settings, day };
    save(() => ({ ...reread(), day })).catch(e => log(`brain day not written: ${(e as Error).message}`));
  };

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
  async function prepare(tool: Tool): Promise<string> {
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
    return text;
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
        const base = await env();
        if (tool === 'codex' && !(await (d.codexGuard ?? checkCodexGuard)(d.dir, base))) throw new Error('Le hook Codex Ledge doit être à jour, actif et approuvé avant de démarrer le cerveau.');
        const e = brainEnv(d.dir, base);
        const usable = resume && resume.tool === tool ? resume : undefined;
        const s = await d.launch({ tool, cwd: d.dir, env: e, id: usable?.id ?? freeId(), name: BRAIN_NAME, ...(usable ? { resume: usable } : {}) });
        seen.set(s.id, s.state);
        if (!usable) markDay(localDay(new Date(now()))); // a fresh brain is not relieved the day it starts
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
    settings = reread();
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
    settings = { ...reread(), enabled: o.enabled, tool };
    const next = settings;
    await save(() => next);
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
    if (h === 'launching' || h === 'done') { if (h === 'launching') leftToRelief.add(s.id); return; } // its relief takes over (C10)
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

  function checkRelief(o: { context?: Session['context']; today: string; idle: boolean }): 'context' | 'day' | null {
    const s = session();
    if (!s || !d.handovers) return null;
    const h = s.handover?.state;
    if (h === 'briefing' || h === 'launching' || h === 'done') return null;
    const c = o.context;
    // A relief that failed is not retried on the context at every turn: the next day's relief takes over.
    const kind = c && c.window > 0 && c.used / c.window >= BRAIN_CONTEXT_RELIEF && MEASURED.includes(s.tool) && h !== 'failed' ? 'context'
      : settings.day !== o.today && o.idle ? 'day' : null;
    if (!kind) return null;
    const refused = d.handovers.start(s.id, { auto: true });
    if (refused) { log(`brain relief (${kind}) not started: ${refused}`); return null; }
    markDay(o.today);
    log(`brain relief (${kind}) of ${s.id} started`);
    return kind;
  }

  /** Why a relief of `s` must not be launched now (the brain disabled, or moved to another tool), else undefined. */
  const stale = (tool: Tool): string | undefined => settings.enabled !== true ? 'le cerveau de Ledge est arrêté'
    : tool !== settings.tool ? 'le cerveau de Ledge a changé d\'outil' : undefined;

  async function relief(s: Session): Promise<BrainRelief> {
    const tool = s.tool;
    { const why = stale(tool); if (why) throw new Error(why); }
    const instructions = await prepare(tool);
    const base = await env();
    if (tool === 'codex' && !(await (d.codexGuard ?? checkCodexGuard)(d.dir, base))) throw new Error('Le hook Codex Ledge doit être à jour, actif et approuvé avant la relève.');
    const e = brainEnv(d.dir, base);
    { const why = stale(tool); if (why) throw new Error(why); } // the user may have stopped it meanwhile
    const id = freeId();
    relieving.add(id);
    return { id, name: BRAIN_NAME, cwd: d.dir, env: e, instructions };
  }

  for (const s of d.store.all()) if (s.brain === true) seen.set(s.id, s.state); // a brain loaded from the journal dies like any other
  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'removed') { seen.delete(c.id); expected.delete(c.id); relieving.delete(c.id); leftToRelief.delete(c.id); return emit(); }
    if (c.type !== 'updated' || c.session.brain !== true) return;
    const s = c.session;
    const was = seen.get(s.id); seen.set(s.id, s.state);
    // A relief whose launch was in flight when the user stopped the brain (or changed its tool) does not bring it back.
    if (relieving.delete(s.id) && s.state !== 'exited' && stale(s.tool)) {
      expected.add(s.id);
      log(`brain relief ${s.id} closed: ${stale(s.tool)}`);
      void d.close(s).catch(e => { expected.delete(s.id); log(`brain relief ${s.id} not closed: ${(e as Error).message}`); });
    }
    if (s.state === 'exited' && was !== undefined && was !== 'exited') onExit(s);
    // A brain that died while its relief was launching, and that relief failed: a death after all.
    else if (s.state === 'exited' && s.handover?.state === 'failed' && leftToRelief.delete(s.id)) onExit(s);
    if (s.handover?.state === 'done') leftToRelief.delete(s.id);
    emit();
  });

  return {
    status, session, set, start, stop, checkRelief, relief,
    expectExit: id => { expected.add(id); },
    onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    settled: async () => { while (launching) await launching; },
    dispose: () => { unsubscribe(); listeners.clear(); }
  };
}
