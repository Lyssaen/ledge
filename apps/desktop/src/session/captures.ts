import { isBrowserCapture, toolShortName, type AttachmentRef, type ThreadItem } from '@ledge/protocol';

export interface Capture {
  /** `${toolId}:${index}`: unique even when two rows hold the same image. */
  key: string;
  toolId: string; index: number; ref: AttachmentRef; at: string; turn: number;
  helperId?: string;
  /** The last `- Page URL: <url>` a Playwright tool reported in the same helper scope, at or before this row. */
  url?: string;
  /** The tool's short name, only when it is not a browser screenshot. */
  tool?: string;
}

const PAGE_URL = /^- Page URL: (\S.*?)\s*$/gm;
const lastPageUrl = (output: string): string | undefined => {
  let url: string | undefined;
  for (const m of output.matchAll(PAGE_URL)) url = m[1];
  return url;
};

/** Every image the thread's tool rows hold, in thread order, each with the page it was taken on. */
export function capturesOf(items: readonly ThreadItem[]): Capture[] {
  const urls = new Map<string | undefined, string>();
  const out: Capture[] = [];
  for (const it of items) {
    if (it.kind !== 'tool') continue;
    if (it.tool.includes('playwright') && it.output) {
      const u = lastPageUrl(it.output);
      if (u) urls.set(it.helperId, u);
    }
    const browser = isBrowserCapture(it.tool);
    (it.images ?? []).forEach((ref, index) => {
      out.push({
        key: `${it.id}:${index}`, toolId: it.id, index, ref, at: it.at, turn: it.turn, helperId: it.helperId,
        url: browser ? urls.get(it.helperId) : undefined,
        tool: browser ? undefined : toolShortName(it.tool)
      });
    });
  }
  return out;
}

/** The number of distinct turns the captures were taken in. */
export const exchangesOf = (captures: readonly Capture[]): number => new Set(captures.map(c => c.turn)).size;
