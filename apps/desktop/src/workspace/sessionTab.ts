import type { Session } from '@ledge/protocol';
import type { SessionView } from '../session/prefs';
import { viewShown } from '../session/prefs';
import type { ChangedFile } from '../session/changedFiles';
import { dotOf } from '../nav/agents';
import type { Tab } from './model';

/** The pure rules of a session tab (docs/mockups/ledge-ide-interactive.html): what it shows and says, without React.
 *  Types only from changedFiles, so the first bundle does not pull the session chunk. */
export type Provider = 'anthropic' | 'openai' | 'omp';

/** The logo family of a tool; Cursor Agent has none in the mockup (docs/ide-lot-2-questions.md). */
export function providerOf(tool: Session['tool']): Provider | null {
  switch (tool) {
    case 'claude': return 'anthropic';
    case 'codex': return 'openai';
    case 'omp': return 'omp';
    default: return null;
  }
}

/** The view a tab shows: an OMP seat stopped or archived has no terminal left, so its thread, whatever the tab says;
 *  otherwise the tab's choice (role.md comes in lot 7, the thread meanwhile); with none, the session's default. */
export function tabView(tab: Tab, s: Session | undefined): SessionView {
  const seat = s ?? null;
  // viewShown answers « thread » for a stopped or archived OMP seat whatever the visit asks.
  if (seat && viewShown(seat, 'terminal', { id: seat.id, view: 'terminal' }) === 'thread') return 'thread';
  if (tab.view === 'terminal') return 'terminal';
  if (tab.view === 'thread' || tab.view === 'role') return 'thread';
  return viewShown(seat, 'thread', null);
}

/** The alert a tab carries: the state dot's approval or question; an offline session raises none. */
export function tabAlert(s: Session | undefined): 'perm' | 'ask' | null {
  if (!s) return null;
  const dot = dotOf(s);
  return dot === 'approval' ? 'perm' : dot === 'question' ? 'ask' : null;
}

/** « N fichiers +A −B » of the Changes beside a session. */
export function changeTotals(files: readonly ChangedFile[]): { files: number; plus: number; minus: number } {
  return files.reduce((t, f) => ({ files: t.files + 1, plus: t.plus + f.plus, minus: t.minus + f.minus }), { files: 0, plus: 0, minus: 0 });
}

/** The project line: a seat reads « rig · role » (or « rig »), any other session its project. */
export function projectLabel(s: Session, projectName: (s: Session) => string): string {
  if (!s.rig) return projectName(s);
  return s.rig.role ? `${s.rig.name} · ${s.rig.role}` : s.rig.name;
}
