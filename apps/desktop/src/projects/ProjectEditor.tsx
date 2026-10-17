import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import { proposeFor, proposeProjects, withoutProject, type DaemonClient, type Fleet, type MachineState, type Proposal } from '@ledge/fleet';
import { normalizePath, PROJECT_COLORS, type Projects, type Repo, type RepoInfo, type Session } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { ruleFor } from '../atelier/filing';
import { isUp } from '../launch/model';
import { useRepoInfo } from '../launch/useRepoInfo';
import { SessionBot } from '../shell/SessionBot';
import { afterSave, alsoIn, applyProposal, COLOR_ORDER, deletion, draftProblem, keptRepos, removed, repoKey, saved, sameDraft, type ProjectDraft } from './draft';
import { FolderPicker } from './FolderPicker';
import type { EditorPhase } from './ProjectDialog';
import { ProjectSwatch } from './ProjectSwatch';
import { useLedgeScan } from './useLedgeScan';
import { useProjectSave } from './useProjectSave';

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path;
/** How long the scan's finished steps stay in view before the proposal replaces them. */
const SETTLE_MS = 400;
/** « Demander à Ledge »'s sparkles (the mockup's). */
const SPARKLES = ['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'];
type Known = { exists: boolean; branch: string | null };
const SLOT = '\u0000';
/** A translated sentence with `name` in bold where its slot stands: the sentence is written around a mark, never searched for the name
 *  (which may also be one of its words). */
const emphasis = (sentence: (slot: string) => string, name: string): ReactNode => (
  <>{sentence(SLOT).split(SLOT).map((part, i) => <Fragment key={i}>{i > 0 && <strong>{name}</strong>}{part}</Fragment>)}</>
);

/** One machine's saved repositories, inspected (useRepoInfo, lot 7): the answer goes up to the editor. */
function Inspect({ client, machine, paths, onInfos }: { client: DaemonClient; machine: string; paths: readonly string[]; onInfos(machine: string, infos: ReadonlyMap<string, RepoInfo>): void }): null {
  const infos = useRepoInfo(client, machine, paths);
  const report = useRef(onInfos);
  report.current = onInfos;
  useEffect(() => { if (infos.size > 0) report.current(machine, infos); }, [machine, infos]);
  return null;
}

/** The mockup's ProjectEditor: the name, the colour, the description, the working repositories with their machine and branch (added
 *  from the folder browser or a typed path), the agents to file too. Saving sends the whole state and waits for the daemon's broadcast
 *  that holds it: nothing changes before, and a refusal or a silence is said here, the values kept.
 *  « Laisser Ledge faire » / « Demander à Ledge » (lot 11): Ledge scans the machines step by step (useLedgeScan), then `proposeFor`
 *  fills the draft: its repositories checked, each with its reason, its sessions to file checked; a proposal on an existing project is
 *  « Ajouter à » it. « Annuler » during the scan goes back to the form as it was. Nothing is written before the main button. */
