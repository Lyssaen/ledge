import { useEffect, useState, type JSX } from 'react';
import type { DaemonClient, Fleet, MachineState } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';
import { draftOf, newDraft } from './draft';
import { EditorPlace } from './lazy';

const NO_STATE: Projects = { projects: [], rules: [] };

/** The project editor's dialog (sidebar « + », a table's « Modifier le projet », « Ranger dans… › Nouveau projet… », the New session form).
 *  The draft is taken once, at opening: an unknown project closes the dialog, but one deleted elsewhere while it is edited stays,
 *  and the editor says so on « Enregistrer ». « Supprimer le projet » turns the editor into its deletion view, titled « Supprimer {nom} »;
 *  `startDeleting` (Settings › Projects' « Supprimer ») opens a project straight on that view, and its « Annuler » closes the dialog. */
export function ProjectDialog({ edit, file, startDeleting, projects, sessions, machines, client, fleet, projectIdOf, onClose, onSaved, onDeleted }: {
  edit?: string; file?: string; startDeleting?: boolean; projects: Projects | null; sessions: readonly Session[]; machines: readonly MachineState[];
  client: DaemonClient; fleet: Pick<Fleet, 'setProjects'>; projectIdOf(s: Session): string | null; onClose(): void; onSaved(id: string, created: boolean, filed: Session[]): void;
  onDeleted(id: string, name: string, moveTo: string | null, agents: number): void;
}): JSX.Element | null {
  const { t } = useI18n();
  const [initial] = useState(() => {
    const state = projects ?? NO_STATE;
    if (edit === undefined) return newDraft(state, file === undefined ? undefined : sessions.find(s => s.id === file));
    const p = state.projects.find(x => x.id === edit);
    return p ? draftOf(p) : null;
  });
  const [deleting, setDeleting] = useState(edit !== undefined && startDeleting === true);
  useEffect(() => { if (initial === null) onClose(); }, [initial, onClose]);
  // Opened to delete (`startDeleting`), « Cancel » closes the dialog rather than showing an editor nobody asked for.
  const leaveDeleting = (on: boolean) => { if (on || !startDeleting) setDeleting(on); else onClose(); };
  if (initial === null) return null;
  const current = projects?.projects.find(p => p.id === initial.id);
  const name = current?.name ?? initial.name;
  const title = edit === undefined ? t.projects.titles.new : deleting ? t.projects.titles.delete(name) : t.projects.titles.edit(name);
  return (
    <Modal title={title} wide className="project-modal" onClose={onClose}>
      <EditorPlace mode={edit !== undefined ? 'edit' : 'new'} initial={initial} projects={projects ?? NO_STATE} sessions={sessions} machines={machines}
        client={client} fleet={fleet} projectIdOf={projectIdOf} onClose={onClose} onSaved={onSaved}
        deleting={edit !== undefined && deleting} onDeleting={leaveDeleting} onDeleted={onDeleted} />
    </Modal>
  );
}
