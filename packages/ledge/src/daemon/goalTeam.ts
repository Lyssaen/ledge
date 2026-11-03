import type { TeamProposal } from '@ledge/protocol';

/**
 * The Ledge ↔ Max convention (docs/vision/ledge-goal-contract.md): what ties an ask to a goal (its `ledge-goal:<id>` tag) and the team
 * Max proposes in it (a ```ledge-team``` JSON block in its body). Read leniently: a missing or unreadable block leaves the ask as text.
 */

export const GOAL_TAG = 'ledge-goal';
/** The tag on everything about one goal: Max's asks, and the rows he hands the goal on with. */
export const goalTag = (goalQitemId: string): string => `${GOAL_TAG}:${goalQitemId}`;

/** The goal a row is about, from its `ledge-goal:<id>` tag. */
export function goalOf(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  const t = tags.find((x): x is string => typeof x === 'string' && x.startsWith(`${GOAL_TAG}:`));
  return t ? t.slice(GOAL_TAG.length + 1) || null : null;
}

const BLOCK = /```ledge-team[^\n]*\n([\s\S]*?)```/;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : []);

/** `pod-member@rig` → `pod.member`. */
const roleOf = (seat: string): string | null => {
  const m = /^([A-Za-z0-9][A-Za-z0-9_]*)-([A-Za-z0-9][A-Za-z0-9_-]*)@/.exec(seat);
  return m ? `${m[1]}.${m[2]}` : null;
};

/** The team of a ```ledge-team``` block, or null when there is none or it does not read (the proposal is then plain text). */
export function parseTeam(body: string): TeamProposal | null {
  const m = BLOCK.exec(body);
  if (!m) return null;
  let raw: unknown;
  try { raw = JSON.parse(m[1]!); } catch { return null; }
  const o = obj(raw), rig = text(o.rig), kind = o.kind === 'launch' || o.kind === 'existing' ? o.kind : null;
  if (!rig || !kind) return null;
  const seats = (Array.isArray(o.seats) ? o.seats : []).flatMap(x => {
    const s = obj(x), seat = text(s.seat);
    return seat ? [{ seat, name: text(s.name), role: text(s.role) ?? roleOf(seat), note: text(s.note) }] : [];
  });
  const l = obj(o.launch ?? o);
  return {
    kind, rig, running: typeof o.running === 'boolean' ? o.running : null, folder: text(o.folder), seats, reason: text(o.reason),
    launch: kind === 'launch'
      ? { agents: typeof l.agents === 'number' && Number.isInteger(l.agents) ? l.agents : null, runtimes: strings(l.runtimes), plan: text(l.plan), writes: strings(l.writes), permissions: text(l.permissions) }
      : null
  };
}

/** A proposal's text without its block. */
export const withoutTeam = (body: string): string => body.replace(BLOCK, '').trim();
