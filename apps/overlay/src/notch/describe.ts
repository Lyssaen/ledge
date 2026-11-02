/** The activity line in words (mockup « Textes FR / EN », keys notch.line.*): the names from the snapshot, the verb by tool. */
import type { Messages } from '../i18n/messages';
import { target } from '../thread/tools';
import type { NotchLine } from './line';

export type ToolKind = 'read' | 'edit' | 'search' | 'command' | 'other';
export const toolKind = (tool: string): ToolKind =>
  /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/.test(tool) ? 'edit'
    : /^(Grep|Glob|LS|WebFetch|WebSearch)$/.test(tool) ? 'search'
      : tool === 'Read' ? 'read'
        : /^(Bash|Shell|exec_command)$/.test(tool) ? 'command' : 'other';

/** The line's parts, in order. `name` is bold, `verb` grey, `text` plain, `code` mono. */
export type Part = { k: 'name' | 'verb' | 'text' | 'code' | 'arrow' | 'sub'; s: string };
export interface Described {
  parts: Part[];
  /** The whole line on one row: the tooltip. */
  text: string;
  /** The Ledge session a click opens (a message: the sender's); null for a track. */
  open: string | null;
  /** Who the click opens, for its label. */
  who: string;
}

/** The address before « @ » (dev-front@ledge-dev-2 → dev-front). */
const bare = (address: string) => address.split('@')[0] || address;

/** The label without the tool's name in front (« Edit src/a.ts » → « src/a.ts »), then the short target. */
export function toolTarget(tool: string, label: string): string {
  const l = label.trim();
  const rest = l.startsWith(`${tool} `) ? l.slice(tool.length + 1) : l;
  return target({ tool, label: rest });
}

export function describe(line: NotchLine, name: (id: string) => string, t: Messages): Described {
  const L = t.notch.line;
  if (line.kind === 'track') {
    const parts: Part[] = [{ k: 'name', s: line.title }, ...(line.artist ? [{ k: 'text' as const, s: line.artist }] : [])];
    return { parts, text: line.artist ? `${line.title} · ${line.artist}` : line.title, open: null, who: line.title };
  }
  const who = name(line.session);
  const sub: Part[] = 'helperId' in line && line.helperId ? [{ k: 'sub', s: L.helper }] : [];
  switch (line.kind) {
    case 'message': {
      const other = line.peer ? name(line.peer) : bare(line.counterpart);
      const [from, to] = line.direction === 'out' ? [who, other] : [other, who];
      const open = line.direction === 'out' ? line.session : line.peer ?? line.session;
      return { parts: [{ k: 'name', s: from }, ...sub, { k: 'arrow', s: '→' }, { k: 'name', s: to }, { k: 'text', s: line.summary }], text: `${from} → ${to} · ${line.summary}`, open, who: line.direction === 'out' ? from : line.peer ? from : to };
    }
    case 'tool': {
      const k = toolKind(line.tool);
      const verb = k === 'other' ? L.tool.other(line.tool) : L.tool[k];
      const code = toolTarget(line.tool, line.label);
      return { parts: [{ k: 'name', s: who }, ...sub, { k: 'verb', s: verb }, ...(code ? [{ k: 'code' as const, s: code }] : [])], text: `${who} ${verb}${code ? ` ${code}` : ''}`, open: line.session, who };
    }
    case 'thinking':
      return { parts: [{ k: 'name', s: who }, ...sub, { k: 'verb', s: L.thinking }], text: `${who} ${L.thinking}`, open: line.session, who };
    case 'notification': {
      const verb = L.reason[line.reason];
      return { parts: [{ k: 'name', s: who }, { k: 'verb', s: verb }, ...(line.text ? [{ k: 'text' as const, s: line.text.replace(/\s+/g, ' ') }] : [])], text: `${who} ${verb}${line.text ? ` · ${line.text}` : ''}`, open: line.session, who };
    }
  }
}
