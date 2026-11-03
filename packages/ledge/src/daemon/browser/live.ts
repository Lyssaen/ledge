import { BROWSER_FRAME_MAX, BROWSER_TITLE_MAX, BROWSER_URL_MAX, type BrowserClosedHow, type BrowserFrame, type BrowserLive, type BrowserState, type Session } from '@ledge/protocol';
import type { Store } from '../store.js';
import { log } from '../../log.js';
import { connectCdp, type Cdp, type CdpEvent, type ConnectCdp } from './cdp.js';
import { findBrowsers, processTable, realProcFs, type ProcFs } from './proc.js';

/** What a front watching a session receives: its browser's state, the last image, the film. */
export type BrowserSink = (m: BrowserLive | BrowserFrame) => void;

export interface BrowserLiveDeps {
  store: Store;
  /** The pid of the program in the session's pane, or null when tmux cannot tell. */
  panePid: (tmuxSession: string) => Promise<number | null>;
  /** Every change of a session's browser, for the local fronts. */
  emit: (m: BrowserLive) => void;
  procfs?: ProcFs;
  connect?: ConnectCdp;
  now?: () => number;
  /** How often the panes are searched for a browser. */
  intervalMs?: number;
  /** An agent's actions are grouped over this before the image is taken. */
  debounceMs?: number;
  /** At most one image kept per this, per session. */
  captureMinMs?: number;
  /** A watched tab whose film sends nothing for this long is filmed by single images instead. */
  quietMs?: number;
  /** Those images: one per `fastMs` while the page changes, less and less often while it does not, down to one per `stillMs`. */
  fastMs?: number;
  stillMs?: number;
}

/** An agent's tab: `seq` numbers it in its session, `nav` counts its changes of address, `navAt` when the last one was seen. */
interface Page { url: string; title: string; at: number; seq: number; nav: number; navAt: number }
interface Image { data: string; at: string; url?: string; title?: string; page?: string; width?: number; height?: number }
interface Track {
  id: string;
  cdp?: Cdp; browserPid?: number; connecting?: boolean;
  pages: Map<string, Page>;
  state: BrowserState; since?: string; closedAt?: string; closed?: BrowserClosedHow;
  url?: string; title?: string; page?: string;
  pageSeq: number;
  image?: Image;
  watchers: Set<BrowserSink>;
  film?: { targetId: string; sessionId: string; lastCastAt: number; lastData?: string; delay: number };
  filming?: Promise<void>;
  captureTimer?: NodeJS.Timeout; stillTimer?: NodeJS.Timeout;
  lastCaptureAt: number; capturing: boolean;
  sent?: string;
}

/** The agent's tabs: pages, not Chrome's own (its omnibox popup, devtools, extensions). */
const agentPage = (info: { type?: unknown; url?: unknown }): boolean =>
  info.type === 'page' && typeof info.url === 'string' && !/^(?:chrome|chrome-untrusted|chrome-extension|devtools|edge):/i.test(info.url);
const cut = (s: string | undefined, max: number): string | undefined => (s === undefined ? undefined : s.slice(0, max));

/**
 * The agent's own browser, followed per session (docs/mockups/ledge-browser-live.html). Every `intervalMs` (and at once when
 * a hook says the agent used its browser) the pane's processes are searched for a Chrome with a CDP port; the daemon then
 * holds one connection to it, told of every tab opened, changed and closed. With a tab open the session is `live`; when the
 * last one goes, or the browser, it is `closed`, keeping the last image. A Chrome driven through a pipe only is `off`.
 * Images: one after the agent's actions (`poke`, tabs changing), at most one per `captureMinMs`, whether or not anyone
 * watches; the film only while a front watches. Every command goes through the CDP allow-list (cdp.ts).
 */
