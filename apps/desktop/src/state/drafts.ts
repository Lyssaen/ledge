import { isRecord, readJson, writeJson } from './storage';

/** One draft per qualified session id (spec §9.1), plus `ledge` for the resident's own composer in a later lot. */
export type Drafts = Readonly<Record<string, string>>;
export const DRAFTS_KEY = 'desktop.drafts';
export const DRAFT_MAX = 10_000;

export function loadDrafts(): Drafts {
  const raw = readJson(DRAFTS_KEY);
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(raw)) if (id && typeof text === 'string' && text) out[id] = text.slice(0, DRAFT_MAX);
  return out;
}
export function saveDrafts(d: Drafts): void { writeJson(DRAFTS_KEY, d); }
/** The text is kept as typed (no trim): only sending trims it. */
export function setDraft(d: Drafts, id: string, text: string): Drafts {
  const next = text.slice(0, DRAFT_MAX);
  if ((d[id] ?? '') === next) return d;
  const out = { ...d };
  if (next) out[id] = next; else delete out[id];
  return out;
}
