/* Markers the agents leave in the thread's text (the mockup's B5): an observability line `[synapse-obs] story=… objectif=…`,
   read as the Story / Objectif tags. Claude Code's `<task-notification>`, read as a task card, is parsed in @ledge/ui (thread/task),
   shared with the phone. */
import type { Exchange } from './exchanges';

export interface SynapseTags { story?: string; objectif?: string }

const OBS_LINE = /^[ \t]*\[synapse-obs\][^\n]*(?:\n|$)/gm;
const OBS_PAIR = /(story|objectif)=(\S+)/g;

/** The text without its `[synapse-obs]` lines, and what the last of them says (null: none, or none with a story nor an objective). */
export function synapseOf(text: string): { text: string; tags: SynapseTags | null } {
  if (!text.includes('[synapse-obs]')) return { text, tags: null };
  let tags: SynapseTags | null = null;
  for (const line of text.match(OBS_LINE) ?? []) {
    for (const [, key, value] of line.matchAll(OBS_PAIR)) (tags ??= {})[key as keyof SynapseTags] = value!;
  }
  return { text: text.replace(OBS_LINE, '').trim(), tags };
}

/** A tag's value as shown: the known ones by their label, a ticket key (ST7-123) as it is, the others capitalised with
 *  their dashes read as spaces (« hors-story » → « Hors story »). */
export function tagLabel(value: string, known: Readonly<Record<string, string>>): string {
  const label = known[value.toLowerCase()];
  if (label) return label;
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(value)) return value;
  const words = value.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export { taskOf, type TaskNotice, type TaskStatus } from '@ledge/ui/thread/task';

/** A prompt or an agent's text that carried `[synapse-obs]` lines: what is left to show, and what it noted. */
export interface Marked {
  text: string; tags: SynapseTags;
  /** An agent's text that notes another objective: the one before it (null: none was noted before). */
  was?: string | null;
}

/** The thread's markers in the order shown (each exchange's prompt, then what the agent said): by item id, the items that
 *  carried some, and the Story / Objectif the last of them leave (the page's heading). */
export function marksOf(xs: readonly Exchange[]): { byId: ReadonlyMap<string, Marked>; latest: SynapseTags | null } {
  const byId = new Map<string, Marked>();
  let latest: SynapseTags | null = null;
  const read = (id: string, raw: string, said: boolean) => {
    const { text, tags } = synapseOf(raw);
    if (!tags) return;
    const was = latest?.objectif ?? null;
    byId.set(id, { text, tags, ...(said && tags.objectif !== undefined && tags.objectif !== was && { was }) });
    latest = { ...latest, ...tags };
  };
  for (const x of xs) {
    if (x.prompt) read(x.prompt.id, x.prompt.text, false);
    for (const s of x.segments) if (s.kind === 'say') read(s.item.id, s.item.text, true);
  }
  return { byId, latest };
}
