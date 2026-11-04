import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import type { MachineState } from '@ledge/fleet';
import { BROADCAST_SESSIONS_MAX, type HumanAsk, type Project, type Projects, type Session } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon } from '@ledge/ui/ui/icons';
import type { Filing } from '../../atelier/filing';
import type { Decisions } from '../../fleet/decisions';
import { useI18n } from '../../i18n/lang';
import type { Wait } from '../../list/time';
import type { ContextMenuState } from '../../manage/useContextMenu';
import type { SessionActions } from '../../manage/useSessionActions';
import { useFeatures } from '../../native/mode';
import { useMotionPreferences } from '../../motionPreferences';
import { activeCount } from '../../nav/agents';
import type { NavAction, NavState } from '../../nav/state';
import { useStored } from '../../state/useStored';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { useTheme } from '../theme';
import { Archives } from './Archives';
import { Attention } from './Attention';
import { attentionOf, eyeGroups, treeModel } from './model';
import { loadSidebarPrefs, saveSidebarPrefs } from './prefs';
import { Tree } from './Tree';
import { RigGroups } from './RigGroups';
import { SidebarMenuHost } from './SidebarMenus';
import { setGrouping, useGrouping } from '../../openrig/grouping';
import type { SidebarOpenRig } from '../../openrig/sidebarState';
import { closedLedgeTasks, nearLimit, openDecisions, type TasksApi } from '../../tasks/useTasksApi';

