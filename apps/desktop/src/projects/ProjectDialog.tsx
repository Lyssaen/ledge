import { useEffect, useRef, useState, type JSX } from 'react';
import type { DaemonClient, Fleet, MachineState, Proposal } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';
import { draftFromProposal, draftOf, newDraft, type ProjectDraft } from './draft';
import { EditorPlace } from './lazy';
import { proposalOf } from './proposals';

const NO_STATE: Projects = { projects: [], rules: [] };

/** What the editor shows, for the dialog's title: its form, Ledge's scan, or a proposal (`target`: the project it adds to, by name). */
export type EditorPhase = { kind: 'form' } | { kind: 'scan' } | { kind: 'proposal'; target: string | null };

/** The project editor's dialog (sidebar « + », a table's « Modifier le projet », « Ranger dans… › Nouveau projet… », the New session form).
 *  The draft is taken once, at opening: an unknown project closes the dialog, but one deleted elsewhere while it is edited stays,
 *  and the editor says so on « Enregistrer ». « Supprimer le projet » turns the editor into its deletion view, titled « Supprimer {nom} »;
 *  `startDeleting` (Settings › Projects' « Supprimer ») opens a project straight on that view, and its « Annuler » closes the dialog.
 *  `proposal` (lot 11): the pid of a proposal kept by rememberProposal, opened on its draft (a new project, or « Ajouter à » its
 *  target); a pid no longer known closes the dialog and `notify` says so. The editor names its phases (Ledge's scan, a proposal). */
export function ProjectDialog({ edit, file, startDeleting, proposal, projects, sessions, machines, client, fleet, projectIdOf, paused = false, notify, onClose, onSaved, onDeleted }: {
  edit?: string; file?: string; startDeleting?: boolean; proposal?: string; projects: Projects | null; sessions: readonly Session[]; machines: readonly MachineState[];
  client: DaemonClient; fleet: Pick<Fleet, 'setProjects'>; projectIdOf(s: Session): string | null; paused?: boolean; notify?(text: string): void;
  onClose(): void; onSaved(id: string, created: boolean, filed: Session[]): void;
  onDeleted(id: string, name: string, moveTo: string | null, agents: number): void;
}): JSX.Element | null {
  const { t } = useI18n();
  const [opened] = useState((): { draft: ProjectDraft; proposal?: Proposal } | null => {
    const state = projects ?? NO_STATE;
    if (proposal !== undefined) {
      const p = proposalOf(proposal);
      return p ? { draft: draftFromProposal(p, state), proposal: p } : null;
    }
    if (edit === undefined) return { draft: newDraft(state, file === undefined ? undefined : sessions.find(s => s.id === file)) };
    const p = state.projects.find(x => x.id === edit);
    return p ? { draft: draftOf(p) } : null;
  });
  const initial = opened?.draft ?? null;
  const [deleting, setDeleting] = useState(edit !== undefined && startDeleting === true);
  const [phase, setPhase] = useState<EditorPhase>(() => opened?.proposal
    ? { kind: 'proposal', target: opened.draft.id === undefined ? null : opened.draft.name } : { kind: 'form' });
  const said = useRef(false);
  useEffect(() => {
    if (initial !== null) return;
    if (proposal !== undefined && !said.current) { said.current = true; notify?.(t.projects.ledge.gone); }
    onClose();
  }, [initial, onClose, proposal, notify, t]);
  // Opened to delete (`startDeleting`), « Cancel » closes the dialog rather than showing an editor nobody asked for.
  const leaveDeleting = (on: boolean) => { if (on || !startDeleting) setDeleting(on); else onClose(); };
  if (initial === null) return null;
  const current = projects?.projects.find(p => p.id === initial.id);
  const name = current?.name ?? initial.name;
  const titles = t.projects.titles;
  const title = deleting ? titles.delete(name)
    : phase.kind === 'scan' ? titles.scan
    : phase.kind === 'proposal' ? (phase.target === null ? titles.proposal : titles.proposalFor(phase.target))
    : initial.id === undefined ? titles.new : titles.edit(name);
  return (
    <Modal title={title} wide className="project-modal" onClose={onClose}>
      <EditorPlace mode={initial.id !== undefined ? 'edit' : 'new'} initial={initial} proposal={opened?.proposal} projects={projects ?? NO_STATE} sessions={sessions} machines={machines}
        client={client} fleet={fleet} projectIdOf={projectIdOf} paused={paused} onPhase={setPhase} onClose={onClose} onSaved={onSaved}
        deleting={edit !== undefined && deleting} onDeleting={leaveDeleting} onDeleted={onDeleted} />
    </Modal>
  );
}
