import type { PtyBackend, PtyHandle } from './backend';
import type { TermSurface } from './surface';
import type { TermTheme } from './theme';
import { reconnectDelay, type AgentMode } from './mode';

export type Tab = { kind: 'agent'; id: string }
  | { kind: 'shell'; id: string; n: number; dir: string; remote: boolean; status: 'idle' | 'running' | 'ended' | 'unavailable'; end?: { code: number | null; lost: boolean } };
type ShellTab = Extract<Tab, { kind: 'shell' }>;
export type AgentLink = { state: 'attached' | 'reconnecting' | 'off'; attempt: number; retryAt?: number };
export const agentTabId = (sessionId: string): string => `${sessionId}#agent`;
export interface TermDeps { backend: PtyBackend | null; surface(): TermSurface; agentArgv(id: string, readOnly: boolean): string[] | null; shellArgv(id: string): string[] | null; shellPlace(sessionId: string): { dir: string; remote: boolean; /** OMP: no agent tab, the pane holds shells only. */ native?: boolean }; now?(): number; setTimeout?: typeof setTimeout }

const OFF: AgentLink = { state: 'off', attempt: 0 };
/** `ssh`'s exit code when the connection fails or drops. */
const SSH_LOST = 255;
/** An attachment that held this long was a real connection: its drop starts the backoff over. */
const HELD_MS = 15000;

type Entry = { tabs: readonly Tab[]; active: string; next: number; link: AgentLink; offlineSince?: number; native: boolean };
/** One open (or opening) pseudo-terminal; it is current while the store still points at it, stale once replaced or dropped.
 *  `typed` holds what the xterm sends before the handle is there: ConPTY asks for the cursor as it starts and draws nothing,
 *  reads no key, until that answer comes. */
type Run = { handle: PtyHandle | null; typed: string[] };

/** Sends `data` to the run's process, or keeps it until the process is there. */
function type(run: Run | null, data: string): void {
  if (!run) return;
  if (run.handle) run.handle.write(data);
  else run.typed.push(data);
}

/** The run's process is there: what was typed while it opened goes first. */
function adoptHandle(run: Run, h: PtyHandle): void {
  run.handle = h;
  for (const d of run.typed.splice(0)) h.write(d);
}

/** The pane fits while the open is pending, with no handle to resize: the process learns the size as soon as it has one. */
function syncSize(h: PtyHandle, surface: TermSurface): void {
  const { cols, rows } = surface.size();
  h.resize(cols, rows);
}

/** Owns the tabs, their pseudo-terminals and their xterms outside React, so a shell outlives navigation and a hidden pane. */
export class TermStore {
  private readonly deps: TermDeps;
  private readonly entries = new Map<string, Entry>();
  private readonly surfaces = new Map<string, TermSurface>();
  private readonly shells = new Map<string, Run>();
  private readonly listeners = new Set<() => void>();
  /** The session whose agent tab the pane shows, and how. */
  private shown: { sid: string; mode: AgentMode; key: string } | null = null;
  private attachment: Run | null = null;
  /** The pending reconnection; a timer that fires after it was replaced or cancelled does nothing. */
  private retry: object | null = null;
  private drops = 0;
  private openedAt = 0;

  constructor(deps: TermDeps) { this.deps = deps; }

  tabs(sessionId: string): readonly Tab[] { return this.entry(sessionId).tabs; }

  active(sessionId: string): string { return this.entry(sessionId).active; }

  select(sessionId: string, tabId: string): void {
    const e = this.entry(sessionId);
    const tab = e.tabs.find(t => t.id === tabId);
    if (!tab) return;
    e.active = tabId;
    if (tab.kind === 'shell' && tab.status === 'idle') this.start(sessionId, tab);
    this.emit();
  }

  addShell(sessionId: string, dir: string, remote: boolean): string {
    const e = this.entry(sessionId);
    const tab: ShellTab = { kind: 'shell', id: `${sessionId}#shell-${e.next}`, n: e.next, dir, remote, status: 'idle' };
    e.next += 1;
    e.tabs = [...e.tabs, tab];
    this.emit();
    return tab.id;
  }

