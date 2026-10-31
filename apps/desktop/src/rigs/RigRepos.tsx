import type { JSX } from 'react';
import type { Projects, Rig, RigRepo } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { proposeProject } from './proposal';

/** One found repository as a line: « {nom} ⎇ {branche} · cloné par {siège} · {m} fichiers modifiés », « lu par {siège} »,
 *  « créé par {siège} · pas encore de dépôt distant ». */
function describe(r: RigRepo, c: ReturnType<typeof useI18n>['t']['rigRepos']): string {
  const how = r.how === 'cloned' ? c.cloned(r.by) : r.how === 'opened' ? c.opened(r.by) : r.how === 'created' ? c.created(r.by) : null;
  return [r.branch ? `${r.name} ${c.branch(r.branch)}` : r.name, how, r.modified > 0 ? c.modified(r.modified) : null,
    r.how === 'created' && !r.remote ? c.noRemote : null].filter((x): x is string => !!x).join(' · ');
}

/** « Dépôts trouvés · n » under an off-project rig's card (spec §8.2, maquette w-2): what the rig cloned or opened, Ledge's proposal
 *  when it has one (« Ranger dans {projet} »), and « Ranger dans un projet… ». Ledge moves nothing by itself. */
export function RigRepos(p: { rig: Rig; projects: Projects; onAdopt(projectId: string): void; onChoose(): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.rigRepos;
  const proposal = proposeProject(p.rig, p.projects);
  const project = proposal ? p.projects.projects.find(x => x.id === proposal.projectId) : undefined;
  return (
    <section className="rc-repos" aria-label={c.title(p.rig.repos.length)}>
      <header className="rc-repos-head">
        <strong>{c.title(p.rig.repos.length)}</strong>
        <span className="muted">{c.sub}</span>
        <span className="st-fill" />
        <button type="button" className="st-qa" onClick={p.onChoose}>{c.choose}</button>
      </header>
      {p.rig.repos.length === 0
        ? <p className="muted rc-repos-none">{c.none}</p>
        : <ul className="rc-repo-list">{p.rig.repos.map(r => <li key={r.path} className="rc-repo" title={r.path}>{describe(r, c)}</li>)}</ul>}
      {proposal && project && (
        <p className="rc-propose" role="note">
          <span>{(proposal.why === 'only-modified' ? c.proposeOnly : c.proposeName)(p.rig.name, project.name)}</span>
          <button type="button" className="st-qa" onClick={() => p.onAdopt(project.id)}>{c.fileIn(project.name)}</button>
        </p>
      )}
    </section>
  );
}
