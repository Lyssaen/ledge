import type { Session } from '@ledge/protocol';

/** A Jira key as text (spec §8): never looked up, never linked. */
const KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;
export interface Story { key: string | null; keys: string[]; ambiguous: boolean; source: 'branch' | 'topic' | null }

const found = (text: string | undefined): string[] => [...new Set(text?.match(KEY) ?? [])];

/** The branch speaks first; the topic only when the branch names no key. */
export function story(s: Pick<Session, 'branch' | 'topic'>): Story {
  for (const source of ['branch', 'topic'] as const) {
    const keys = found(s[source]);
    if (keys.length === 1) return { key: keys[0]!, keys, ambiguous: false, source };
    if (keys.length > 1) return { key: null, keys, ambiguous: true, source };
  }
  return { key: null, keys: [], ambiguous: false, source: null };
}