  close(sessionId: string, tabId: string): void {
    const e = this.entry(sessionId);
    if (!e.tabs.some(t => t.id === tabId && t.kind === 'shell')) return;
    // No confirmation: closing the tab kills the shell (spec §3). A shell still opening is closed when it resolves.
    this.shells.get(tabId)?.handle?.close();
    this.shells.delete(tabId);
    this.surfaces.get(tabId)?.dispose();
    this.surfaces.delete(tabId);
    e.tabs = e.tabs.filter(t => t.id !== tabId);
    // With no agent tab, the last shell closed leaves a fresh one (not started) rather than a pane of nothing.
    if (e.native && e.tabs.length === 0) {
      const shell: ShellTab = { kind: 'shell', id: `${sessionId}#shell-${e.next}`, n: e.next, dir: this.deps.shellPlace(sessionId).dir, remote: this.deps.shellPlace(sessionId).remote, status: 'idle' };
      e.next += 1; e.tabs = [shell];
    }
    if (e.active === tabId) e.active = e.native ? e.tabs[0]!.id : agentTabId(sessionId);
    this.emit();
  }

  reopen(sessionId: string, tabId: string): void {
    const tab = this.entry(sessionId).tabs.find(t => t.id === tabId);
    if (tab?.kind !== 'shell' || tab.status !== 'ended') return;
    this.start(sessionId, tab);
    this.emit();
  }

  showAgent(sessionId: string, mode: AgentMode): void {
    const key = JSON.stringify(mode);
    // Re-renders call this again and again: the same session in the same mode keeps its attachment.
    if (this.shown?.sid === sessionId && this.shown.key === key) return;
    this.leave();
    this.shown = { sid: sessionId, mode, key };
    this.drops = 0;
    const e = this.entry(sessionId);
    if (mode.kind === 'offline') {
      e.offlineSince ??= this.now();
      this.surfaces.get(agentTabId(sessionId))?.setReadOnly(true);
    } else if (mode.kind === 'live' || mode.kind === 'parent') {
      e.offlineSince = undefined;
      this.connect();
    } else if (mode.kind === 'native') {
      // No agent screen to show: the pane opens on its first shell, started now rather than left blank until its tab is clicked.
      const tab = e.tabs.find(t => t.id === e.active);
      if (tab?.kind === 'shell' && tab.status === 'idle') this.start(sessionId, tab);
    }
    this.emit();
  }

  hideAgent(): void {
    if (!this.shown) return;
    this.leave();
    this.shown = null;
    this.emit();
  }

  retryNow(sessionId: string): void {
    if (this.shown?.sid !== sessionId || !this.retry) return;
    this.retry = null;
    this.connect();
    this.emit();
  }

  /** Every xterm still open takes Ledge's new colours; the next ones are made with them. */
  setTheme(theme: TermTheme): void { for (const s of this.surfaces.values()) s.setTheme(theme); }

  link(sessionId: string): AgentLink { return this.entries.get(sessionId)?.link ?? OFF; }

  offlineSince(sessionId: string): number | undefined { return this.entries.get(sessionId)?.offlineSince; }

  surface(tabId: string): TermSurface | undefined { return this.surfaces.get(tabId); }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private entry(sessionId: string): Entry {
    let e = this.entries.get(sessionId);
    if (!e) {
      // The first shell opens where the session works, on its machine: asked once, when its tabs are made.
      const { dir, remote, native = false } = this.deps.shellPlace(sessionId);
      const shell: ShellTab = { kind: 'shell', id: `${sessionId}#shell-1`, n: 1, dir, remote, status: 'idle' };
      e = native ? { tabs: [shell], active: shell.id, next: 2, link: OFF, native }
        : { tabs: [{ kind: 'agent', id: agentTabId(sessionId) }, shell], active: agentTabId(sessionId), next: 2, link: OFF, native };
      this.entries.set(sessionId, e);
    }
    return e;
  }

  private emit(): void { for (const fn of [...this.listeners]) fn(); }

  private now(): number { return (this.deps.now ?? Date.now)(); }

  private setTab(sessionId: string, tabId: string, patch: Partial<ShellTab>): void {
    const e = this.entries.get(sessionId);
    if (!e) return;
    e.tabs = e.tabs.map(t => (t.id === tabId && t.kind === 'shell' ? { ...t, ...patch } : t));
  }

