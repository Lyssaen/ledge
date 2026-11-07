import type { PtyBackend, PtyHandle } from './backend';
import type { TermSurface } from './surface';
import type { TermTheme } from './theme';
import { reconnectDelay, type AgentMode } from './mode';
import type { AgentRoute, AgentStream, ShellStream } from './stream';
import type { ShellKind } from './shells';

/** A shell of the right panel (Fil | Terminal v3): the agent's screen is no tab, it is the session's Terminal view. */
export type Tab = { kind: 'shell'; id: string; n: number; dir: string; remote: boolean; status: 'idle' | 'running' | 'ended' | 'unavailable'; end?: { code: number | null; lost: boolean } };
type ShellTab = Extract<Tab, { kind: 'shell' }>;
export type AgentLink = { state: 'attached' | 'reconnecting' | 'off'; attempt: number; retryAt?: number };
/** The agent's screen (the Terminal view's xterm), by its session. */
export const agentTabId = (sessionId: string): string => `${sessionId}#agent`;
/** The right panel's first tab, « ± Modifications »: fixed, never closed, and where the panel opens while it has no shell. */
export const changesTabId = (sessionId: string): string => `${sessionId}#changes`;
/** A shell of the bottom panel: it belongs to no session. */
export interface FreeShell { id: string; kind: ShellKind; n: number; title: string; dir: string; status: 'running' | 'ended' | 'unavailable'; end?: { code: number | null; lost: boolean } }
export interface TermDeps { backend: PtyBackend | null; /** What a free shell runs, null when it cannot (absent: it cannot). */ freeLaunch?(kind: ShellKind, dir: string): { argv: string[] } | { native: 'powershell' | 'cmd' | 'gitbash' } | null; freeTitle?(kind: ShellKind, n: number): string; surface(): TermSurface; agentArgv(id: string, readOnly: boolean): string[] | null; shellArgv(id: string): string[] | null; shellPlace(sessionId: string): { dir: string; remote: boolean }; now?(): number; setTimeout?: typeof setTimeout; /** Absent: the agent screen is always the pseudo-terminal, as before the control stream. */ agentRoute?: (sessionId: string) => AgentRoute; stream?: AgentStream; /** Shells born beside the daemon, when `agentRoute` says `stream`. Absent: a shell is the local pseudo-terminal. */ shellStream?: ShellStream }

const OFF: AgentLink = { state: 'off', attempt: 0 };
/** `ssh`'s exit code when the connection fails or drops. */
const SSH_LOST = 255;
/** An attachment that held this long was a real connection: its drop starts the backoff over. */
const HELD_MS = 15000;

/** `active`: the panel's tab last used, a shell's id or changesTabId (the panel reopens on it). */
type Entry = { tabs: readonly Tab[]; active: string; next: number; link: AgentLink; offlineSince?: number };
/** One open (or opening) pseudo-terminal; it is current while the store still points at it, stale once replaced or dropped.
 *  `typed` holds what the xterm sends before the handle is there: ConPTY asks for the cursor as it starts and draws nothing,
 *  reads no key, until that answer comes. */
type Run = { handle: PtyHandle | null; typed: string[]; stream?: boolean };
/** A session's agent screen while a view shows it: how, by which view (`viewer`, R2: the one that asked last holds the one
 *  xterm), its attachment and its own reconnection. `retry` is the pending one; a timer that fires after it was replaced or
 *  cancelled does nothing. */
