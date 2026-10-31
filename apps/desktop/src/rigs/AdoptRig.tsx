import { useId, useState, type JSX } from 'react';
import type { Projects, Rig } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';

/** « Ranger dans un projet… » (spec §8.2): the projects, the proposed one selected, what filing changes (the rig keeps its room and its
 *  files: only its plaque and card say « dans {projet} »), « Ranger » and « Annuler ». */
export function AdoptRig(p: { rig: Rig; projects: Projects; proposed: string | null; onAdopt(projectId: string): void; onCancel(): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.rigRepos;
  const [pick, setPick] = useState<string | null>(() => (p.proposed && p.projects.projects.some(x => x.id === p.proposed) ? p.proposed : null));
  const body = useId();
  const group = useId();
  const chosen = p.projects.projects.find(x => x.id === pick);
  return (
    <Modal title={c.adoptTitle(p.rig.name)} describedBy={body} className="confirm-modal" onClose={p.onCancel}>
      <div className="confirm-content" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); p.onCancel(); } }}>
        {p.projects.projects.length === 0 ? <p className="muted">{c.noProjects}</p> : (
          <fieldset className="adopt-projects">
            <legend className="composer-label">{c.projects}</legend>
            {p.projects.projects.map(x => (
              <label key={x.id} className="adopt-project">
                <input type="radio" name={group} checked={pick === x.id} onChange={() => setPick(x.id)} />
                <span>{x.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        <p id={body} className="muted">{chosen ? c.adoptNote(chosen.name) : c.adoptPick}</p>
        <div className="confirm-actions">
          <Button onClick={p.onCancel}>{c.cancel}</Button>
          <Button variant="primary" disabled={!chosen} onClick={() => { if (chosen) p.onAdopt(chosen.id); }}>{c.adopt}</Button>
        </div>
      </div>
    </Modal>
  );
}
