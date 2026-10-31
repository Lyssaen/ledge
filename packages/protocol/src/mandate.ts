import { ALWAYS_USER, MandateCategorySchema, type MandateCategory } from './openrig.js';

/** The mandate as read from `~/.ledge/mandat.md` (spec §5.3): what Ledge decides alone (`self`) and what goes to the user (`user`).
 *  Shared by the daemon (the guard) and the clients (the Mandat tab). */
export interface Mandate { self: MandateCategory[]; user: MandateCategory[]; readable: boolean }

const SELF_TITLE = 'ledge tranche seul';
const USER_TITLE = 'te revient toujours';
const isAlways = (id: string): boolean => (ALWAYS_USER as readonly string[]).includes(id);

export interface MandateEntry { id: string | undefined; said: string }
export interface MandateEntries { self: MandateEntry[]; user: MandateEntry[]; always: MandateEntry[]; readable: boolean }

/** The raw `- <id> : <description>` lines of both lists; always-user ids found in the first list are set apart in `always`. */
export function mandateEntries(text: string): MandateEntries {
  const out: MandateEntries = { self: [], user: [], always: [], readable: false };
  let list: 'self' | 'user' | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      const title = line.replace(/^#+\s*/, '').toLowerCase();
      list = title.startsWith(SELF_TITLE) ? 'self' : title.startsWith(USER_TITLE) ? 'user' : null;
      if (list) out.readable = true;
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line)?.[1]; if (!list || !item) continue;
    const m = /^(\S+)\s+:\s+(.+)$/.exec(item);
    const entry = { id: m?.[1], said: (m?.[2] ?? item).trim() };
    if (list === 'self' && entry.id && isAlways(entry.id)) out.always.push(entry); else out[list].push(entry);
  }
  return out;
}

const known = (id: string | undefined): MandateCategory | null => {
  const r = MandateCategorySchema.safeParse(id); return r.success ? r.data : null;
};

/** What Ledge decides alone: known categories of the first list, never design, architecture or critical. Unreadable: nothing. */
export function parseMandate(text: string): Mandate {
  const e = mandateEntries(text);
  if (!e.readable) return { self: [], user: [], readable: false };
  const uniq = (xs: (MandateCategory | null)[]): MandateCategory[] => [...new Set(xs.filter((x): x is MandateCategory => x !== null))];
  const user = uniq([...e.user, ...e.always].map(x => known(x.id)));
  return { self: uniq(e.self.map(x => known(x.id))).filter(c => !user.includes(c)), user, readable: true }; // in both lists: the user wins
}
