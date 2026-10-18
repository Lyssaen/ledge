import { useEffect, useMemo, useState, type JSX } from 'react';
import { proposeProjects, type Proposal } from '@ledge/fleet';
import type { Projects as ProjectsState } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { ProjectSwatch } from '../projects/ProjectSwatch';
import { rememberProposal } from '../projects/proposals';
import { useLedgeScan } from '../projects/useLedgeScan';
import { useTheme } from '../shell/theme';
import type { SettingsContext } from './SettingsPage';

const NO_STATE: ProjectsState = { projects: [], rules: [] };
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
/** What an ignored card is remembered by: its target project or its name (the pid changes with the repositories left). */
const keyOf = (p: Proposal) => p.targetId !== undefined ? `#${p.targetId}` : `=${p.name}`;

/** « Laisser Ledge organiser » (settings.tsx, Projects, lot 11): one scan of the machines on demand (useLedgeScan), then a card per
 *  proposal of `proposeProjects`. The proposals are computed from the last scan and the projects as they are now, so a project created
 *  meanwhile (its broadcast) drops its card and its repositories from the others without scanning again. « Review… » only remembers
 *  the proposal and opens the editor: nothing is written from here. */
export function Suggestions({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.projects.suggest;
  const l = t.projects.ledge;
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { client, machines, sessions, dispatch } = ctx;
  const scan = useLedgeScan(client, machines);
  const state = ctx.projects ?? NO_STATE;
  const [ignored, setIgnored] = useState<string[]>([]);
  const labelOf = (id: string) => machines.find(m => m.id === id)?.label ?? id;

  const proposals = useMemo(() => scan.status === 'done' ? proposeProjects({ projects: state, scans: scan.scans, sessions }) : [], [scan.status, scan.scans, state, sessions]);
  const shown = proposals.filter(p => !ignored.includes(keyOf(p)));
  // Stays on screen until the next run; a run in progress is cancelled with the page.
  useEffect(() => scan.cancel, [scan.cancel]);
  const run = () => { setIgnored([]); scan.start(); };
  const review = (p: Proposal) => dispatch({ type: 'modal', modal: { kind: 'project', proposal: rememberProposal(p) } });
  // Said after the scan too: the machines skipped, and those whose walk was cut short (« · parcours limité »).
  const told = scan.steps.filter(s => (s.state === 'done' ? s.truncated : s.state !== 'waiting'));

  return (
    <section className="set-card ledge-suggest" aria-labelledby="ledge-suggest-title">
      <div className="ledge-suggest-head">
        <ResidentMascot size={40} theme={theme} paused={ctx.paused || scan.status !== 'scanning'} reducedMotion={reduced} />
        <div><h2 id="ledge-suggest-title">{c.title}</h2><p className="set-hint">{c.hint}</p></div>
        {scan.status !== 'scanning' && <Button variant={scan.status === 'done' ? 'ghost' : 'primary'} size="sm" onClick={run}>{scan.status === 'done' ? l.again : c.ask}</Button>}
      </div>
      {scan.status === 'scanning' && (
        <div className="ledge-suggest-scan" role="status">
          <span className="ledge-spin"><Icon d={ICONS.refresh.d} size={14} /></span>
          <span>{l.scanning(scan.steps.filter(s => s.state !== 'offline').map(s => s.label))}
            {scan.steps.map(s => <small key={s.machine} className="ledge-suggest-step">{l.step(s)}</small>)}</span>
        </div>
      )}
      {scan.status === 'done' && (
        <div className="ledge-suggest-list" role="status">
          {shown.length > 0 ? shown.map(p => (
            <article key={keyOf(p)} className="suggest-card" aria-label={c.card(p.name)}>
              <ProjectSwatch project={p} />
              <div>
                <strong>{p.targetId !== undefined ? c.complete(p.name) : p.name}</strong>
                <span className="set-hint">{l.summary(p.summary)}</span>
                <span className="repo-chips">
                  {p.repos.map(r => <span key={`${r.machine}\n${r.path}`} className="set-tag" title={t.projects.why(r.why)}>{basename(r.path)} · {labelOf(r.machine)}</span>)}
                  {p.file.map(id => <span key={id} className="set-tag ok">{sessions.find(s => s.id === id)?.name ?? id}</span>)}
                </span>
              </div>
              <div className="suggest-actions">
                <Button size="sm" variant="primary" onClick={() => review(p)}>{p.targetId !== undefined ? c.reviewAdd : c.reviewCreate}</Button>
                <Button size="sm" variant="ghost" onClick={() => setIgnored(i => [...i, keyOf(p)])}>{c.ignore}</Button>
              </div>
            </article>
          )) : <p className="set-hint">{scan.scans.some(s => s.status === 'ok') ? (proposals.length > 0 ? c.allIgnored : c.empty) : l.unscanned}</p>}
          {told.map(s => <p key={s.machine} className="set-hint ledge-suggest-step">{l.step(s)}</p>)}
        </div>
      )}
    </section>
  );
}