export function createBrowserLive(deps: BrowserLiveDeps) {
  const { store } = deps;
  const procfs = deps.procfs ?? realProcFs;
  const connect = deps.connect ?? connectCdp;
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? 5000;
  const debounceMs = deps.debounceMs ?? 1000;
  const captureMinMs = deps.captureMinMs ?? 5000;
  const quietMs = deps.quietMs ?? 1000;
  const fastMs = deps.fastMs ?? 500;
  const stillMs = deps.stillMs ?? 3000;
  const tracks = new Map<string, Track>();
  const pokes = new Map<string, NodeJS.Timeout>();
  /** A pane's program lives as long as its session: asked of tmux once, again only when it is gone from the processes. */
  const panes = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null, ticking = false, stopped = false;
  const iso = () => new Date(now()).toISOString();

  const track = (id: string): Track => {
    let t = tracks.get(id);
    if (!t) { t = { id, pages: new Map(), pageSeq: 0, state: 'none', watchers: new Set(), lastCaptureAt: -Infinity, capturing: false }; tracks.set(id, t); }
    return t;
  };
  const active = (t: Track): [string, Page] | undefined => {
    let best: [string, Page] | undefined;
    for (const e of t.pages) if (!best || e[1].at >= best[1].at) best = e;
    return best;
  };

  /** What a front compares: the tab and its navigation, never shown. */
  const pageId = (p: Page, nav = p.nav): string => `${p.seq}.${nav}`;
  /** A tab seen for the first time, or seen again: a new address is a new navigation. */
  function see(t: Track, targetId: string, url: string, title: string): void {
    const was = t.pages.get(targetId);
    if (!was) { t.pages.set(targetId, { url, title, at: now(), seq: ++t.pageSeq, nav: 0, navAt: now() }); return; }
    if (was.url !== url) { was.nav++; was.navAt = now(); }
    was.url = url; was.title = title; was.at = now();
  }

  function message(t: Track): BrowserLive {
    return {
      type: 'browser.live', id: t.id, state: t.state, tabs: t.pages.size,
      ...(t.url !== undefined ? { url: cut(t.url, BROWSER_URL_MAX) } : {}), ...(t.title !== undefined ? { title: cut(t.title, BROWSER_TITLE_MAX) } : {}),
      ...(t.page ? { page: t.page } : {}),
      ...(t.since ? { since: t.since } : {}), ...(t.closedAt ? { closedAt: t.closedAt } : {}), ...(t.closed ? { closed: t.closed } : {}),
      ...(t.image ? { image: { at: t.image.at, ...(t.image.url !== undefined ? { url: cut(t.image.url, BROWSER_URL_MAX) } : {}), ...(t.image.title !== undefined ? { title: cut(t.image.title, BROWSER_TITLE_MAX) } : {}), ...(t.image.page ? { page: t.image.page } : {}) } } : {})
    };
  }
  function publish(t: Track): void {
    const m = message(t), key = JSON.stringify(m);
    if (key === t.sent) return;
    // Nothing to take back: a browser never shown (an OMP one with no tab yet) is not announced as « none ».
    const first = t.sent === undefined;
    t.sent = key;
    if (first && m.state === 'none') return;
    deps.emit(m);
  }
  const lastImage = (t: Track): BrowserFrame | null => t.image
    ? { type: 'browser.frame', id: t.id, data: t.image.data, at: t.image.at, ...(t.image.width ? { width: t.image.width } : {}), ...(t.image.height ? { height: t.image.height } : {}), ...(t.image.page ? { page: t.image.page } : {}), live: false }
    : null;

  /** The state the tabs make: live while one is open; closed when the last one went (or the browser), with how. */
  function settle(t: Track, gone?: BrowserClosedHow): void {
    const top = active(t);
    if (top) {
      if (t.state !== 'live') { t.state = 'live'; t.since = iso(); delete t.closedAt; delete t.closed; }
      t.url = top[1].url; t.title = top[1].title; t.page = pageId(top[1]);
    } else if (t.state === 'live') {
      t.state = 'closed'; t.closedAt = iso(); t.closed = gone ?? (t.cdp ? 'tabs' : 'browser');
    }
    publish(t);
    void refilm(t);
  }

  function onEvent(t: Track, e: CdpEvent): void {
    if (e.method === 'Page.screencastFrame') return onFrame(t, e);
    if (e.method === 'Target.detachedFromTarget' && t.film && e.params.sessionId === t.film.sessionId) { stopStill(t); delete t.film; return void refilm(t); }
    const info = e.params.targetInfo as { targetId?: string; type?: string; url?: string; title?: string } | undefined;
    if (e.method === 'Target.targetCreated' || e.method === 'Target.targetInfoChanged') {
      if (!info?.targetId) return;
      const was = t.pages.get(info.targetId);
      if (!agentPage(info)) { if (was) { t.pages.delete(info.targetId); settle(t); } return; }
      const url = info.url ?? '', title = info.title ?? '';
      if (was && was.url === url && was.title === title) return;
      see(t, info.targetId, url, title);
      settle(t);
      scheduleCapture(t);
    } else if (e.method === 'Target.targetDestroyed') {
      const id = e.params.targetId;
      if (typeof id !== 'string' || !t.pages.delete(id)) return;
      if (t.film?.targetId === id) { stopStill(t); delete t.film; }
      settle(t);
    }
  }

  async function attach(t: Track, port: number, path: string, pid: number): Promise<void> {
    t.connecting = true;
    let c: Cdp | undefined;
    try {
      c = await connect(`ws://127.0.0.1:${port}${path}`);
      if (stopped || !store.get(t.id)) { c.close(); return; }
      t.cdp = c; t.browserPid = pid;
      const conn = c;
      c.onEvent(e => onEvent(t, e));
      c.onClose(() => {
        if (t.cdp !== conn) return;
        delete t.cdp; delete t.browserPid; delete t.film; stopStill(t);
        if (t.captureTimer) clearTimeout(t.captureTimer);
        t.pages.clear();
        const session = store.get(t.id);
        // OMP keeps its browser open with no tab: it only closes when the seat stops.
        const how: BrowserClosedHow = session?.state === 'exited' || session?.tool === 'omp' ? 'stopped' : 'browser';
        // Playwright closes the tab, then the browser: a browser gone just after its last tab is the browser closing.
        if (t.state === 'closed' && t.closed === 'tabs' && t.closedAt && now() - Date.parse(t.closedAt) <= 3000) { t.closed = how; publish(t); return; }
        settle(t, how);
      });
      await c.call('Target.setDiscoverTargets', { discover: true });
      const list = await c.call('Target.getTargets');
      for (const info of (list.targetInfos as { targetId: string; type: string; url: string; title: string }[] | undefined) ?? []) {
        if (agentPage(info) && !t.pages.has(info.targetId)) see(t, info.targetId, info.url, info.title);
      }
      settle(t);
      scheduleCapture(t);
    } catch (e) {
      // A port file an earlier browser left in the profile, or a browser closing: found again at the next search if real.
      // A connection that opened but could not start following is let go, so that the next search tries again.
      if (c) { if (t.cdp === c) { delete t.cdp; delete t.browserPid; t.pages.clear(); } c.close(); }
      log(`browser of ${t.id}: no CDP connection (${(e as Error).message})`);
    } finally { t.connecting = false; }
  }

  /** Searches the session's pane for its browser and follows what it finds. */
  async function scan(s: Session, table?: Awaited<ReturnType<typeof processTable>>): Promise<void> {
    const t = tracks.get(s.id);
    if (s.state === 'exited') {
      if (t?.cdp) t.cdp.close();
      // A browser that closed with its session: it stopped with it.
      if (t?.state === 'closed' && t.closed === 'browser' && t.closedAt && now() - Date.parse(t.closedAt) <= 2 * intervalMs) { t.closed = 'stopped'; publish(t); }
      if (t?.state === 'off') { t.state = 'none'; delete t.since; publish(t); }
      return;
    }
    if (!s.tmuxSession || t?.connecting) return;
    let pid = panes.get(s.tmuxSession);
    if (pid === undefined || (table && !table.has(pid) && !(await procfs.ppid(pid)))) {
      const asked = await deps.panePid(s.tmuxSession);
      if (asked === null) { panes.delete(s.tmuxSession); return; }
      pid = asked; panes.set(s.tmuxSession, pid);
    }
    const found = await findBrowsers(pid, procfs, table);
    if (t?.cdp && found.some(b => b.pid === t.browserPid)) return;
    const watchable = found.find(b => b.port !== undefined);
    if (watchable && !t?.cdp) return attach(track(s.id), watchable.port!, watchable.path!, watchable.pid);
    if (t?.cdp) return;
    // The agent uses a browser Ledge may not watch: say so, until it goes or a watchable one comes.
    const blind = found.some(b => b.pipeOnly);
    if (blind && (!t || t.state === 'none' || t.state === 'closed')) { const u = track(s.id); u.state = 'off'; u.since = iso(); delete u.closedAt; delete u.closed; publish(u); }
    else if (!blind && t?.state === 'off') { t.state = 'none'; delete t.since; publish(t); }
  }

  async function tick(): Promise<void> {
    if (ticking || stopped) return;
    ticking = true;
    try {
      const sessions = store.all();
      const live = sessions.filter(s => s.tmuxSession && (s.state !== 'exited' || tracks.has(s.id)));
      // A session forgotten by Ledge takes its browser with it.
      for (const [id, t] of tracks) if (!store.get(id)) forget(id, t);
      const named = new Set(sessions.map(s => s.tmuxSession));
      for (const name of panes.keys()) if (!named.has(name)) panes.delete(name);
      if (!live.length) return;
      const table = await processTable(procfs);
      for (const s of live) await scan(s, table).catch(e => log(`browser of ${s.id} not searched: ${(e as Error).message}`));
    } finally { ticking = false; }
  }

  function forget(id: string, t: Track): void {
    t.cdp?.close(); stopStill(t);
    if (t.captureTimer) clearTimeout(t.captureTimer);
    tracks.delete(id);
    if (t.state !== 'none') deps.emit({ type: 'browser.live', id, state: 'none', tabs: 0 });
  }

  // ---- the image kept without a viewer

  function scheduleCapture(t: Track, delay = debounceMs): void {
    if (!t.cdp || !t.pages.size || stopped) return;
    if (t.captureTimer) clearTimeout(t.captureTimer);
    const wait = Math.max(delay, t.lastCaptureAt + captureMinMs - now());
    t.captureTimer = setTimeout(() => { delete t.captureTimer; void capture(t); }, wait);
    t.captureTimer.unref?.();
  }

  /** Chrome does not always tell a title a page set itself (`setContent`): the tabs' titles and addresses are read again. */
  async function refresh(t: Track, cdp: Cdp): Promise<void> {
    const list = await cdp.call('Target.getTargets').catch(() => null);
    let changed = false;
    for (const info of (list?.targetInfos as { targetId: string; type: string; url: string; title: string }[] | undefined) ?? []) {
      const page = t.pages.get(info.targetId);
      if (page && agentPage(info) && (page.url !== info.url || page.title !== info.title)) {
        if (page.url !== info.url) { page.nav++; page.navAt = now(); }
        page.url = info.url; page.title = info.title; changed = true;
      }
    }
    if (changed) settle(t);
  }

  /** One image of the agent's tab, now. Null when there is none to take. */
  async function shoot(t: Track): Promise<Image | null> {
    if (t.cdp) await refresh(t, t.cdp);
    const cdp = t.cdp, top = active(t);
    if (!cdp || !top) return null;
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: top[0], flatten: true }) as { sessionId: string };
    try {
      const r = await cdp.call('Page.captureScreenshot', { format: 'jpeg', quality: 60 }, sessionId);
      const data = typeof r.data === 'string' ? r.data : '';
      if (!data || data.length > BROWSER_FRAME_MAX) return null;
      return { data, at: iso(), url: top[1].url, title: top[1].title, page: pageId(top[1]) };
    } finally { await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {}); }
  }

  async function capture(t: Track): Promise<void> {
    // While a front watches, the film's frames are the image kept; an image being taken already (the film's), taken after it.
    if (t.film || !t.cdp) return;
    if (t.capturing) return scheduleCapture(t);
    t.capturing = true;
    try {
      const img = await shoot(t);
      if (img) { t.image = img; t.lastCaptureAt = now(); publish(t); }
    } catch (e) { log(`browser of ${t.id}: no image (${(e as Error).message})`); }
    finally { t.capturing = false; }
  }

  // ---- the film, while a front watches

  function send(t: Track, m: BrowserLive | BrowserFrame): void { for (const w of t.watchers) w(m); }

  function onFrame(t: Track, e: CdpEvent): void {
    const f = t.film, cdp = t.cdp;
    if (!f || !cdp || e.sessionId !== f.sessionId) return;
    void cdp.call('Page.screencastFrameAck', { sessionId: e.params.sessionId }, f.sessionId).catch(() => {});
    const data = e.params.data, meta = e.params.metadata as { deviceWidth?: number; deviceHeight?: number; timestamp?: number } | undefined;
    if (typeof data !== 'string' || !data || data.length > BROWSER_FRAME_MAX) return;
    f.lastCastAt = now(); f.lastData = data;
    // The film's own tab, not the one in front now; a frame Chrome drew before the tab's last navigation is of the one before.
    const p = t.pages.get(f.targetId);
    if (!p) return;
    const drawn = typeof meta?.timestamp === 'number' ? meta.timestamp * 1000 : undefined;
    const nav = drawn !== undefined && drawn < p.navAt && p.nav > 0 ? p.nav - 1 : p.nav;
    frame(t, data, { url: p.url, title: p.title, page: pageId(p, nav) }, meta?.deviceWidth, meta?.deviceHeight);
  }

  function frame(t: Track, data: string, of: { url?: string; title?: string; page?: string }, width?: number, height?: number): void {
    const at = iso();
    const w = width && width > 0 ? Math.round(width) : undefined, h = height && height > 0 ? Math.round(height) : undefined;
    send(t, { type: 'browser.frame', id: t.id, data, at, ...(w ? { width: w } : {}), ...(h ? { height: h } : {}), ...(of.page ? { page: of.page } : {}), live: true });
    t.image = { data, at, url: of.url, title: of.title, ...(of.page ? { page: of.page } : {}), ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) };
    // The image's date reaches the other fronts at the pace of the images kept without a viewer.
    if (now() - t.lastCaptureAt >= captureMinMs) { t.lastCaptureAt = now(); publish(t); }
  }

  function stopStill(t: Track): void { if (t.stillTimer) { clearTimeout(t.stillTimer); delete t.stillTimer; } }
  function scheduleStill(t: Track, delay: number): void {
    stopStill(t);
    t.stillTimer = setTimeout(() => { delete t.stillTimer; void still(t); }, delay);
    t.stillTimer.unref?.();
  }

  /** Films the agent's tab while someone watches and the browser is live; follows the tab it works in; stops otherwise. */
  function refilm(t: Track): Promise<void> {
    const run = async () => {
      const top = active(t), cdp = t.cdp;
      const want = t.watchers.size > 0 && t.state === 'live' && cdp && top ? top[0] : undefined;
      if (t.film?.targetId === want) return;
      if (t.film && cdp) {
        const old = t.film; delete t.film; stopStill(t);
        await cdp.call('Page.stopScreencast', {}, old.sessionId).catch(() => {});
        await cdp.call('Target.detachFromTarget', { sessionId: old.sessionId }).catch(() => {});
      }
      if (!want || !cdp) return;
      try {
        const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: want, flatten: true }) as { sessionId: string };
        t.film = { targetId: want, sessionId, lastCastAt: now(), delay: fastMs };
        await cdp.call('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 }, sessionId);
        scheduleStill(t, quietMs);
      } catch (e) { log(`browser of ${t.id}: no film (${(e as Error).message})`); delete t.film; }
    };
    // One change of film at a time, in order.
    const next = (t.filming ?? Promise.resolve()).then(run, run);
    t.filming = next;
    return next;
  }

  /**
   * A tab whose film sends nothing is filmed by single images. Chrome holds a tab hidden once OMP has frozen it between the
   * agent's calls, even woken again: no animation frame, no film, whatever is restarted (tried); a screenshot still renders
   * it. While the page changes, one image per `fastMs`; while it does not (or a page simply standing still), less and less
   * often, down to one per `stillMs`; the same image never twice. As soon as the film sends again, it takes over.
   */
  async function still(t: Track): Promise<void> {
    const f = t.film;
    if (!f) return;
    if (t.capturing || now() - f.lastCastAt < quietMs) return scheduleStill(t, quietMs);
    t.capturing = true;
    let changed = false;
    try {
      const img = await shoot(t);
      if (img && t.film === f && img.data !== f.lastData) { f.lastData = img.data; frame(t, img.data, img); changed = true; }
    } catch (e) { log(`browser of ${t.id}: no still image (${(e as Error).message})`); }
    finally { t.capturing = false; }
    if (t.film !== f) return;
    f.delay = changed ? fastMs : Math.min(f.delay * 2, stillMs);
    scheduleStill(t, f.delay);
  }

  return {
    tick,
    start(): void {
      if (timer || stopped) return;
      timer = setInterval(() => { void tick().catch(e => log(`browser search failed: ${(e as Error).message}`)); }, intervalMs);
      timer.unref?.();
      void tick().catch(() => {});
    },
    stop(): void {
      stopped = true;
      if (timer) { clearInterval(timer); timer = null; }
      for (const p of pokes.values()) clearTimeout(p);
      for (const t of tracks.values()) { stopStill(t); if (t.captureTimer) clearTimeout(t.captureTimer); t.cdp?.close(); }
    },
    /** The agent just used its browser (a hook, a journal entry): search its pane now, then keep an image. */
    poke(id: string): void {
      if (stopped || pokes.has(id)) return;
      const p = setTimeout(() => {
        pokes.delete(id);
        const s = store.get(id);
        if (!s) return;
        void scan(s).then(() => { const t = tracks.get(id); if (t) scheduleCapture(t); }).catch(e => log(`browser of ${id} not searched: ${(e as Error).message}`));
      }, 200);
      p.unref?.();
      pokes.set(id, p);
    },
    /** A front shows the session's browser: its state, its last image, then the film while live. */
    watch(id: string, sink: BrowserSink): void {
      if (!store.get(id)) return sink({ type: 'browser.live', id, state: 'none', tabs: 0 });
      const t = track(id);
      t.watchers.add(sink);
      sink(message(t));
      const img = lastImage(t);
      if (img) sink(img);
      void refilm(t);
    },
    unwatch(id: string, sink: BrowserSink): void {
      const t = tracks.get(id);
      if (!t?.watchers.delete(sink)) return;
      void refilm(t);
    },
    /** A front gone: it watches nothing any more. */
    unwatchAll(sink: BrowserSink): void { for (const t of tracks.values()) if (t.watchers.delete(sink)) void refilm(t); },
    /** Each session's browser that is not `none`, for a new front. */
    states(): BrowserLive[] { return [...tracks.values()].filter(t => t.state !== 'none').map(message); }
  };
}

export type BrowserLiveService = ReturnType<typeof createBrowserLive>;