type Shown = { mode: AgentMode; key: string; viewer: string; attachment: Run | null; retry: object | null; drops: number; openedAt: number };
/** The viewer outside the IDE: the one page, which shows one session at a time. */
const PAGE = 'page';

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
  /** The bottom panel's shells, apart from the sessions' `entries`; `shell` is replaced, never mutated, on each change. */
  private readonly frees = new Map<string, { shell: FreeShell; run: Run | null }>();
  private freeNext = 1;
  private readonly listeners = new Set<() => void>();
  /** The sessions whose agent screen a view shows, each with its own attachment: two IDE groups show two agents at once. */
  private readonly shown = new Map<string, Shown>();

  constructor(deps: TermDeps) { this.deps = deps; }

  tabs(sessionId: string): readonly Tab[] { return this.entry(sessionId).tabs; }

  active(sessionId: string): string { return this.entry(sessionId).active; }

  select(sessionId: string, tabId: string): void {
    const e = this.entry(sessionId);
    const tab = e.tabs.find(t => t.id === tabId);
    if (!tab && tabId !== changesTabId(sessionId)) return;
    e.active = tabId;
    if (tab?.status === 'idle') this.start(sessionId, tab);
    this.emit();
  }

  /** « + »: a new shell where the first one runs, else where the session works, on its machine (shellPlace). */
  newShell(sessionId: string): string {
    const { dir, remote } = this.entry(sessionId).tabs[0] ?? this.deps.shellPlace(sessionId);
    return this.addShell(sessionId, dir, remote);
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
    const at = e.tabs.findIndex(t => t.id === tabId);
    if (at < 0) return;
    // No confirmation: closing the tab kills the shell (spec §3). A shell still opening is closed when it resolves.
    this.shells.get(tabId)?.handle?.close();
    this.shells.delete(tabId);
    this.surfaces.get(tabId)?.dispose();
    this.surfaces.delete(tabId);
    e.tabs = e.tabs.filter(t => t.id !== tabId);
    // Its neighbour takes over (the next shell, else the one before), else Modifications.
    if (e.active === tabId) e.active = e.tabs[Math.min(at, e.tabs.length - 1)]?.id ?? changesTabId(sessionId);
    this.emit();
  }

  reopen(sessionId: string, tabId: string): void {
    const tab = this.entry(sessionId).tabs.find(t => t.id === tabId);
    if (tab?.status !== 'ended') return;
    this.start(sessionId, tab);
    this.emit();
  }

  /** The machine's snapshot arrived, or its flag did: every screen shown attaches by whichever path that now says, and a
   *  shell that waited wakes. */
  refreshAgent(): void {
    for (const [sid, s] of [...this.shown]) this.show(sid, s.mode, s.viewer);
    if (!this.deps.agentRoute) return;
    for (const [sid, e] of this.entries) {
      const route = this.deps.agentRoute(sid);
      // The socket dropped: the daemon already killed the owned session, so the tab ends. A new one is a fresh shell.
      if (route === 'wait') {
        for (const t of e.tabs) if (t.kind === 'shell' && t.status === 'running' && this.shells.get(t.id)?.stream) this.finishStream(sid, t.id);
        continue;
      }
      if (route !== 'stream') continue;
      const tab = e.tabs.find(t => t.id === e.active);
      if (tab?.kind === 'shell' && tab.status === 'idle') this.start(sid, tab);
    }
  }

  /** `viewer`: the view that shows it, an IDE tab's key, else the page. A view shows one session: the one it showed before
   *  is let go. The same session asked by another view moves to it on the same attachment (R2: one xterm per session). */
  showAgent(sessionId: string, mode: AgentMode, viewer: string = PAGE): void { this.show(sessionId, mode, viewer); }

  /** Without an id, every screen. With one, that session's, and with a `viewer` only if that view holds it: a tab leaving
   *  must not detach another tab's screen. */
  hideAgent(sessionId?: string, viewer?: string): void {
    if (sessionId === undefined) {
      if (this.shown.size === 0) return;
      for (const sid of this.shown.keys()) this.leave(sid);
      this.shown.clear();
      this.emit();
      return;
    }
    const s = this.shown.get(sessionId);
    if (!s || (viewer !== undefined && s.viewer !== viewer)) return;
    this.leave(sessionId);
    this.shown.delete(sessionId);
    this.emit();
  }

  /** The view that holds the session's screen, null while none shows it. */
  viewerOf(sessionId: string): string | null { return this.shown.get(sessionId)?.viewer ?? null; }

  retryNow(sessionId: string): void {
    const s = this.shown.get(sessionId);
    if (!s?.retry) return;
    s.retry = null;
    this.connect(sessionId);
    this.emit();
  }

  /** Every xterm still open takes Ledge's new colours; the next ones are made with them. */
  setTheme(theme: TermTheme): void { for (const s of this.surfaces.values()) s.setTheme(theme); }

  link(sessionId: string): AgentLink { return this.entries.get(sessionId)?.link ?? OFF; }

  offlineSince(sessionId: string): number | undefined { return this.entries.get(sessionId)?.offlineSince; }

  /** Starts a shell with no session; id `shell:<n>`. Starts at once. */
  openFree(kind: ShellKind, dir: string): string {
    const n = this.freeNext++;
    const id = `shell:${n}`;
    this.frees.set(id, { shell: { id, kind, n, title: this.deps.freeTitle?.(kind, n) ?? `${kind} ${n}`, dir, status: 'running' }, run: null });
    this.startFree(id);
    this.emit();
    return id;
  }

  free(id: string): FreeShell | undefined { return this.frees.get(id)?.shell; }

  /** Kills it, disposes its xterm. A shell still opening is closed when it resolves. */
  closeFree(id: string): void {
    const f = this.frees.get(id);
    if (!f) return;
    f.run?.handle?.close();
    this.frees.delete(id);
    this.surfaces.get(id)?.dispose();
    this.surfaces.delete(id);
    this.emit();
  }

  /** An ended one: the same kind, the same dir, the same xterm. */
  reopenFree(id: string): void {
    if (this.frees.get(id)?.shell.status !== 'ended') return;
    this.startFree(id);
    this.emit();
  }

  surface(tabId: string): TermSurface | undefined { return this.surfaces.get(tabId); }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** showAgent's work, also refreshAgent's: a view's request and the store's own re-check are told apart. */
  private show(sessionId: string, mode: AgentMode, viewer: string): void {
    const route = mode.kind === 'live' || mode.kind === 'parent' ? (this.deps.agentRoute?.(sessionId) ?? 'pty') : '';
    const key = JSON.stringify(mode) + route;
    const cur = this.shown.get(sessionId);
    // Re-renders call this again and again: the same session in the same mode keeps its attachment.
    if (cur?.key === key && cur.viewer === viewer) return;
    for (const [sid, s] of [...this.shown]) if (sid !== sessionId && s.viewer === viewer) { this.leave(sid); this.shown.delete(sid); }
    if (cur?.key === key) { cur.viewer = viewer; this.emit(); return; }
    if (cur) this.leave(sessionId);
    this.shown.set(sessionId, { mode, key, viewer, attachment: null, retry: null, drops: 0, openedAt: 0 });
    const e = this.entry(sessionId);
    if (mode.kind === 'offline') {
      e.offlineSince ??= this.now();
      this.surfaces.get(agentTabId(sessionId))?.setReadOnly(true);
    } else if (mode.kind === 'live' || mode.kind === 'parent') {
      e.offlineSince = undefined;
      this.connect(sessionId);
    }
    this.emit();
  }

  private entry(sessionId: string): Entry {
    let e = this.entries.get(sessionId);
    if (!e) {
      // No shell until one is asked for (« + »): the panel opens on Modifications.
      e = { tabs: [], active: changesTabId(sessionId), next: 1, link: OFF };
      this.entries.set(sessionId, e);
    }
    return e;
  }

  private emit(): void { for (const fn of [...this.listeners]) fn(); }

  private now(): number { return (this.deps.now ?? Date.now)(); }

  private setTab(sessionId: string, tabId: string, patch: Partial<ShellTab>): void {
    const e = this.entries.get(sessionId);
    if (!e) return;
    e.tabs = e.tabs.map(t => (t.id === tabId ? { ...t, ...patch } : t));
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
    const route = this.deps.agentRoute?.(sessionId);
    // The machine has not answered yet: leave the tab idle, so a later snapshot starts it once.
    if (route === 'wait') return;
    if (route === 'stream' && this.deps.shellStream) { this.startStream(sessionId, tab); return; }
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

  private setFree(id: string, patch: Partial<FreeShell>): void {
    const f = this.frees.get(id);
    if (f) f.shell = { ...f.shell, ...patch };
  }

  private startFree(id: string): void {
    const f = this.frees.get(id);
    if (!f) return;
    // A launch or an xterm that cannot be made must not leave a « running » shell with nothing behind it.
    try { this.runFree(id, f); } catch { f.run = null; this.setFree(id, { status: 'unavailable', end: undefined }); }
  }

  private runFree(id: string, f: { shell: FreeShell; run: Run | null }): void {
    const { backend } = this.deps;
    const launch = backend ? this.deps.freeLaunch?.(f.shell.kind, f.shell.dir) ?? null : null;
    if (!backend || !launch) { f.run = null; this.setFree(id, { status: 'unavailable', end: undefined }); return; }
    const surface = this.surfaceFor(id, () => this.frees.get(id)?.run ?? null);
    const run: Run = { handle: null, typed: [] };
    const current = () => this.frees.get(id)?.run === run;
    f.run = run;
    this.setFree(id, { status: 'running', end: undefined });
    const adopt = (h: PtyHandle | null) => {
      if (!current()) { h?.close(); return; }
      if (h) { adoptHandle(run, h); syncSize(h, surface); return; }
      f.run = null;
      this.setFree(id, { status: 'unavailable' });
      this.emit();
    };
    const native = 'native' in launch ? launch.native : undefined;
    backend.open('argv' in launch ? launch.argv : [], surface.size(), {
      data: b => { if (current()) surface.write(b); },
      exit: code => {
        if (!current()) return;
        f.run = null;
        this.setFree(id, { status: 'ended', end: { code, lost: f.shell.kind.startsWith('ssh:') && code === SSH_LOST } });
        this.emit();
      }
    }, native).then(adopt, () => adopt(null));
  }

  /** The shell over the daemon's control stream. It is not restarted when it ends: that would hide a command that died. */
  private startStream(sessionId: string, tab: ShellTab): void {
    const shells = this.deps.shellStream;
    if (!shells) return;
    const id = tab.id;
    const surface = this.surfaceFor(id, () => this.shells.get(id) ?? null);
    const run: Run = { handle: null, typed: [], stream: true };
    const current = () => this.shells.get(id) === run;
    this.shells.set(id, run);
    this.setTab(sessionId, id, { status: 'running', end: undefined });
    const handle = shells.open(sessionId, `s${tab.n}`, surface.size(), {
      screen: text => { if (current()) surface.write(text); },
      data: b => { if (current()) surface.write(b); },
      exit: () => {
        if (!current()) return;
        this.shells.delete(id);
        this.setTab(sessionId, id, { status: 'ended', end: { code: null, lost: false } });
        this.emit();
      }
    });
    if (!current()) { handle.close(); return; }
    adoptHandle(run, handle);
    syncSize(handle, surface);
    this.emit();
  }

  /** The machine went away under a streamed shell: the tab ends, and nothing opens in its place. */
  private finishStream(sessionId: string, tabId: string): void {
    const run = this.shells.get(tabId);
    run?.handle?.close();
    this.shells.delete(tabId);
    this.setTab(sessionId, tabId, { status: 'ended', end: { code: null, lost: false } });
    this.emit();
  }

  /** Detaches a shown session's agent tab and cancels its reconnection; its screen stays as it was. */
  private leave(sid: string): void {
    const s = this.shown.get(sid);
    if (!s) return;
    s.attachment?.handle?.close();
    s.attachment = null;
    s.retry = null;
    this.setLink(sid, OFF);
  }

  /** The attachment its xterm types into: none once the session is no longer shown. */
  private attachmentOf(sid: string): Run | null { return this.shown.get(sid)?.attachment ?? null; }

  private connect(sid: string): void {
    const s = this.shown.get(sid);
    if (!s) return;
    const { mode } = s;
    if (mode.kind !== 'live' && mode.kind !== 'parent') return;
    const route = this.deps.agentRoute?.(sid) ?? 'pty';
    // The machine has not answered yet: opening the pseudo-terminal now would only be torn down once the stream is known.
    if (route === 'wait') return;
    if (route === 'stream' && this.deps.stream) { this.connectStream(sid, s); return; }
    const { backend } = this.deps;
    if (!backend) return;
    const readOnly = mode.kind === 'parent';
    const argv = this.deps.agentArgv(sid, readOnly);
    if (!argv) { this.setLink(sid, OFF); return; }
    const surface = this.surfaceFor(agentTabId(sid), () => this.attachmentOf(sid));
    surface.setReadOnly(readOnly);
    const run: Run = { handle: null, typed: [] };
    const current = () => this.attachmentOf(sid) === run;
    s.attachment = run;
    s.openedAt = this.now();
    const adopt = (h: PtyHandle | null) => {
      if (!current()) { h?.close(); return; }
      if (!h) { this.dropped(sid); return; }
      adoptHandle(run, h);
      syncSize(h, surface);
      this.setLink(sid, { state: 'attached', attempt: 0 });
      this.emit();
    };
    backend.open(argv, surface.size(), {
      data: b => { if (current()) surface.write(b); },
      exit: () => { if (current()) this.dropped(sid); }
    }).then(adopt, () => adopt(null));
  }

  /** The agent's screen over the daemon's control stream: xterm writes the bytes, and nothing nests a second emulator. */
  private connectStream(sid: string, s: Shown): void {
    const stream = this.deps.stream;
    if (!stream) return;
    const readOnly = s.mode.kind === 'parent';
    const surface = this.surfaceFor(agentTabId(sid), () => this.attachmentOf(sid));
    surface.setReadOnly(readOnly);
    const run: Run = { handle: null, typed: [] };
    const current = () => this.attachmentOf(sid) === run;
    s.attachment = run;
    s.openedAt = this.now();
    const handle = stream.open(sid, readOnly, surface.size(), {
      screen: text => { if (current()) surface.write(text); },
      data: b => { if (current()) surface.write(b); },
      exit: () => { if (current()) this.dropped(sid); }
    });
    if (!current()) { handle.close(); return; }
    adoptHandle(run, handle);
    syncSize(handle, surface);
    this.setLink(sid, { state: 'attached', attempt: 0 });
    this.emit();
  }

  /** Every end of a live attachment is a lost connection: tmux keeps the agent, and redraws it on the next attach. Each
   *  session counts its own drops. */
  private dropped(sid: string): void {
    const s = this.shown.get(sid);
    if (!s) return;
    s.attachment?.handle?.close();
    s.attachment = null;
    if (this.now() - s.openedAt >= HELD_MS) s.drops = 0;
    s.drops += 1;
    const delay = reconnectDelay(s.drops);
    this.setLink(sid, { state: 'reconnecting', attempt: s.drops, retryAt: this.now() + delay });
    const retry = {};
    s.retry = retry;
    (this.deps.setTimeout ?? setTimeout)(() => {
      if (s.retry !== retry || this.shown.get(sid) !== s) return;
      s.retry = null;
      this.connect(sid);
      this.emit();
    }, delay);
    this.emit();
  }
}
