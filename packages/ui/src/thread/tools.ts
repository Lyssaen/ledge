/** Pure helpers behind the live tool line (surface/LiveToolLine.tsx): which tool runs, how to name its target. */
import type { ThreadItem, ToolItem } from '@ledge/protocol';

const TARGET_MAX = 40;
const looksLikePath = (s: string) => !/\s/.test(s) && s.includes('/');
/** Cut at the last word boundary past the middle, so a command loses a flag rather than half a word. */
function cut(s: string, max = TARGET_MAX): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}
/** The short path: its last two segments, or the last one when those are still too long. */
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const two = parts.slice(-2).join('/');
  return two.length <= TARGET_MAX ? two : cut(parts.at(-1) ?? two);
}
/** The raw target behind a call: the daemon's label is the path or the command itself; test fixtures write "Tool · x". */
export function rawTarget(item: Pick<ToolItem, 'tool' | 'label'>): string {
  let s = item.label.trim();
  const prefix = `${item.tool} · `;
  if (s.startsWith(prefix)) s = s.slice(prefix.length);
  if (s === item.tool) return '';
  // A tool without a path or command is labelled with its JSON input (Grep, Glob, WebFetch…): keep its telling field.
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      const v = ['pattern', 'query', 'url', 'file_path', 'path', 'command', 'description', 'prompt'].map(k => o[k]).find(x => typeof x === 'string' && x);
      if (typeof v === 'string') s = v;
    } catch { /* not JSON after all: shown as is */ }
  }
  return (s.split('\n')[0] ?? '').trim();
}
/** The target in one short piece: a path to its tail, a command to its first line, cut at 40 characters. */
export function target(item: Pick<ToolItem, 'tool' | 'label'>): string {
  const raw = rawTarget(item);
  return looksLikePath(raw) ? shortPath(raw) : cut(raw);
}

export const toolItems = (items: ThreadItem[]): ToolItem[] => items.filter((i): i is ToolItem => i.kind === 'tool');

/** The tool running now: the latest one still without a result. */
export function liveTool(items: ThreadItem[]): ToolItem | undefined {
  const running = toolItems(items).filter(i => i.status === 'running');
  return running.length ? running.reduce((a, b) => (a.at <= b.at ? b : a)) : undefined;
}

/** The braille spinner's frames, 80 ms each. */
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
/** The still frame of a line that must not move. */
export const SPINNER_STILL = '⠿';
/** The time a call took, final when the daemon gave it, counted from its start otherwise. */
export const elapsedMs = (item: ToolItem, now: number): number => item.durationMs ?? Math.max(0, now - Date.parse(item.at));
