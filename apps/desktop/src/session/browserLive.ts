import { useEffect, useRef, useState } from 'react';
import { useDaemon, type DaemonClient } from '@ledge/fleet';
import { toolShortName, type BrowserEnabled, type BrowserLive, type Session, type ThreadItem, type ToolItem } from '@ledge/protocol';

/**
 * The agent's own browser, live (docs/mockups/ledge-browser-live.html; protocol packages/protocol/src/browser.ts).
 * `live` / `closed` / `off`: what the session's daemon says. `remote`: a session of another machine, whose browser the local
 * daemon does not follow (lot 2). `none`: nothing to show beyond the captures.
 */
export type BrowserKind = 'none' | 'off' | 'live' | 'closed' | 'remote';
/** The Navigateur tab's two sides: the agent's browser (Direct, or Fermé), and the captures it took (PR #163). */
export type BrowserSide = 'direct' | 'captures';

export const isLocal = (s: Pick<Session, 'machineId'>): boolean => (s.machineId ?? 'local') === 'local';

export function kindOf(browser: BrowserLive | undefined, local: boolean): BrowserKind {
  if (!local) return 'remote';
  return browser?.state ?? 'none';
}

/** The head's button: live (red dot), closed (grey), or the captures' button of today (off: even without a capture,
 *  design-ux 1a; a remote session or none: only with captures). */
export type PillLook = 'live' | 'closed' | 'captures';
export function pillOf(kind: BrowserKind, captures: number): PillLook | null {
  if (kind === 'live' || kind === 'closed') return kind;
  if (kind === 'off') return 'captures';
  return captures > 0 ? 'captures' : null;
}

/** The side the tab shows. Without a browser to follow, only the captures (the tab as before). */
export const hasDirect = (kind: BrowserKind): boolean => kind !== 'none';

/** « Le direct n'est pas activé » shows once for the whole app (the config is global, design-ux 1b). */
let offShown = false;
export const offSeen = (): boolean => offShown;
export const markOffSeen = (): void => { offShown = true; };
/** « Activer » done, for the whole app too: the config is one file. A refusal is not kept: once the config is mended, the
 *  box offers « Activer » again (review qitem-20261103172151). */
let enableResult: BrowserEnabled | null = null;
export const enabledAnswer = (): BrowserEnabled | null => enableResult;
export const keepEnabledAnswer = (a: BrowserEnabled): void => { if (a.outcome !== 'refused') enableResult = a; };
/** Tests only: a fresh app. */
export function resetBrowserLive(): void { offShown = false; enableResult = null; }

/** The side the head's button opens (design-ux 7 and 1b): live / closed on Direct; off on Direct the first time (or without a
 *  capture), then on Captures; a remote session on Captures. A capture's thumbnail always opens Captures. */
export function sideOnOpen(kind: BrowserKind, captures: number, capture: boolean): BrowserSide {
  if (capture || !hasDirect(kind)) return 'captures';
  if (kind === 'live' || kind === 'closed') return 'direct';
  if (kind === 'off') return !offShown || captures === 0 ? 'direct' : 'captures';
  return captures > 0 ? 'captures' : 'direct';
}

