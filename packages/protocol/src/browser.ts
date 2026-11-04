import { z } from 'zod';

/**
 * The agent's own browser, watched live (docs/mockups/ledge-browser-live.html): the daemon finds the Chrome under a session's
 * pane (Playwright MCP for Claude, OMP's built-in browser for a seat), attaches to it over CDP with a closed list of
 * read-only commands, and films the agent's tab while a front watches. Without a viewer it keeps one image of the tab, taken
 * after the agent's browser actions, so a closed browser still shows what it last showed. Local machine only.
 */

/**
 * `none`: no browser to show (none found, or an OMP browser open with no tab): no button.
 * `off`: the agent uses a browser that does not let Ledge watch it (Playwright MCP without `--remote-debugging-port`):
 *   « Le direct n'est pas activé » and its « Activer le direct… ».
 * `live`: at least one of the agent's tabs is open; a `browser.watch` films it.
 * `closed`: it was live and is not any more; `closed` says how, `image` the last image kept, if any.
 */
/** The live browser is this machine's only (lot 1): a `ledge bridge` and an SSH link carry none of its messages either way. */
export const isBrowserMessage = (type: string): boolean => type.startsWith('browser.');
/** A snapshot crossing a bridge or an SSH link: the peer's browsers are not offered, whatever its daemon can do. */
export function withoutBrowserLive<T extends { type: string; daemon?: { browserLive?: boolean } }>(msg: T): T {
  if (msg.type !== 'snapshot' || !msg.daemon?.browserLive) return msg;
  const { browserLive: _, ...daemon } = msg.daemon;
  return { ...msg, daemon };
}

export const BrowserStateSchema = z.enum(['none', 'off', 'live', 'closed']);
export type BrowserState = z.infer<typeof BrowserStateSchema>;

/** `browser`: the agent closed its browser. `tabs`: an OMP browser that stays open closed its last tab. `stopped`: the session ended. */
export const BrowserClosedHowSchema = z.enum(['browser', 'tabs', 'stopped']);
export type BrowserClosedHow = z.infer<typeof BrowserClosedHowSchema>;

export const BROWSER_URL_MAX = 2048;
export const BROWSER_TITLE_MAX = 300;
/** A frame's JPEG, base64: about 1.5 MB of image at most; a bigger one is dropped, never cut. */
export const BROWSER_FRAME_MAX = 2_000_000;

const url = z.string().max(BROWSER_URL_MAX);
/**
 * Which page an image is of: the agent's tab and its navigation, opaque (`<tab>.<navigation>`), only ever compared. It
 * changes when the agent goes to another tab or the tab to another address; two tabs on the same address differ.
 */
const page = z.string().min(1).max(64);
const title = z.string().max(BROWSER_TITLE_MAX);

/**
 * A session's browser as it stands: after each snapshot (for each session whose state is not `none`), on every change
 * (broadcast to the local fronts), and in answer to a `browser.watch`. `url` and `title` are the agent's tab now (live) or
 * at the end (closed); an OMP tab filled by `setContent` has `about:blank` as its address. `tabs`: the agent's tabs open
 * now. `since`: when it went live (or off). `image`: the last image kept, when one was taken (its `at` is when).
 */
export const BrowserLiveSchema = z.object({
  type: z.literal('browser.live'), id: z.string(),
  state: BrowserStateSchema,
  url: url.optional(), title: title.optional(),
  /** The page the film shows now (live), or showed last (closed). A front shows a frame only when its `page` is this one. */
  page: page.optional(),
  tabs: z.number().int().nonnegative(),
  since: z.string().datetime().optional(),
  closedAt: z.string().datetime().optional(), closed: BrowserClosedHowSchema.optional(),
  image: z.object({ at: z.string().datetime(), url: url.optional(), title: title.optional(), page: page.optional() }).optional()
});
export type BrowserLive = z.infer<typeof BrowserLiveSchema>;

/**
 * One image of the agent's tab, JPEG in base64, only to a front that watches the session. `live`: a frame of the film,
 * as the page changes (nothing while it stands still); false: the last image kept, sent once on `browser.watch` when there
 * is one, whatever the state.
 */
export const BrowserFrameSchema = z.object({
  type: z.literal('browser.frame'), id: z.string(),
  data: z.string().min(1).max(BROWSER_FRAME_MAX),
  at: z.string().datetime(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  /** The page this image is of (film or kept image): a late frame of another page is told apart by it. */
  page: page.optional(),
  live: z.boolean()
});
export type BrowserFrame = z.infer<typeof BrowserFrameSchema>;

/** The front shows the session's browser: answered by its `browser.live`, then its last image, then the film while live. */
export const BrowserWatchSchema = z.object({ type: z.literal('browser.watch'), id: z.string().min(1) });
/** The front stops showing it (also implied when its socket closes): the film stops when nobody watches. */
export const BrowserUnwatchSchema = z.object({ type: z.literal('browser.unwatch'), id: z.string().min(1) });

/**
 * « Activer le direct… », once the person confirmed: the daemon adds `--remote-debugging-port=0` to the Playwright MCP
 * config Claude Code loads (`PLAYWRIGHT_MCP_CONFIG` in `~/.claude/settings.json`), keeping everything else. It applies to
 * the Playwright servers started after it (the agents' next sessions). Never sent without the person's confirmation.
 */
export const BrowserEnableSchema = z.object({ type: z.literal('browser.enable'), rid: z.string().min(1).max(100), confirmed: z.literal(true) });

/**
 * The answer to a `browser.enable`. `enabled`: the line was added; `already`: it was there. `refused`, with `reason`:
 * `not_configured` (Claude Code loads no Playwright MCP config file: nothing Ledge may change), `invalid_config` (the file
 * is not a JSON object Ledge can add to; left untouched), `write_failed`. `path`: the config file, when known.
 */
export const BrowserEnabledSchema = z.object({
  type: z.literal('browser.enabled'), rid: z.string(),
  outcome: z.enum(['enabled', 'already', 'refused']),
  reason: z.enum(['not_configured', 'invalid_config', 'write_failed']).optional(),
  path: z.string().optional()
});
export type BrowserEnabled = z.infer<typeof BrowserEnabledSchema>;
