import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ALWAYS_USER, MandateCategorySchema, type MandateCategory } from '@ledge/protocol';

/** The content of ~/.ledge/mandat.md (spec §5.3). */
export const DEFAULT_MANDATE = `# Le mandat de Ledge

Ledge tranche seul ce qui est dans la première liste. Tout le reste te revient.
Une ligne = une catégorie : \`- <id> : <description>\`. Les catégories design, architecture et critique te reviennent toujours, même déplacées.

## Ledge tranche seul
- git : git et branches
- tests : tests et relectures
- context : contexte et relèves
- code : petits choix de code

## Te revient toujours
- design : design (UI, copie)
- architecture : architecture (stockage, API)
- critical : critique (données, sécurité, suppression, coûts)
`;

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

/** Moves the line of `c` into « Te revient toujours » (the line is kept as is). */
export function escalateCategory(text: string, c: MandateCategory): string {
  const lines = text.split('\n');
  const isLine = (l: string): boolean => new RegExp(`^\\s*[-*]\\s+${c}\\s+:`).test(l);
  let list: 'self' | 'user' | null = null; const moved: string[] = []; let userHeadingAt = -1;
  const kept: string[] = [];
  for (const l of lines) {
    if (l.trim().startsWith('#')) {
      const title = l.replace(/^\s*#+\s*/, '').toLowerCase();
      list = title.startsWith(SELF_TITLE) ? 'self' : title.startsWith(USER_TITLE) ? 'user' : null;
      if (list === 'user') userHeadingAt = kept.length;
    } else if (list === 'self' && isLine(l)) { moved.push(l.trim()); continue; }
    kept.push(l);
  }
  if (moved.length === 0) return text;
  if (userHeadingAt < 0) return `${kept.join('\n').trimEnd()}\n\n## Te revient toujours\n${moved[0]}\n`;
  let at = userHeadingAt + 1;
  for (let i = at; i < kept.length && !kept[i]!.trim().startsWith('#'); i++) if (/^\s*[-*]\s+/.test(kept[i]!)) at = i + 1;
  kept.splice(at, 0, moved[0]!);
  return kept.join('\n');
}

/** Creates the mandate file with the default text when missing; returns its text. */
export async function ensureMandate(path: string): Promise<string> {
  try { return await readFile(path, 'utf8'); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, DEFAULT_MANDATE);
  return DEFAULT_MANDATE;
}