/** An address worth opening in the person's browser: http(s) only (an OMP page filled by setContent is about:blank). */
export const openable = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url);
/** The agent's browser shows no address of its own: about:blank (an injected page), or none. */
export const noAddress = (url: string | undefined): boolean => !url || url === 'about:blank';
export const bare = (url: string): string => url.replace(/^[a-z]+:\/\//i, '');

/** The agent's last browser action, read in its thread (Claude): the verb's tool, the objects in « », the row it lights. */
export interface BrowserAction { toolId: string; short: string; at: string; objects: string[]; fields?: number; seconds?: number }
const OBJECT_MAX = 48;
const cut = (s: string) => (s.length > OBJECT_MAX ? `${s.slice(0, OBJECT_MAX - 1)}…` : s);
const parse = (input: string | undefined): Record<string, unknown> => {
  if (!input) return {};
  try { const v: unknown = JSON.parse(input); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; }
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const isBrowserTool = (t: ToolItem) => t.tool.startsWith('mcp__') && t.tool.includes('playwright') && toolShortName(t.tool).startsWith('browser_');

/** design-ux 15:26Z: the object comes from `element` (a bare `ref`: none), an address without its scheme, a text cut at 48. */
export function actionOf(t: ToolItem): BrowserAction {
  const short = toolShortName(t.tool);
  const i = parse(t.input);
  const element = str(i.element);
  const base = { toolId: t.id, short, at: t.at };
  switch (short) {
    case 'browser_click': case 'browser_hover': return { ...base, objects: element ? [cut(element)] : [] };
    case 'browser_navigate': { const u = str(i.url); return { ...base, objects: u ? [cut(bare(u))] : [] }; }
    case 'browser_type': { const x = str(i.text); return { ...base, objects: x ? [cut(x)] : [] }; }
    case 'browser_press_key': { const k = str(i.key); return { ...base, objects: k ? [k] : [] }; }
    case 'browser_fill_form': return { ...base, objects: [], fields: Array.isArray(i.fields) ? i.fields.length : 0 };
    case 'browser_select_option': {
      const v = Array.isArray(i.values) ? i.values.map(String).join(', ') : str(i.values);
      return { ...base, objects: [v, element].filter((x): x is string => !!x).map(cut) };
    }
    case 'browser_wait_for': {
      const x = str(i.text) ?? str(i.textGone);
      if (x) return { ...base, objects: [cut(x)] };
      return typeof i.time === 'number' ? { ...base, objects: [], seconds: i.time } : { ...base, objects: [] };
    }
    case 'browser_drag': { const s = str(i.startElement); return { ...base, objects: s ? [cut(s)] : [] }; }
    case 'browser_resize': return { ...base, objects: typeof i.width === 'number' && typeof i.height === 'number' ? [`${i.width}×${i.height}`] : [] };
    default: return { ...base, objects: [] };
  }
}

/** The last browser action of the session itself (not a subagent's). */
export function lastActionOf(items: readonly ThreadItem[] | undefined): BrowserAction | null {
  if (!items) return null;
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k]!;
    if (it.kind === 'tool' && it.helperId === undefined && isBrowserTool(it)) return actionOf(it);
  }
  return null;
}

/** The session's browser, as the store keeps it. */
export function useBrowser(session: Session): BrowserLive | undefined {
  return useDaemon().browsers.get(session.id);
}

export interface Frame { src: string; at: string; live: boolean; width?: number; height?: number }
/** How long without a frame before the frame rate hides (design-ux 5: never « 0 im/s »). */
export const FPS_WINDOW_MS = 2000;

/** What the film shows, for useBrowserFrames: a frame stays only on the page it was taken of. */
export const pageOf = (b: BrowserLive | undefined): string => (b ? `${b.url ?? ''}\n${b.tabs}` : '');

/**
 * Watches the session's browser while `on` (the Navigateur tab shown on its Direct side): `browser.watch`, the frames as they
 * come, `browser.unwatch` when it stops. Watched again when the browser changes state (the daemon then sends the image it
 * kept) and after each reconnection. `fps`: frames of the film in the last two seconds, per second; null without any.
 */
export function useBrowserFrames(client: DaemonClient, id: string, on: boolean, state: BrowserLive['state'] | undefined, page = ''): { frame: Frame | null; fps: number | null } {
  const { snapshotSeq } = useDaemon();
  const [frame, setFrame] = useState<Frame | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const times = useRef<number[]>([]);
  // Another state (closed, live again), another page (an address, a tab opened or closed) or another session: what showed
  // belongs to the browser as it was (review: an image of page A under B's address); the film, or the watch, brings the next.
  useEffect(() => { setFrame(null); }, [id, state, page]);
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const count = () => {
      const now = Date.now();
      times.current = times.current.filter(x => now - x < FPS_WINDOW_MS);
      // A film: two frames at least in the window. A lone frame (OMP's tab frozen between two calls: one every 3 s, dev-back) shows no rate.
      setFps(times.current.length > 1 ? Math.max(1, Math.round(times.current.length / (FPS_WINDOW_MS / 1000))) : null);
    };
    const off = client.onMessage(m => {
      if (m.type !== 'browser.frame' || m.id !== id) return;
      setFrame({ src: `data:image/jpeg;base64,${m.data}`, at: m.at, live: m.live, width: m.width, height: m.height });
      if (m.live) {
        times.current.push(Date.now()); count();
        clearTimeout(timer); timer = setTimeout(count, FPS_WINDOW_MS);
      }
    });
    client.send({ type: 'browser.watch', id });
    return () => { off(); clearTimeout(timer); times.current = []; setFps(null); client.send({ type: 'browser.unwatch', id }); };
  }, [client, id, on, state, snapshotSeq]);
  return { frame, fps };
}
