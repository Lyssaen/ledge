/**
 * The IDE palette's rows (docs/ide-workspace.md, « Raccourcis » › Ctrl+K; mockup v27 `palItems`, states in
 * ledge-ide-layouts-palette.html): `@` lists the sessions and the seats, `>` the commands and the open MRs and PRs; without a
 * prefix, the sessions waiting for the user come first, then the commands, the MRs and PRs, then the other sessions. A word
 * filters the labels, accents and case aside. Ten rows at most.
 */
export interface PaletteCommand { kind: 'command'; id: string; label: string; /** right-aligned hint (« actuelle », a machine). */ hint?: string; run(): void }
export interface PaletteSession { kind: 'session'; id: string; label: string; /** the rig of a seat, the project of a session (« · archivée »). */ hint: string; waiting: boolean; run(): void }
export type PaletteRow = PaletteCommand | PaletteSession;

export const PALETTE_MAX = 10;

/** Lower case, accents off: « Réglages » matches « reglages ». */
export const foldText = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function paletteRows(query: string, sessions: readonly PaletteSession[], commands: readonly PaletteCommand[], prs: readonly PaletteCommand[] = []): PaletteRow[] {
  const q = query.trimStart();
  const all: PaletteRow[] = q.startsWith('@') ? [...sessions]
    : q.startsWith('>') ? [...commands, ...prs]
    : [...sessions.filter(s => s.waiting), ...commands, ...prs, ...sessions.filter(s => !s.waiting)];
  const word = foldText(q.replace(/^[@>]/, '').trim());
  return all.filter(r => foldText(r.label).includes(word)).slice(0, PALETTE_MAX);
}