  private setLink(sessionId: string, link: AgentLink): void { this.entry(sessionId).link = link; }

  /** The xterm a tab draws in, made once; its keys and size go to whatever the tab runs now. */
  private surfaceFor(tabId: string, run: () => Run | null): TermSurface {
    let s = this.surfaces.get(tabId);
    if (!s) {
      s = this.deps.surface();
      s.onInput(d => type(run(), d));
      s.onResize((c, r) => run()?.handle?.resize(c, r));
      this.surfaces.set(tabId, s);
    }
    return s;
  }

  private start(sessionId: string, tab: ShellTab): void {
    const { backend } = this.deps;
    const argv = backend ? this.deps.shellArgv(sessionId) : null;
    if (!backend || !argv) { this.setTab(sessionId, tab.id, { status: 'unavailable', end: undefined }); return; }
    const id = tab.id;
    const surface = this.surfaceFor(id, () => this.shells.get(id) ?? null);
    const run: Run = { handle: null, typed: [] };
    const current = () => this.shells.get(id) === run;
    this.shells.set(id, run);
    this.setTab(sessionId, id, { status: 'running', end: undefined });
    const adopt = (h: PtyHandle | null) => {
      if (!current()) { h?.close(); return; }
      if (h) { adoptHandle(run, h); syncSize(h, surface); return; }
      this.shells.delete(id);
      this.setTab(sessionId, id, { status: 'unavailable' });
      this.emit();
    };
    backend.open(argv, surface.size(), {
      data: b => { if (current()) surface.write(b); },
      // Never restarted by itself: a fresh shell would hide that the running command died (spec §3).
      exit: code => {
        if (!current()) return;
        this.shells.delete(id);
        this.setTab(sessionId, id, { status: 'ended', end: { code, lost: tab.remote && code === SSH_LOST } });
        this.emit();
      }
    }).then(adopt, () => adopt(null));
  }

  /** Detaches the shown session's agent tab and cancels its reconnection; its screen stays as it was. */
  private leave(): void {
    this.attachment?.handle?.close();
    this.attachment = null;
    this.retry = null;
    if (this.shown) this.setLink(this.shown.sid, OFF);
  }

  private connect(): void {
    const { backend } = this.deps;
    if (!this.shown || !backend) return;
    const { sid, mode } = this.shown;
    const readOnly = mode.kind === 'parent';
    const argv = this.deps.agentArgv(sid, readOnly);
    if (!argv) { this.setLink(sid, OFF); return; }
    const surface = this.surfaceFor(agentTabId(sid), () => (this.shown?.sid === sid ? this.attachment : null));
    surface.setReadOnly(readOnly);
    const run: Run = { handle: null, typed: [] };
    const current = () => this.attachment === run;
    this.attachment = run;
    this.openedAt = this.now();
    const adopt = (h: PtyHandle | null) => {
      if (!current()) { h?.close(); return; }
      if (!h) { this.dropped(); return; }
      adoptHandle(run, h);
      syncSize(h, surface);
      this.setLink(sid, { state: 'attached', attempt: 0 });
      this.emit();
    };
    backend.open(argv, surface.size(), {
      data: b => { if (current()) surface.write(b); },
      exit: () => { if (current()) this.dropped(); }
    }).then(adopt, () => adopt(null));
  }

  /** Every end of a live attachment is a lost connection: tmux keeps the agent, and redraws it on the next attach. */
  private dropped(): void {
    if (!this.shown) return;
    const { sid } = this.shown;
    this.attachment?.handle?.close();
    this.attachment = null;
    if (this.now() - this.openedAt >= HELD_MS) this.drops = 0;
    this.drops += 1;
    const delay = reconnectDelay(this.drops);
    this.setLink(sid, { state: 'reconnecting', attempt: this.drops, retryAt: this.now() + delay });
    const retry = {};
    this.retry = retry;
    (this.deps.setTimeout ?? setTimeout)(() => {
      if (this.retry !== retry) return;
      this.retry = null;
      this.connect();
      this.emit();
    }, delay);
    this.emit();
  }
}