export function ProjectEditor(p: {
  mode: 'new' | 'edit'; initial: ProjectDraft; projects: Projects; sessions: readonly Session[]; machines: readonly MachineState[];
  /** A proposal opened by the navigation (its draft is `initial`). */
  proposal?: Proposal | undefined; paused?: boolean; onPhase?(phase: EditorPhase): void;
  client: DaemonClient; fleet: Pick<Fleet, 'setProjects'>; projectIdOf(s: Session): string | null; onClose(): void;
  onSaved(id: string, created: boolean, filed: Session[]): void;
  /** The deletion view (« Supprimer le projet », edit mode only): the dialog titles it, hence held there. */
  deleting: boolean; onDeleting(on: boolean): void;
  /** A deletion the daemon confirmed: the project (its name as it was), where its agents went (`moveTo`, or null: no project), how many. */
  onDeleted(id: string, name: string, moveTo: string | null, agents: number): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.projects;
  const { machines, projects } = p;
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const [d, setD] = useState<ProjectDraft>(p.initial);
  // Ledge: the proposal under way (its repositories carry their box in `d.proposed`), the scan's view, « nothing free ».
  const [proposal, setProposal] = useState<Proposal | null>(p.proposal ?? null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<string[]>([]);
  const [nothing, setNothing] = useState(false);
  const scan = useLedgeScan(p.client, machines);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The draft now, for a confirmation that comes in an effect: closing on it would drop what was edited since the send.
  const draftNow = useRef(d);
  draftNow.current = d;
  // « new » until the daemon has confirmed the project: a confirmation the editor stays open after (edited since) makes it an edit.
  const [mode, setMode] = useState(p.mode);
  const [tried, setTried] = useState(false);
  // A new project without repository opens on the folder browser.
  const [adding, setAdding] = useState(p.mode === 'new' && p.initial.repos.length === 0);
  // What is known of each repository (by machine and path): from the browser when added, from repos.inspect for the saved ones.
  const [known, setKnown] = useState<ReadonlyMap<string, Known>>(() => new Map());
  const { state, confirming, send, reset } = useProjectSave(p.fleet, projects);
  const nameRef = useRef<HTMLInputElement>(null);
  // Deleting: where its agents go (null: « Sans projet »). Entering the view focuses that choice; leaving it, « Supprimer le projet ».
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const moveRef = useRef<HTMLInputElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const entered = useRef(p.deleting);
  // Opening: the name, or where its agents go when the dialog opens on the deletion view.
  useEffect(() => { (entered.current ? moveRef : nameRef).current?.focus(); }, []);
  useEffect(() => {
    if (entered.current === p.deleting) return;
    entered.current = p.deleting;
    (p.deleting ? moveRef : deleteRef).current?.focus();
  }, [p.deleting]);
  // The confirmation comes in an effect after the broadcast's render: it reaches the props of that render.
  const latest = useRef(p);
  latest.current = p;
  const ids = useId();

  const runLedge = () => {
    setNothing(false);
    setScanned(machines.filter(isUp).map(m => m.label));
    scan.start();
    setScanning(true);
  };
  const cancelScan = () => { scan.cancel(); setScanning(false); };
  // Every machine settled: the finished steps stay a moment, then the proposal fills the draft (or « nothing free » is said).
  const { status: scanStatus, scans, cancel: resetScan } = scan;
  useEffect(() => {
    if (!scanning || scanStatus !== 'done') return;
    const timer = setTimeout(() => {
      const { projects: state, sessions } = latest.current;
      const now = draftNow.current;
      const input = { projects: state, scans, sessions };
      const found = proposeFor({ ...(now.id !== undefined ? { id: now.id } : {}), name: now.name, file: now.file }, proposeProjects(input), input);
      resetScan();
      setScanning(false);
      if (!found) { setNothing(true); return; }
      setD(applyProposal(now, found, state));
      setProposal(found);
      setAdding(false);
      // The branches the scan found, for the proposed repositories.
      setKnown(prev => {
        const next = new Map(prev);
        for (const sc of scans) for (const r of sc.repos) next.set(repoKey(sc.machine, r.path), { exists: true, branch: r.branch });
        return next;
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [scanning, scanStatus, scans, resetScan]);
  // Entering the scan, « Annuler » takes the focus; leaving it, the name.
  const wasScanning = useRef(false);
  useEffect(() => {
    if (wasScanning.current === scanning) return;
    wasScanning.current = scanning;
    (scanning ? cancelRef : nameRef).current?.focus();
  }, [scanning]);
  // The dialog's title follows: the scan, a proposal (on an existing project: « pour X »), the form.
  const targetName = proposal && d.id !== undefined ? (projects.projects.find(x => x.id === d.id)?.name ?? d.name) : null;
  const phaseKey = scanning ? 'scan' : proposal ? `proposal\n${targetName ?? ''}` : 'form';
  const report = useRef(p.onPhase);
  report.current = p.onPhase;
  useEffect(() => {
    report.current?.(phaseKey === 'scan' ? { kind: 'scan' } : phaseKey === 'form' ? { kind: 'form' } : { kind: 'proposal', target: targetName });
  }, [phaseKey, targetName]);

  const machineOf = (id: string) => machines.find(m => m.id === id);
  const labelOf = (id: string) => machineOf(id)?.label ?? id;
  // The saved repositories, by machine online: one inspection each (a machine offline would answer « not found » for every path).
  const groups = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const r of p.initial.repos) {
      const m = machines.find(x => x.id === r.machine);
      if (m && isUp(m)) by.set(r.machine, [...(by.get(r.machine) ?? []), r.path]);
    }
    return [...by];
  }, [p.initial.repos, machines]);
  const onInfos = useCallback((machine: string, infos: ReadonlyMap<string, RepoInfo>) => setKnown(prev => {
    const next = new Map(prev);
    for (const [path, info] of infos) next.set(repoKey(machine, path), { exists: info.exists, branch: info.branch });
    return next;
  }), []);

  const set = (patch: Partial<ProjectDraft>) => setD(x => ({ ...x, ...patch }));
  // A repository removed: the focus goes to the next row's « Remove », else the previous one's, else « Ajouter un dépôt »
  // (the typed path while the browser is open).
  const reposRef = useRef<HTMLElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<number | null>(null);
  const removeRepo = (i: number) => {
    refocus.current = i;
    setD(x => {
      const gone = x.repos[i];
      if (!gone || !x.proposed) return { ...x, repos: x.repos.filter((_, j) => j !== i) };
      const { [repoKey(gone.machine, gone.path)]: _dropped, ...proposed } = x.proposed;
      return { ...x, repos: x.repos.filter((_, j) => j !== i), proposed };
    });
  };
  const keep = (machine: string, path: string, checked: boolean) => setD(x => {
    const k = repoKey(machine, path);
    const was = x.proposed?.[k];
    return was ? { ...x, proposed: { ...x.proposed, [k]: { ...was, checked } } } : x;
  });
  useEffect(() => {
    const i = refocus.current;
    if (i === null) return;
    refocus.current = null;
    const rows = reposRef.current?.querySelectorAll<HTMLElement>('.pe-repo-remove') ?? [];
    (rows[i] ?? rows[i - 1] ?? addRef.current ?? reposRef.current?.querySelector<HTMLElement>('.picker-typed input'))?.focus();
  }, [d.repos]);
  const taken = (machine: string, path: string) => d.repos.some(r => r.machine === machine && normalizePath(r.path) === path);
  // A repository belongs to one project: the browser flags a folder another project has (« Déjà dans {p} »).
  const ownerOf = (machine: string, path: string) => alsoIn({ machine, path }, d, projects)?.name ?? null;
  const onAdd = ({ branch, ...repo }: Repo & { branch: string | null }) => {
    setD(x => ({ ...x, repos: [...x.repos, repo] }));
    setKnown(prev => new Map(prev).set(repoKey(repo.machine, repo.path), { exists: true, branch }));
  };
  // « Ranger aussi »: the sessions the editor was opened to file (« Ranger dans… › Nouveau projet… ») or Ledge proposes, still listed.
  const candidates = [...new Set([...p.initial.file, ...(proposal?.file ?? [])])].map(id => p.sessions.find(s => s.id === id)).filter((s): s is Session => s !== undefined);

  const saving = state.status === 'saving';
  // While saving, and on the render of the broadcast that confirms (which already holds the project, its name and its repositories),
  // the draft is not checked against a state that contains it.
  const problem = saving || confirming ? null : draftProblem(d, projects);
  const nameProblem = problem && (problem.code === 'name_empty' || problem.code === 'name_taken') ? c.problems[problem.code] : null;
  const problemText = !problem ? null
    : problem.code === 'repo_taken' ? c.problems.repo_taken(projects.projects.find(x => x.id === problem.project)?.name ?? problem.project)
    : c.problems[problem.code];
  const save = () => {
    setTried(true);
    if (problem) { if (nameProblem) nameRef.current?.focus(); return; }
    if (saving) return;
    const { next, id } = afterSave(projects, d, p.sessions);
    const sent = next.projects.find(x => x.id === id)!;
    const filed = p.sessions.filter(s => d.file.includes(s.id));
    const rules = filed.map(s => ruleFor(s, id));
    // « Ajouter à » an existing project from a new draft is no creation.
    const created = mode === 'new' && d.id === undefined;
    const sentDraft = d;
    send(next,
      st => saved(st, sent) && rules.every(r => st.rules.some(x => x.machine === r.machine && x.path === r.path && x.project === r.project)),
      () => {
        // Edited since the send (after a timeout, say): the project exists as sent; the editor stays open on it, the newer values kept.
        if (!sameDraft(draftNow.current, sentDraft)) { setD(x => ({ ...x, id })); setMode('edit'); return; }
        latest.current.onSaved(id, created, filed);
      });
  };
  // Only Ctrl / ⌘ ↵ and the main button save: a plain Enter in a field or on a radio would submit the form implicitly.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // The deletion is only ever confirmed by its own button.
    if (p.deleting) { if (e.ctrlKey || e.metaKey || e.target instanceof HTMLInputElement) e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); save(); }
    else if (e.target instanceof HTMLInputElement) e.preventDefault();
  };

  // The deletion: what becomes of the agents at its table and of its remembered folders. While the deletion is sent, the view
  // stays as it was when sent (the broadcast that confirms it no longer holds the project, and the dialog closes right after).
  const current = projects.projects.find(x => x.id === d.id);
  const others = projects.projects.filter(x => x.id !== d.id);
  const target = moveTo === null ? null : others.find(x => x.id === moveTo) ?? others[0] ?? null;
  const live = current ? { project: current, target, ...deletion(projects, current.id, p.sessions, p.projectIdOf) } : null;
  const shown = useRef(live);
  if (!saving) shown.current = live;
  const doomed = saving ? shown.current : live;
  const toggle = (on: boolean) => { if (saving) return; reset(); setMoveTo(null); p.onDeleting(on); };
  const remove = () => {
    if (saving || !live) return;
    const { project, agents } = live;
    const to = live.target?.id ?? null;
    send(withoutProject(projects, project.id, to), st => removed(st, project.id), () => latest.current.onDeleted(project.id, project.name, to, agents.length));
  };

  const showName = tried && nameProblem;
  const kept = keptRepos(d);
  const machinesShown = [...new Set(kept.map(r => labelOf(r.machine)))].join(', ');

  if (p.deleting) {
    const dl = c.delete;
    const n = doomed?.agents.length ?? 0;
    const names = doomed ? doomed.agents.slice(0, 4).map(s => s.name).join(', ') + (n > 4 ? '…' : '') : '';
    const rules = doomed?.rules ?? 0;
    const to = doomed?.target ?? null;
    const name = doomed?.project.name ?? d.name;
    const repos = doomed?.project.repos.length ?? 0;
    return (
      <form className="pe" onSubmit={e => { e.preventDefault(); remove(); }} onKeyDown={onKeyDown}>
        <div className="pe-body">
          <div className="pe-delete-box">
            {/* The alert is the explanation only, not the choice below it. */}
            <div className="pe-delete" role="alert">
              <p>{emphasis(x => dl.lead(x), name)}</p>
              <ul>
                <li>{n === 0 ? dl.noAgents : <>{dl.agents(n, names)} {to ? emphasis(x => dl.toProject(n, x), to.name) : dl.toNone(n)}</>}</li>
                <li>{rules === 0 ? dl.noRules : `${dl.rules(rules)} ${to ? dl.rulesMove(rules) : dl.rulesForget(rules)}`}</li>
                {repos > 0 && <li>{to ? emphasis(x => dl.reposMove(repos, x), to.name) : dl.reposGone(repos)}</li>}
              </ul>
            </div>
            <fieldset className="pe-move">
              <legend className="composer-label">{dl.their}</legend>
              <label className={`chip ${!to ? 'selected' : ''}`}>
                <input ref={moveRef} type="radio" name={`${ids}-move`} checked={!to} onChange={() => setMoveTo(null)} />{dl.none}
              </label>
              <label className={`chip ${to ? 'selected' : ''} ${others.length === 0 ? 'disabled' : ''}`}>
                <input type="radio" name={`${ids}-move`} checked={!!to} disabled={others.length === 0} onChange={() => setMoveTo(others[0]?.id ?? null)} />{dl.moveTo}
              </label>
              {to && (
                <select aria-label={dl.target} value={to.id} onChange={e => setMoveTo(e.target.value)}>
                  {others.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
            </fieldset>
          </div>
        </div>
        <footer className="composer-footer">
          <span className="spacer" />
          {!live && !saving ? <span className="composer-missing" role="alert">{c.problems.gone}</span>
            : state.status === 'refused' ? <p className="composer-missing" role="alert">{c.refused[state.reason]}</p> : null}
          <Button variant="ghost" onClick={() => toggle(false)}>{c.cancel}</Button>
          <Button variant="primary" type="submit" aria-disabled={!live || saving}>{saving ? c.saving : to ? dl.moveAndDelete : dl.confirm(name)}</Button>
        </footer>
      </form>
    );
  }

  if (scanning) {
    const l = c.ledge;
    return (
      <div className="pe">
        <div className={`pe-scan ${p.paused || reduced ? 'still' : ''}`} role="status" aria-live="polite">
          <span className="pe-scan-mascot">
            <ResidentMascot size={84} theme={theme} paused={p.paused} reducedMotion={reduced} />
            <span className="pe-dots" aria-hidden="true"><i /><i /><i /></span>
          </span>
          <strong>{l.scanning(scanned)}</strong>
          <ul>
            {scan.steps.map(s => (
              <li key={s.machine} className={s.state === 'waiting' ? 'now' : 'done'}>
                {s.state === 'waiting' ? <i className="pe-wait" /> : <Icon d={ICONS.check.d} size={13} />}{l.step(s)}
              </li>
            ))}
            <li className={scanStatus === 'done' ? 'done' : ''}>{scanStatus === 'done' ? <Icon d={ICONS.check.d} size={13} /> : <i className="pe-wait" />}{l.compared}</li>
          </ul>
          <Button ref={cancelRef} variant="ghost" size="sm" onClick={cancelScan}>{c.cancel}</Button>
        </div>
      </div>
    );
  }

  // The offer: a new project with neither name nor proposal. « Demander à Ledge »: once there is a name or a repository, the offer
  // gone (or answered « nothing free »), no proposal under way.
  const fresh = mode === 'new' && !proposal && d.name === '';
  const canAsk = !proposal && (!fresh || nothing) && (d.name.trim() !== '' || d.repos.length > 0);
  return (
    <form className="pe" onSubmit={e => { e.preventDefault(); save(); }} onKeyDown={onKeyDown}>
      {groups.map(([machine, paths]) => <Inspect key={machine} client={p.client} machine={machine} paths={paths} onInfos={onInfos} />)}
      <div className="pe-body">
        {fresh && !nothing && (
          <div className="pe-ledge">
            <ResidentMascot size={44} theme={theme} paused={p.paused} reducedMotion={reduced} />
            <div><strong>{c.ledge.offerTitle}</strong><span>{c.ledge.offerBody}</span></div>
            <Button variant="primary" size="sm" onClick={runLedge}>{c.ledge.offer}</Button>
          </div>
        )}
        {nothing && (
          <div className="pe-proposal" role="status">
            <ResidentMascot size={28} theme={theme} paused={p.paused} reducedMotion={reduced} />
            <div><span>{c.ledge.nothing}</span></div>
          </div>
        )}
        {proposal && (
          <div className="pe-proposal">
            <ResidentMascot size={28} theme={theme} paused={p.paused} reducedMotion={reduced} />
            <div><strong>{c.ledge.proposes}</strong><span>{c.ledge.summary(proposal.summary)} {c.ledge.check}</span></div>
          </div>
        )}
        <div className="pe-identity">
          <div className="pe-field">
            <label className="composer-label" htmlFor={`${ids}-name`}>{c.name}</label>
            <input id={`${ids}-name`} ref={nameRef} value={d.name} maxLength={60} placeholder={c.namePlaceholder} onChange={e => set({ name: e.target.value })}
              aria-invalid={!!showName} aria-describedby={showName ? `${ids}-name-error` : undefined} />
            {showName && <span id={`${ids}-name-error`} className="set-error" role="alert">{nameProblem}</span>}
          </div>
          <fieldset className="pe-colors">
            <legend className="composer-label">{c.color}</legend>
            {COLOR_ORDER.map(k => (
              <label key={k} title={c.colors[k]} className={d.color === k ? 'on' : ''} style={{ '--c': PROJECT_COLORS[k] } as CSSProperties}>
                <input type="radio" name="pe-color" aria-label={c.colors[k]} checked={d.color === k} onChange={() => set({ color: k })} />
              </label>
            ))}
          </fieldset>
        </div>
        <div className="pe-field">
          <label className="composer-label" htmlFor={`${ids}-description`}>{c.description} <small>{c.optional}</small></label>
          <input id={`${ids}-description`} value={d.description} maxLength={120} placeholder={c.descriptionPlaceholder} onChange={e => set({ description: e.target.value })} />
        </div>
        <section ref={reposRef} className="pe-repos" aria-labelledby={`${ids}-repos`}>
          <div className="pe-repos-head">
            <span className="composer-label" id={`${ids}-repos`}>{c.repos(kept.length)}</span>
            {canAsk && <Button size="sm" variant="ghost" onClick={runLedge}><Icon d={SPARKLES} size={14} />{c.ledge.ask}</Button>}
          </div>
          {d.repos.length > 0 ? (
            <ul className="pe-repo-list">
              {d.repos.map((r, i) => {
                const m = machineOf(r.machine);
                const online = !!m && isUp(m);
                const label = labelOf(r.machine);
                const info = known.get(repoKey(r.machine, r.path));
                const owner = saving || confirming ? undefined : alsoIn(r, d, projects);
                const offered = d.proposed?.[repoKey(r.machine, r.path)];
                return (
                  <li key={`${r.machine}:${r.path}:${i}`} className={offered && !offered.checked ? 'off' : undefined}>
                    {offered && (
                      <input type="checkbox" checked={offered.checked} aria-label={c.ledge.keep(baseName(r.path), label)} onChange={e => keep(r.machine, r.path, e.target.checked)} />
                    )}
                    <span className="pe-repo-main">
                      <span className="pe-repo-line">
                        <strong>{baseName(r.path)}</strong>
                        <span className="pe-machine"><i className={`machine-dot ${online ? '' : 'off'}`} />{label}</span>
                        {!online ? <span className="pe-branch">{c.offline}</span>
                          : info === undefined ? null
                          : !info.exists ? <small className="set-warn">{c.notFound}</small>
                          : info.branch ? <span className="pe-branch mono" title={c.branchTitle}>⎇ {info.branch}</span>
                          : <span className="pe-branch">{c.noGit}</span>}
                      </span>
                      <code className="mono">{r.path}</code>
                      {offered && <small className="pe-why"><span className="pe-why-mark">{c.ledge.why}</span>{c.why(offered.why)}</small>}
                      {/* A repository belongs to one project only: said before saving, and nothing is sent while it stands. */}
                      {owner && <small className="set-error">{c.problems.repo_taken(owner.name)}</small>}
                    </span>
                    <Button size="icon" variant="ghost" className="pe-repo-remove" aria-label={c.remove(baseName(r.path), label)} onClick={() => removeRepo(i)}>
                      <Icon d={ICONS.close.d} size={14} />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : !adding && <p className="pe-empty">{c.empty}</p>}
          {candidates.length > 0 && (
            <div className="pe-agents">
              <span className="composer-label">{c.fileToo}</span>
              {candidates.map(s => {
                const on = d.file.includes(s.id);
                return (
                  <label key={s.id} className={`chip ${on ? 'selected' : ''}`}>
                    <input type="checkbox" checked={on} onChange={e => set({ file: e.target.checked ? [...d.file, s.id] : d.file.filter(x => x !== s.id) })} />
                    <span className="pe-agent-bot" aria-hidden="true"><SessionBot session={s} size={18} paused /></span>{s.name}
                  </label>
                );
              })}
            </div>
          )}
          {adding ? <FolderPicker client={p.client} machines={machines} taken={taken} owner={ownerOf} onAdd={onAdd} />
            : <Button ref={addRef} size="sm" variant="outline" onClick={() => setAdding(true)}><Icon d={ICONS.plus.d} size={14} />{c.addRepo}</Button>}
        </section>
      </div>
      <footer className="composer-footer">
        {p.mode === 'edit' && !proposal && (
          <Button ref={deleteRef} variant="ghost" className="pe-delete-btn" aria-disabled={saving} onClick={() => toggle(true)}>{c.deleteProject}</Button>
        )}
        <span className="composer-preview">
          <ProjectSwatch project={{ color: d.color }} />
          <span>
            <span className="preview-line"><strong>{d.name.trim() || c.newName}</strong></span>
            <small>{c.preview(kept.length, machinesShown)}{p.mode === 'new' && d.id === undefined ? c.firstSession : ''}</small>
          </span>
        </span>
        {tried && problemText ? <span className="composer-missing" role={nameProblem ? undefined : 'alert'}>{problemText}</span>
          : state.status === 'refused' ? <p className="composer-missing" role="alert">{c.refused[state.reason]}</p> : null}
        <Button variant="ghost" onClick={p.onClose}>{c.cancel}</Button>
        <Button variant="primary" type="submit" aria-disabled={!!problem || saving}>
          {saving ? c.saving : targetName !== null ? c.ledge.addTo(targetName) : mode === 'new' ? c.create : c.save}<Kbd>Ctrl ↵</Kbd>
        </Button>
      </footer>
    </form>
  );
}