/** The explorer shell: Ledge's entry, Atelier / OpenRig, Projets / Rigs, Your turn, the project tree or the rigs, Archives, then the foot. */
export function Sidebar(p: {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; archived: readonly Session[];
  machines: readonly MachineState[]; projects: Projects | null;
  /** The machines whose daemon is updating (#48): their restart is expected. */
  updating?: ReadonlySet<string>;
  order: readonly Session[]; projectIdOf: (s: Session) => string | null;
  filing: Filing; actions: SessionActions; decisions: Decisions;
  waits: ReadonlyMap<string, Wait>;
  /** The window's one context menu: a session's (rendered by the app) or one of the sidebar's own (rendered here). While one shows, Échap is its own. */
  menu: ContextMenuState;
  /** A short notice (the toast): « Tout restaurer » says what it did once. */
  notify(text: string): void;
  /** The local daemon takes a broadcast: the ✉ of a project row and the Ctrl/⌘ + click selection are offered. */
  broadcast?: boolean;
  /** Bumped by each broadcast that reached someone: the selection is kept until then, emptied then. */
  broadcastSent?: number;
  /** OpenRig across the followed machines: the toggle, the Rigs view's empty states and the kernel's state. */
  openrig?: SidebarOpenRig;
  onTerminal(s: Session): void;
  revealArchives: number; revealCurrent: number;
  /** Ledge's entry's live line (ledge home spec §2.1): the closed tasks Ledge gave not put away. */
  ledge?: { closedTasks: number };
  /** Ledge's tasks: « À toi »'s decisions and closed Ledge tasks (roles spec §3.7), and the sessions near their context limit. */
  tasksApi?: TasksApi;
  /** « À toi »: what OpenRig's rigs ask the person; « Voir » opens the home on the card. */
  asks?: readonly HumanAsk[];
  onSeeAsk?(id: string): void;
}): JSX.Element {
  const { t } = useI18n();
  // Native mode's first round: no Ledge chat, no Atelier, no tasks between sessions (spec 2026-11-03 §1).
  const f = useFeatures();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const keysTip = useId();
  const [prefs, setPrefs] = useStored(loadSidebarPrefs, saveSidebarPrefs);
  // The sessions picked with Ctrl/⌘ + click, in the order picked: from two, the bar below writes to them (broadcast spec).
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  // What is folded in the tree and whether the Archives are open: here, so the context menus fold too.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [archivesOpen, setArchivesOpen] = useState(false);
  const pick = (id: string) => setPicked(was => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else if (next.size < BROADCAST_SESSIONS_MAX) next.add(id);
    return next;
  });
  // A session gone from the list is no longer picked.
  const pickedIds = [...picked].filter(id => p.sessions.some(s => s.id === id));
  // Sent: the selection has done its job.
  useEffect(() => { if (p.broadcastSent) setPicked(new Set()); }, [p.broadcastSent]);
  const { place } = p.nav;
  const base = place.kind === 'settings' ? place.back : place;
  const current = base.kind === 'session' ? base.id : null;
  // OpenRig's seats have their own groups (Rigs, Kernel), away from the projects.
  const grouping = useGrouping();
  const hasRigs = p.sessions.some(s => s.rig && s.state !== 'exited');
  // The toggle shows once OpenRig is installed on a followed machine, even without a seat (its empty states live in « Rigs »).
  const offerRigs = hasRigs || p.openrig?.installed === true;
  // « Projets » or « Rigs »: one or the other (while OpenRig is nowhere, the projects).
  const byRig = offerRigs && grouping === 'rigs';
  // An OpenRig seat is never in the projects' tree: the « Rigs » view shows it (« À toi » too, when it waits).
  const groups = useMemo(() => treeModel(p.sessions.filter(s => !s.rig), p.projects, p.projectIdOf), [p.sessions, p.projects, p.projectIdOf]);
  // The eye (docs/mockups/ledge-projects-eye.html): pressed, the projects with a live agent; released, every project.
  const { shown: shownGroups, hidden: hiddenProjects } = useMemo(() => eyeGroups(groups, prefs.hideDone, { dragging: !!p.filing.dragging, filter: base.project }),
    [groups, prefs.hideDone, p.filing.dragging, base.project]);
  const attn = useMemo(() => attentionOf(p.sessions, p.waits), [p.sessions, p.waits]);
  // Sessions near their context limit, less those put away with « Plus tard » (context handover spec §3.2).
  const nearAll = useMemo(() => nearLimit(p.sessions, p.tasksApi?.later, p.tasksApi?.near), [p.sessions, p.tasksApi?.later, p.tasksApi?.near]);
  const near = f.tasks ? nearAll : [];
  const decisions = useMemo(() => (p.tasksApi && f.tasks ? openDecisions(p.tasksApi.tasks) : []), [p.tasksApi, f.tasks]);
  const root = useRef<HTMLElement>(null);
  const keys = useRef({ attn, current, dispatch: p.dispatch, quiet: false });
  keys.current = { attn, current, dispatch: p.dispatch, quiet: p.nav.modal !== null || p.nav.chat || p.actions.pending !== null || p.menu.menu !== null };
  // Alt ↓ opens the next waiting session. Ctrl ⇧ E focuses its tree row, or the first row when none is open.
  // A dialog, a confirmation, the chat, or a text field already owns the key (same rule as the window shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const typing = active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable);
      if (typing || keys.current.quiet) return;
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        const nodes = [...(root.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])];
        (nodes.find(el => el.dataset.treeKey === keys.current.current) ?? nodes[0])?.focus();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown' && keys.current.attn.length) {
        e.preventDefault();
        const { attn: items, current: open, dispatch } = keys.current;
        const i = items.findIndex(a => a.session.id === open);
        const next = items[(i + 1) % items.length]!;
        dispatch({ type: 'open', id: next.session.id, ...(next.helper ? { helper: next.helper.id } : {}) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Échap empties the selection first, before the window's Escape goes back anywhere (a dialog or a field keeps it).
  const anyPicked = picked.size > 0;
  useEffect(() => {
    if (!anyPicked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || keys.current.quiet) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable)) return;
      e.preventDefault(); e.stopPropagation();
      setPicked(new Set());
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [anyPicked]);
  const projectOf = (s: Session): { id: string; name: string; color: Project['color'] } | null => {
    const id = p.projectIdOf(s);
    const found = id ? p.projects?.projects.find(x => x.id === id) : undefined;
    return found ? { id: found.id, name: found.name, color: found.color } : null;
  };
  const projectName = (s: Session) => projectOf(s)?.name ?? t.side.unassigned;
  const atelierOn = place.kind === 'overview' && place.view === 'atelier';
  const inSettings = place.kind === 'settings';
  const active = activeCount(p.sessions);
  const homeOn = place.kind === 'home';
  return (
    // No webview menu anywhere in the sidebar: a row with a menu opens it, elsewhere a right click does nothing; a text field keeps its own (copy, paste).
    <aside ref={root} className={cls('sidebar st', prefs.dense && 'st-dense')} aria-label={t.side.label}
      onContextMenu={e => { if (!(e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]'))) e.preventDefault(); }}>
      {f.chat && <div className={cls('st-ask', 'st-ledge', (homeOn || p.nav.chat) && 'on')}>
        <button type="button" className="st-ledge-entry" aria-current={homeOn ? 'page' : undefined} aria-label={t.side.ledgeHome} title={t.side.ledgeHome} onClick={() => p.dispatch({ type: 'ledge' })}>
          <span className="st-mascot"><ResidentMascot size={22} theme={theme} paused={p.nav.paused} reducedMotion={reduced} /></span>
          <span className="st-ledge-names">
            <span className="st-ledge-brand">Ledge<span className="brand-dot">.</span></span>
            <small className="st-ledge-line">{t.side.ledgeLine(attn.length + decisions.length + (p.ledge?.closedTasks ?? 0) + near.length + (p.asks?.length ?? 0))}</small>
          </span>
          <Kbd>/</Kbd>
        </button>
      </div>}
      <nav className="st-views" aria-label={t.side.views}>
        {f.atelier && <button type="button" className={atelierOn ? 'on' : undefined} aria-current={atelierOn ? 'page' : undefined} onClick={() => p.dispatch({ type: 'home' })}>
          <Icon d={SHELL_ICONS.grid} size={13} /><span>{t.side.atelier}</span><span className="st-fill" /><small>{t.side.active(active)}</small>
        </button>}
        <button type="button" className={place.kind === 'openrig' ? 'on' : undefined} aria-current={place.kind === 'openrig' ? 'page' : undefined} onClick={() => p.dispatch({ type: 'openrig' })}>
          <Icon d={SHELL_ICONS.rig} size={13} /><span>{t.openrig.side}</span>
        </button>
      </nav>
      {/* Out of the scrolling list, so it keeps the views' width (docs/mockups/ledge-sidebar-tidy.html, point 4). */}
      {offerRigs && (
        <div className="st-grouping" role="radiogroup" aria-label={t.top.grouping}>
          {(['projects', 'rigs'] as const).map(g => <button key={g} type="button" role="radio" aria-checked={grouping === g} title={t.top.groupingHint[g]} onClick={() => setGrouping(g)}>{t.top.groupingBy[g]}</button>)}
        </div>
      )}
      <div className="st-scroll">
        <Attention items={attn} current={current} projectOf={projectOf} paused={p.nav.paused}
          rigAsks={p.asks ?? []} sessions={p.sessions} {...(p.onSeeAsk ? { onSeeAsk: p.onSeeAsk } : {})}
          onOpen={(id, helper, focus) => p.dispatch({ type: 'open', id, ...(helper !== undefined ? { helper } : {}), ...(focus !== undefined ? { focus } : {}) })}
          onDecide={(s, ok) => { p.decisions.decide(s, ok ? 'accept' : 'deny'); }}
          decisions={decisions} answer={p.tasksApi?.answer}
          ledgeTasks={p.tasksApi && f.tasks ? closedLedgeTasks(p.tasksApi.tasks) : []} onSeeTask={id => p.dispatch({ type: 'ledge', tab: 'tasks', task: id })} onDismissTask={id => p.tasksApi?.seen(id)}
          near={near} onHandover={id => { void p.tasksApi?.handover(id); }}
          onLater={id => { const s = p.sessions.find(x => x.id === id); if (s) p.tasksApi?.putLater(s); }}
          onMenu={(id, e) => {
            const host = e.currentTarget instanceof HTMLElement ? e.currentTarget : undefined;
            p.menu.open(id, { x: e.clientX, y: e.clientY }, host ?? null);
          }} />
        {!byRig && <section aria-label={t.side.projects}>
          <Tree groups={shownGroups} closed={closed} onClosed={setClosed} sessions={p.sessions} projects={p.projects} current={current} filter={base.project}
            hideDone={prefs.hideDone} hiddenProjects={hiddenProjects} anySession={groups.some(g => g.branches.some(b => b.sessions.length > 0))} dense={prefs.dense} filing={p.filing} revealCurrent={p.revealCurrent} paused={p.nav.paused}
            onHome={project => p.dispatch({ type: 'home', ...(project !== undefined ? { project } : {}) })}
            onOpen={(id, helper) => p.dispatch({ type: 'open', id, ...(helper !== undefined ? { helper } : {}) })}
            onLaunch={project => p.dispatch({ type: 'modal', modal: { kind: 'launch', ...(project !== undefined ? { project } : {}) } })}
            onBroadcast={p.broadcast ? project => p.dispatch({ type: 'modal', modal: { kind: 'broadcast', to: { project } } }) : undefined}
            picked={picked} onPick={p.broadcast ? pick : undefined}
            onMenu={(target, at, opener) => p.menu.openOn(target, at, opener)}
            onArchive={ids => p.actions.request('archive', ids)} onDelete={ids => p.actions.request('delete', ids)} onTerminal={p.onTerminal}
            onToggleHide={() => setPrefs(v => ({ ...v, hideDone: !v.hideDone }))} onToggleDense={() => setPrefs(v => ({ ...v, dense: !v.dense }))}
            onNewProject={() => p.dispatch({ type: 'modal', modal: { kind: 'project' } })} />
          {p.filing.dragging && <p className="st-help">{t.side.dropHelp(p.filing.dragging.name)}</p>}
        </section>}
        {byRig && <RigGroups sessions={p.sessions} current={current} paused={p.nav.paused} dispatch={p.dispatch} openrig={p.openrig}
          dense={prefs.dense} onToggleDense={() => setPrefs(v => ({ ...v, dense: !v.dense }))} asks={p.asks ?? []}
          onMenu={(id, at, opener) => p.menu.open(id, at, opener)} />}
        <Archives archived={p.archived} current={current} projectName={projectName} reveal={p.revealArchives} open={archivesOpen} onOpenChange={setArchivesOpen}
          project={s => { const found = projectOf(s); return found ? { color: found.color } : null; }}
          onRead={id => p.dispatch({ type: 'open', id })} onRestore={id => p.actions.restore(id)} onResume={id => p.actions.resume(id)}
          onDelete={ids => p.actions.request('delete', ids)} allowed={p.actions.allowed} paused={p.nav.paused}
          onMenu={(target, at, opener) => p.menu.openOn(target, at, opener)} />
      </div>
      <SidebarMenuHost state={p.menu} projects={p.projects} groups={groups} archived={p.archived} actions={p.actions} dispatch={p.dispatch}
        broadcast={!!p.broadcast} closed={closed} onClosed={setClosed} archivesOpen={archivesOpen} onArchivesOpen={setArchivesOpen} notify={p.notify} />
      {p.broadcast && pickedIds.length >= 2 && (
        <div className="st-picked" role="region" aria-label={t.broadcast.picked}>
          <button type="button" className="st-picked-write" onClick={() => p.dispatch({ type: 'modal', modal: { kind: 'broadcast', to: { sessions: pickedIds } } })}>
            <Icon d={SHELL_ICONS.mail} size={13} /><span>{t.broadcast.selection(pickedIds.length)}</span>
          </button>
          <span className="st-fill" />
          <button type="button" className="st-picked-cancel" onClick={() => setPicked(new Set())}>{t.broadcast.cancel}</button>
        </div>
      )}
      <div className="st-foot">
        {p.machines.map(m => {
          // A daemon restarting for its update (#48) is said as such, not offline.
          const updating = p.updating?.has(m.id) === true;
          const offline = m.status === 'unreachable' && !updating;
          const count = p.sessions.filter(s => (s.machineId ?? 'local') === m.id).length;
          return (
            <button key={m.id} type="button" className="st-mach" title={updating ? `${m.label} · ${t.side.daemonUpdating}` : offline ? `${m.label} · ${t.side.offline}` : `${m.label} · ${t.side.agents(count)}`}
              onClick={() => p.dispatch({ type: 'settings', section: 'machines' })}>
              <i className={`machine-dot${offline ? ' off' : updating ? ' updating' : ''}`} />{m.label}{!offline && <small>{count}</small>}
            </button>
          );
        })}
        <span className="st-fill" />
        <span className="st-keys">
          <button type="button" className="st-icon" aria-label={t.side.shortcuts} aria-describedby={keysTip}
            onClick={() => p.dispatch({ type: 'modal', modal: { kind: 'shortcuts' } })}>
            <Icon d={SHELL_ICONS.help} size={15} />
          </button>
          <span className="st-keys-tip" role="tooltip" id={keysTip}>
            {t.shortcuts.rows.map(([keys, action]) => <span key={keys}>{action}<Kbd>{keys}</Kbd></span>)}
          </span>
        </span>
        <button type="button" className={cls('st-icon', inSettings && 'on')} aria-label={t.side.settings} title={`${t.side.settings} · Ctrl ,`} aria-current={inSettings ? 'page' : undefined}
          onClick={() => p.dispatch({ type: 'settings' })}>
          <Icon d={SHELL_ICONS.gear} size={15} />
        </button>
      </div>
    </aside>
  );
}
