import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MandateCategory } from '@ledge/protocol';

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

export { mandateEntries, parseMandate, type Mandate, type MandateEntries, type MandateEntry } from '@ledge/protocol';

const SELF_TITLE = 'ledge tranche seul';
const USER_TITLE = 'te revient toujours';

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
