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
 *  and the editor says so on « Enregistrer ». */
export function ProjectDialog({ edit, file, projects, sessions, machines, client, fleet, projectIdOf, onClose, onSaved }: {
  edit?: string; file?: string; projects: Projects | null; sessions: readonly Session[]; machines: readonly MachineState[];
  client: DaemonClient; fleet: Pick<Fleet, 'setProjects'>; projectIdOf(s: Session): string | null; onClose(): void; onSaved(id: string, created: boolean, filed: Session[]): void;
}): JSX.Element | null {
  const { t } = useI18n();
  const [initial] = useState(() => {
    const state = projects ?? NO_STATE;
    if (edit === undefined) return newDraft(state, file === undefined ? undefined : sessions.find(s => s.id === file));
    const p = state.projects.find(x => x.id === edit);
    return p ? draftOf(p) : null;
  });
  useEffect(() => { if (initial === null) onClose(); }, [initial, onClose]);
  if (initial === null) return null;
  const current = projects?.projects.find(p => p.id === initial.id);
  const title = edit !== undefined ? t.projects.titles.edit(current?.name ?? initial.name) : t.projects.titles.new;
  return (
    <Modal title={title} wide className="project-modal" onClose={onClose}>
      <EditorPlace mode={edit !== undefined ? 'edit' : 'new'} initial={initial} projects={projects ?? NO_STATE} sessions={sessions} machines={machines}
        client={client} fleet={fleet} projectIdOf={projectIdOf} onClose={onClose} onSaved={onSaved} onDeleted={onClose} />
    </Modal>
  );
}
