import { splitId } from '@ledge/fleet';
import type { Session, Tool } from '@ledge/protocol';

export const TOOL_NAME: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', omp: 'OMP' };

/** « opus · high », the model alone, or `fallback` when the agent runs its own default. */
export const modelLabel = (s: Pick<Session, 'model' | 'effort'>, fallback: string): string =>
  [s.model ?? (s.effort ? fallback : ''), s.effort ?? ''].filter(Boolean).join(' · ') || fallback;

/** The machine's name as the fleet annotates it, « Local » by default. */
export const machineLabel = (s: Session): string => s.machineName ?? splitId(s.id)?.machine ?? 'Local';

/** The tmux session a pane preview comes from, as the mockup titles it: `ledge-<raw id>`. */
export const paneName = (s: Session): string => s.tmuxSession ?? `ledge-${splitId(s.id)?.id ?? s.id}`;

/** `s` cut to `n` cells with « … », or padded with spaces to `n`. Counts code points (the TUI's text has no wide characters). */
export function fit(s: string, n: number): string {
  const cps = [...s];
  if (n <= 0) return '';
  return cps.length > n ? `${cps.slice(0, Math.max(0, n - 1)).join('')}…` : s + ' '.repeat(n - cps.length);
}
