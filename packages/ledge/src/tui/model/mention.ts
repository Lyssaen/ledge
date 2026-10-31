import type { Rig, RigSeat } from '@ledge/protocol';
import { rigKey, seatMentions, workingCount } from '@ledge/ui/rigs/model';

/** A seat the `@` completion offers: `address` is what the field gets (`@build`, or `@build@factory` when another live seat answers to
 *  `@build`); `detail` its rig, and the seat's own name when the address does not say it (« starter · dev-build »). */
export interface Mention { address: string; rig: string; seat: RigSeat; detail: string }

/** The `@…` word under the cursor (from its `@` to the cursor), or null when the word there does not start with `@`. */
export function mentionAt(text: string, cursor: number): { start: number; query: string } | null {
  let start = cursor;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  if (text[start] !== '@' || start >= cursor) return null;
  return { start, query: text.slice(start + 1, cursor) };
}

/**
 * The seats `@query` may name, as the daemon resolves them (lot 4): this machine's running or partial rigs, kernel aside, seats neither
 * stopped nor crashed, under their long address for every homonym. The query matches the address or its long form (`build@fa`).
 * Desktop's `seatMentions` holds these rules; this adds the rig and the seat the TUI draws.
 */
export function mentionCandidates(query: string, rigs: readonly Rig[]): Mention[] {
  const q = query.toLowerCase();
  const byKey = new Map<string, { rig: Rig; seat: RigSeat }>(rigs.flatMap(rig => rig.seats.map(seat => [`${rigKey(rig)}/${seat.ref}`, { rig, seat }] as const)));
  return seatMentions(rigs, '').flatMap(m => {
    const hit = byKey.get(m.key)!;
    if (!m.insert.slice(1).toLowerCase().startsWith(q)) return [];
    const named = hit.seat.address === `@${hit.seat.name}`;
    return [{ address: m.insert, rig: hit.rig.name, seat: hit.seat, detail: named ? hit.rig.name : `${hit.rig.name} · ${hit.seat.name}` }];
  });
}

/** The text with the `@…` word at `at` replaced by `address` and a space (what tab does). */
export function completeMention(text: string, at: { start: number; query: string }, address: string): string {
  let end = at.start + 1 + at.query.length;
  while (end < text.length && !/\s/.test(text[end]!)) end++;
  return `${text.slice(0, at.start)}${address} ${text.slice(end).replace(/^\s+/, '')}`;
}

/** The rig « Où en est … ? » asks about: the most seats at work, kernel aside; the first listed on a tie. */
export function mostActiveRig(rigs: readonly Rig[]): Rig | undefined {
  let best: Rig | undefined;
  for (const r of rigs) if (!r.kernel && (r.lifecycle === 'running' || r.lifecycle === 'partial') && (!best || workingCount(r) > workingCount(best))) best = r;
  return best;
}
