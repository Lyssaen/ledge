import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import type { FleetAsk, MachineState } from '@ledge/fleet';
import type { Project, Projects, Session } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon } from '@ledge/ui/ui/icons';
import type { Filing } from '../../atelier/filing';
import type { Decisions } from '../../fleet/decisions';
import { useI18n } from '../../i18n/lang';
import type { Wait } from '../../list/time';
import type { SessionActions } from '../../manage/useSessionActions';
import { useMotionPreferences } from '../../motionPreferences';
import { activeCount } from '../../nav/agents';
import type { NavAction, NavState } from '../../nav/state';
import { useStored } from '../../state/useStored';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { useTheme } from '../theme';
import { Archives } from './Archives';
import { Attention } from './Attention';
import { attentionOf, treeModel } from './model';
import { loadSidebarPrefs, saveSidebarPrefs } from './prefs';
import { Tree } from './Tree';
import { nearLimit, type Relief } from '../../session/useRelief';

/** The explorer shell: Session, Ask Ledge, Atelier, Your turn, the project tree, Archives, then the foot. */
export function Sidebar(p: {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; archived: readonly Session[];
  machines: readonly MachineState[]; projects: Projects | null;
  /** The machines whose daemon is updating (#48): their restart is expected. */
  updating?: ReadonlySet<string>;
  order: readonly Session[]; projectIdOf: (s: Session) => string | null;
  filing: Filing; actions: SessionActions; decisions: Decisions;
  waits: ReadonlyMap<string, Wait>;
  menu: { open(id: string, at: { x: number; y: number }, opener?: HTMLElement): void };
  onAsk(text: string): void;
  onTerminal(s: Session): void;
  revealArchives: number; revealCurrent: number;
  /** Handover and « Plus tard » for the sessions near their context limit (« À toi »). */
  relief?: Relief;
  /** The decisions sessions asked of the user (`ledge ask`), shown in « À toi » and counted by Ledge's line. */
  asks?: readonly FleetAsk[];
  onAnswerAsk?(ask: FleetAsk, text: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const keysTip = useId();
  const [ask, setAsk] = useState('');
  const [prefs, setPrefs] = useStored(loadSidebarPrefs, saveSidebarPrefs);
  const { place } = p.nav;
  const base = place.kind === 'settings' ? place.back : place;
  const current = base.kind === 'session' ? base.id : null;
  const groups = useMemo(() => treeModel(p.sessions, p.projects, p.projectIdOf), [p.sessions, p.projects, p.projectIdOf]);
  const attn = useMemo(() => attentionOf(p.sessions, p.waits), [p.sessions, p.waits]);
  // Sessions near their context limit, less those put away with « Plus tard » (context handover spec §3.2).
  const near = useMemo(() => nearLimit(p.sessions, p.relief?.later, p.relief?.near), [p.sessions, p.relief?.later, p.relief?.near]);
  const root = useRef<HTMLElement>(null);
  const keys = useRef({ attn, current, dispatch: p.dispatch, quiet: false });
  keys.current = { attn, current, dispatch: p.dispatch, quiet: p.nav.modal !== null || p.nav.chat || p.actions.pending !== null };
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
  const projectOf = (s: Session): { id: string; name: string; color: Project['color'] } | null => {
    const id = p.projectIdOf(s);
    const found = id ? p.projects?.projects.find(x => x.id === id) : undefined;
    return found ? { id: found.id, name: found.name, color: found.color } : null;
  };
  const projectName = (s: Session) => projectOf(s)?.name ?? t.side.unassigned;
  const atelierOn = place.kind === 'overview' && place.view === 'atelier';
  const inSettings = place.kind === 'settings';
  const active = activeCount(p.sessions);
  const submitAsk = () => {
    const q = ask.trim();
    p.dispatch({ type: 'ledge', tab: 'conversation' });
    if (q) { p.onAsk(q); setAsk(''); }
  };
  const homeOn = place.kind === 'home';
  return (
    <aside ref={root} className={cls('sidebar st', prefs.dense && 'st-dense')} aria-label={t.side.label}>
      <div className={cls('st-ask', 'st-ledge', (homeOn || p.nav.chat) && 'on')}>
        <button type="button" className="st-ledge-entry" aria-current={homeOn ? 'page' : undefined} aria-label={t.side.ledgeHome} title={t.side.ledgeHome} onClick={() => p.dispatch({ type: 'ledge' })}>
          <span className="st-mascot"><ResidentMascot size={22} theme={theme} paused={p.nav.paused} reducedMotion={reduced} /></span>
          <span className="st-ledge-names">
            <span className="st-ledge-brand">Ledge<span className="brand-dot">.</span></span>
            <small className="st-ledge-line">{t.side.ledgeLine(attn.length + (p.asks?.length ?? 0) + near.length)}</small>
          </span>
          <Kbd>/</Kbd>
        </button>
        <input data-ask-input="" type="text" aria-label={t.side.askLedge} placeholder={t.side.askPlaceholder} value={ask} onChange={e => setAsk(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitAsk(); } else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }} />
      </div>
      <nav className="st-views" aria-label={t.side.views}>
        <button type="button" className={atelierOn ? 'on' : undefined} aria-current={atelierOn ? 'page' : undefined} onClick={() => p.dispatch({ type: 'home' })}>
          <Icon d={SHELL_ICONS.grid} size={13} /><span>{t.side.atelier}</span><span className="st-fill" /><small>{t.side.active(active)}</small>
        </button>
      </nav>
      <div className="st-scroll">
        <Attention items={attn} current={current} projectOf={projectOf} paused={p.nav.paused}
          onOpen={(id, helper, focus) => p.dispatch({ type: 'open', id, ...(helper !== undefined ? { helper } : {}), ...(focus !== undefined ? { focus } : {}) })}
          onDecide={(s, ok) => { p.decisions.decide(s, ok ? 'accept' : 'deny'); }}
          asks={p.asks} onAnswerAsk={p.onAnswerAsk}
          near={near} onHandover={id => { void p.relief?.handover(id); }}
          onLater={id => { const s = p.sessions.find(x => x.id === id); if (s) p.relief?.putLater(s); }}
          onMenu={(id, e) => {
            const host = e.currentTarget instanceof HTMLElement ? e.currentTarget : undefined;
            p.menu.open(id, { x: e.clientX, y: e.clientY }, host);
          }} />
        <section aria-label={t.side.projects}>
          <Tree groups={groups} sessions={p.sessions} projects={p.projects} current={current} filter={base.project}
            hideDone={prefs.hideDone} dense={prefs.dense} filing={p.filing} revealCurrent={p.revealCurrent} paused={p.nav.paused}
            onHome={project => p.dispatch({ type: 'home', ...(project !== undefined ? { project } : {}) })}
            onOpen={(id, helper) => p.dispatch({ type: 'open', id, ...(helper !== undefined ? { helper } : {}) })}
            onLaunch={project => p.dispatch({ type: 'modal', modal: { kind: 'launch', ...(project !== undefined ? { project } : {}) } })}
            onMenu={(id, e) => {
              const host = e.currentTarget instanceof HTMLElement ? e.currentTarget : undefined;
              p.menu.open(id, { x: e.clientX, y: e.clientY }, host?.querySelector<HTMLElement>('[data-tree-key]') ?? host);
            }}
            onArchive={ids => p.actions.request('archive', ids)} onDelete={ids => p.actions.request('delete', ids)} onTerminal={p.onTerminal}
            onToggleHide={() => setPrefs(v => ({ ...v, hideDone: !v.hideDone }))} onToggleDense={() => setPrefs(v => ({ ...v, dense: !v.dense }))}
            onNewProject={() => p.dispatch({ type: 'modal', modal: { kind: 'project' } })} />
          {p.filing.dragging && <p className="st-help">{t.side.dropHelp(p.filing.dragging.name)}</p>}
        </section>
        <Archives archived={p.archived} current={current} projectName={projectName} reveal={p.revealArchives}
          project={s => { const found = projectOf(s); return found ? { color: found.color } : null; }}
          onRead={id => p.dispatch({ type: 'open', id })} onRestore={id => p.actions.restore(id)} onResume={id => p.actions.resume(id)}
          onDelete={ids => p.actions.request('delete', ids)} allowed={p.actions.allowed} paused={p.nav.paused} />
      </div>
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
