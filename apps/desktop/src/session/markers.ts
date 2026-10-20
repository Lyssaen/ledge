/* Markers the agents leave in the thread's text (the mockup's B5): an observability line `[synapse-obs] story=… objectif=…`,
   read as the Story / Objectif tags, and Claude Code's `<task-notification>`, read as a task card. */
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

export type TaskStatus = 'killed' | 'completed' | 'failed' | 'other';
export interface TaskNotice {
  id?: string; output?: string; status: TaskStatus; summary: string;
  /** What the summary is about, when it is one of Claude Code's known sentences. */
  about: { kind: 'agent'; name: string } | { kind: 'command'; command: string; code?: string } | null;
  /** The notification as it came, for « Notification brute ». */
  raw: string;
}

const field = (xml: string, name: string): string | undefined => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim();

/** A prompt that is a `<task-notification>` (a background agent or command that stopped or ended), else null. */
export function taskOf(text: string): TaskNotice | null {
  const raw = text.trim();
  if (!raw.startsWith('<task-notification>')) return null;
  const status = field(raw, 'status');
  const summary = field(raw, 'summary') ?? '';
  const agent = summary.match(/^Agent "(.+)" (?:was |has )?(?:stopped|killed|completed|finished|failed)/);
  const command = summary.match(/^Background command "(.+)" (?:completed|failed|was stopped|was killed)(?: \(exit code (\d+)\))?/);
  return {
    ...(field(raw, 'task-id') !== undefined && { id: field(raw, 'task-id') }),
    ...(field(raw, 'output-file') !== undefined && { output: field(raw, 'output-file') }),
    status: status === 'killed' || status === 'completed' || status === 'failed' ? status : 'other',
    summary,
    about: agent ? { kind: 'agent', name: agent[1]! } : command ? { kind: 'command', command: command[1]!, ...(command[2] !== undefined && { code: command[2] }) } : null,
    raw
  };
}

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
