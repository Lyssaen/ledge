import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { MachineState } from '@ledge/fleet';
import { PROJECT_COLORS, type Projects, type Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { folderOf } from '../atelier/filing';
import { useI18n } from '../i18n/lang';
import { useScreenKeys } from '../nav/screenKeys';
import type { NavAction, NavState } from '../nav/state';
import { SHELL_ICONS } from '../shell/icons';
import { useStored } from '../state/useStored';
import { ListGroup } from './ListGroup';
import { ListRow } from './ListRow';
import { ListToolbar } from './ListToolbar';
import { listModel, walkRows, type Chip, type ListCtx } from './model';
import { loadListPrefs, saveListPrefs } from './prefs';
import { trackWaits, type Wait } from './time';

export interface ListProps {
  nav: NavState;
  dispatch: (a: NavAction) => void;
  /** mainOrder. */
  order: readonly Session[];
  projects: Projects | null;
  projectIdOf: (s: Session) => string | null;
  machines: readonly MachineState[];
}

const toggle = (set: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
};

/** The List (list.tsx, `SessionList`): every session as an aligned row, grouped by project, machine or state, what
 *  awaits a decision first in each group. Grouping and density are remembered (`desktop.list`); the text filter, the
 *  chip, the collapsed groups and the unfolded subagents live here and start over when the List unmounts. */
export function List({ nav, dispatch, order, projects, projectIdOf, machines }: ListProps): JSX.Element {
  const { t } = useI18n();
  const [prefs, setPrefs] = useStored(loadListPrefs, saveListPrefs);
  const [text, setText] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  // Group keys: a fleet update rebuilds the groups, never unfolds them.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());

  // The activity column: a clock refreshed every 30 s, and the start of each wait kept across PaneChanged refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const tracked = useRef<ReadonlyMap<string, Wait>>(new Map());
  const waits = useMemo(() => {
    tracked.current = trackWaits(tracked.current, order);
    return new Map([...tracked.current].map(([id, w]) => [id, w.since]));
  }, [order]);

  // The sticky group headers sit under the toolbar, whose height changes when it wraps.
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current, bar = barRef.current;
    if (!root || !bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => root.style.setProperty('--toolbar-h', `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const { place } = nav;
  const filter = place.kind === 'settings' ? place.back.project : place.project;
  const { group, density } = prefs;
  const labels = useMemo(() => ({ unassigned: t.side.unassigned, buckets: t.list.buckets }), [t]);
  const model = useMemo(() => {
    const ctx: ListCtx = { projects, projectIdOf, machines, waits, labels };
    return listModel(order, ctx, { text, chip, group, helpers: nav.helpers, toggled, filter });
  }, [order, projects, projectIdOf, machines, waits, labels, text, chip, group, nav.helpers, toggled, filter]);

  // The chosen row (a row key), the rows J / K walk, and whether the List holds the focus.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const walk = useMemo(() => walkRows(model.groups, collapsed), [model.groups, collapsed]);
  useEffect(() => { if (focusedId !== null && !walk.some(r => r.key === focusedId)) setFocusedId(null); }, [walk, focusedId]);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFocus = useRef(false);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!(e.target instanceof Node && rootRef.current?.contains(e.target))) hasFocus.current = false; };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, []);
  // Compare keys as data, never build a selector from one.
  const rowEl = (key: string) => [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-agent]') ?? [])].find(el => el.dataset.agent === key);
  const choose = (key: string) => { setFocusedId(key); rowEl(key)?.focus(); };
  // A row that moves (its state changed) or loses a button drops the focus to the body: it goes back to the chosen row.
  useLayoutEffect(() => {
    if (focusedId !== null && hasFocus.current && document.activeElement === document.body) rowEl(focusedId)?.focus();
  });

  useScreenKeys(e => {
    const target = e.target instanceof Element ? e.target : null;
    const key = e.key.toLowerCase();
    if (key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return true;
    }
    if (target?.closest('[role=tablist],[role=menu]')) return false;
    const step = key === 'j' || key === 'arrowdown' ? 1 : key === 'k' || key === 'arrowup' ? -1 : 0;
    if (step !== 0) {
      if (walk.length === 0) return false;
      const i = walk.findIndex(r => r.key === focusedId);
      choose(walk[i < 0 ? (step > 0 ? 0 : walk.length - 1) : (i + step + walk.length) % walk.length]!.key);
      return true;
    }
    const chosen = walk.find(r => r.key === focusedId);
    // A focused button or link keeps its own Entrée.
    if (e.key === 'Enter' && chosen && !target?.closest('button,a,input')) {
      dispatch({ type: 'open', id: chosen.kind === 'main' ? chosen.session.id : chosen.parent.id });
      return true;
    }
    return false;
  });

  const clear = useCallback(() => { setText(''); setChip('all'); }, []);
  const launch = (project?: string) => dispatch({ type: 'modal', modal: project === undefined ? { kind: 'launch' } : { kind: 'launch', project } });
  const onToggleKids = useCallback((id: string) => setToggled(s => toggle(s, id)), []);

  const empty = (() => {
    if (model.empty) {
      const p = model.empty;
      const where = p.repos.map(r => folderOf(r.path)).join(' · ') || t.atelier.empty.noRepo;
      return (
        <div className="list-empty">
          <i className="side-swatch" style={{ background: PROJECT_COLORS[p.color] }} />
          <h2>{t.list.empty.projectTitle(p.name)}</h2>
          <p className="muted">{t.list.empty.projectBody(where)}</p>
          <Button variant="primary" onClick={() => launch(p.id)}><Icon d={ICONS.plus.d} size={14} />{t.atelier.newSession}</Button>
        </div>
      );
    }
    if (model.groups.length > 0) return null;
    if (model.total === 0) {
      return (
        <div className="list-empty">
          <Icon d={SHELL_ICONS.search} size={20} />
          <h2>{t.list.empty.noneTitle}</h2>
          <p className="muted">{t.list.empty.noneBody}</p>
          <Button variant="primary" onClick={() => launch()}><Icon d={ICONS.plus.d} size={14} />{t.atelier.newSession}</Button>
        </div>
      );
    }
    return (
      <div className="list-empty">
        <Icon d={SHELL_ICONS.search} size={20} />
        <h2>{t.list.empty.noMatch}</h2>
        <p className="muted">{t.list.empty.noMatchBody(text.trim(), chip === 'all' ? null : t.list.buckets[chip].toLowerCase())}</p>
        <Button onClick={clear}>{t.list.empty.clear}</Button>
      </div>
    );
  })();

  return (
    <div className="overview-scroll list" id="view-panel-list" role="tabpanel" aria-labelledby="view-tab-list">
      <div ref={rootRef} className={`list-view density-${density} group-${group}`}
        onFocus={() => { hasFocus.current = true; }}
        onBlur={e => { if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) hasFocus.current = false; }}>
        <ListToolbar barRef={barRef} inputRef={inputRef} onClear={clear} onFirst={() => { if (walk[0]) choose(walk[0].key); }} text={text} onText={setText} chip={chip} onChip={setChip} counts={model.counts}
          group={group} onGroup={g => setPrefs(p => ({ ...p, group: g }))} density={density} onDensity={d => setPrefs(p => ({ ...p, density: d }))} />
        {empty ?? model.groups.map(g => (
          <ListGroup key={g.key} group={g} collapsed={collapsed.has(g.key)} filtering={model.filtering} onToggle={() => setCollapsed(s => toggle(s, g.key))} dispatch={dispatch}>
            {g.rows.map(r => (
              <ListRow key={r.key} row={r} selected={focusedId === r.key} onChoose={setFocusedId} group={group} density={density} text={text} now={now} waits={waits} projects={projects}
                projectIdOf={projectIdOf} paused={nav.paused} dispatch={dispatch} onToggleKids={onToggleKids} />
            ))}
          </ListGroup>
        ))}
        {!empty && model.groups.length > 0 && (
          <p className="list-foot muted">
            <Kbd>J</Kbd><Kbd>K</Kbd> {t.list.foot.walk} · <Kbd>{t.list.enter}</Kbd> {t.list.foot.open} · <Kbd>F</Kbd> {t.list.foot.filter} · {t.list.foot.note}
          </p>
        )}
      </div>
    </div>
  );
}
