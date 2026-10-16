import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { withRule, type Fleet } from '@ledge/fleet';
import { normalizePath, type Projects, type Rule, type Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

/** Putting an agent away (spec § 2.3, § 3): a « dossier → projet » rule written to the local daemon, which applies it on its
 *  `projects` broadcast. Nothing moves before that broadcast. */
export type FileResult = 'sent' | 'offline' | 'outdated' | 'invalid';

/** A folder's own name: the last segment of its path. */
export const folderOf = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The rule that ties this session's folder, on its machine, to the project. */
export function ruleFor(s: Session, project: string): Rule {
  return { machine: s.machineId ?? 'local', path: normalizePath(s.cwd), project };
}

/** Écrit la règle au daemon ; ne lève jamais. `projects` null : 'outdated' sans appel. Erreurs par `name` : DaemonOffline → 'offline',
 *  DaemonOutdated → 'outdated', toute autre (zod : chemin non absolu…) → 'invalid'. */
export function fileSession(fleet: Pick<Fleet, 'setProjects'>, projects: Projects | null, s: Session, project: string): FileResult {
  if (projects === null) return 'outdated';
  try {
    fleet.setProjects(withRule(projects, ruleFor(s, project)));
    return 'sent';
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return name === 'DaemonOffline' ? 'offline' : name === 'DaemonOutdated' ? 'outdated' : 'invalid';
  }
}

export interface DropTarget { onDragOver(e: DragEvent): void; onDragLeave(e: DragEvent): void; onDrop(e: DragEvent): void }
export interface Filing {
  dragging: Session | null;
  /** The id of the project under the pointer. */
  over: string | null;
  /** The session that just reached its table (1.6 s). */
  seated: string | null;
  dragProps(s: Session): { draggable: true; onDragStart(e: DragEvent): void; onDragEnd(): void };
  dropProps(projectId: string): DropTarget;
  file(s: Session, projectId: string): void;
}

const SEATED_MS = 1600;
/** How long a sent rule waits for the broadcast that applies it. */
const UNCONFIRMED_MS = 8000;

/** The drag and drop of observatory.tsx (`dragProps`, `dropProps`, `assign`), on the real fleet: a drop or « Ranger dans… »
 *  writes the rule; once a broadcast places the session in that project, the toast says so and the agent pops into its seat.
 *  A refusal (daemon down or outdated, a folder Ledge cannot remember) is said in plain words and nothing moves. */
export function useFiling(o: { fleet: Pick<Fleet, 'setProjects'>; projects: Projects | null; sessions: readonly Session[]; projectIdOf: (s: Session) => string | null; notify: (text: string) => void }): Filing {
  const { fleet, projects, sessions, projectIdOf, notify } = o;
  const { t } = useI18n();
  const [dragging, setDragging] = useState<Session | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [seated, setSeated] = useState<string | null>(null);
  // The drag being carried, read by the targets' handlers whatever render they come from.
  const carried = useRef<Session | null>(null);
  // Sent rules waiting for their broadcast: session id → the project and the clock that gives up on it.
  const waiting = useRef(new Map<string, { projectId: string; timer: ReturnType<typeof setTimeout> }>());
  useEffect(() => () => { for (const { timer } of waiting.current.values()) clearTimeout(timer); waiting.current.clear(); }, []);

  const file = useCallback((s: Session, projectId: string) => {
    const result = fileSession(fleet, projects, s, projectId);
    if (result !== 'sent') { notify(t.filing[result](s.name)); return; }
    const before = waiting.current.get(s.id);
    if (before) clearTimeout(before.timer);
    // A rule the daemon took but never applied (a write that failed, a socket dropped after the send): say so, forget it.
    const timer = setTimeout(() => {
      if (waiting.current.get(s.id)?.timer !== timer) return;
      waiting.current.delete(s.id);
      notify(t.filing.unconfirmed(s.name));
    }, UNCONFIRMED_MS);
    waiting.current.set(s.id, { projectId, timer });
  }, [fleet, projects, notify, t]);

  // A broadcast placed a waiting session in its project: say so, seat it, forget it.
  useEffect(() => {
    for (const [id, { projectId, timer }] of waiting.current) {
      const s = sessions.find(x => x.id === id);
      if (!s || projectIdOf(s) !== projectId) continue;
      clearTimeout(timer);
      waiting.current.delete(id);
      notify(t.filing.joined(s.name, projects?.projects.find(p => p.id === projectId)?.name ?? projectId));
      setSeated(id);
    }
  }, [sessions, projectIdOf, projects, notify, t]);
  useEffect(() => {
    if (seated === null) return;
    const timer = setTimeout(() => setSeated(null), SEATED_MS);
    return () => clearTimeout(timer);
  }, [seated]);

  const stop = useCallback(() => { carried.current = null; setDragging(null); setOver(null); }, []);
  // The dragged card unmounted mid-drag (its agent filed elsewhere, gone, now covered by a repo): its dragend fires on a
  // detached node React never hears, so the drag stops here, and nothing is left carried for a later drop.
  useEffect(() => {
    if (dragging !== null && !sessions.some(s => s.id === dragging.id && projectIdOf(s) === null)) stop();
  }, [dragging, sessions, projectIdOf, stop]);
  // The safety net: any drag that ends, or drops, stops ours. The drop waits a turn so the target under it files first.
  useEffect(() => {
    if (dragging === null) return;
    let later: ReturnType<typeof setTimeout> | undefined;
    const end = () => stop();
    const drop = () => { clearTimeout(later); later = setTimeout(stop, 0); };
    window.addEventListener('dragend', end, true);
    window.addEventListener('drop', drop, true);
    return () => { window.removeEventListener('dragend', end, true); window.removeEventListener('drop', drop, true); clearTimeout(later); };
  }, [dragging, stop]);
  const dragProps = (s: Session) => ({
    draggable: true as const,
    onDragStart(e: DragEvent) {
      e.dataTransfer.setData('text/plain', s.id);
      e.dataTransfer.effectAllowed = 'move';
      carried.current = s;
      setDragging(s);
    },
    onDragEnd: stop
  });
  // A target only takes a drag that started in the app.
  const dropProps = (projectId: string): DropTarget => ({
    onDragOver(e) {
      if (!carried.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(projectId);
    },
    onDragLeave(e) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(o => (o === projectId ? null : o));
    },
    onDrop(e) {
      const s = carried.current;
      if (!s) return;
      e.preventDefault();
      stop();
      file(s, projectId);
    }
  });

  return { dragging, over, seated, dragProps, dropProps, file };
}
