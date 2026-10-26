import { useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { PROJECT_COLORS, type Helper, type Projects, type Session, type Task } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { Filing } from '../../atelier/filing';
import { useI18n } from '../../i18n/lang';
import { spanOf } from '../../list/time';
import { taskOf } from '../../nav/agents';
import { ProjectSwatch } from '../../projects/ProjectSwatch';
import { ledgeProgress } from '../../teams/useTeamsApi';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { AutoMark, HelperBot, SessionBot } from '../SessionBot';
import { isFinished, type ProjectGroup } from './model';

const branchIcon = ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M18 9a9 9 0 0 1-9 9'];

/** A row the keyboard walks: Left folds it (or goes to its parent), Right unfolds it. `session` is set only for a principal. */
interface Nav { toggle?: () => void; open?: boolean; parent?: string; session?: Session }

const projectKey = (id: string | null): string => `p:${id ?? 'none'}`;

function helperNeeds(s: Session, h: Helper): boolean {
  if (s.offline) return false;
  if (s.pending?.helperId === h.id) return true;
  return h.state === 'waiting_permission' || h.state === 'waiting_input' || h.state === 'error';
}

function placeOf(groups: readonly ProjectGroup[], id: string): { session: Session; pkey: string; bkey: string } | null {
  for (const g of groups) {
    const pkey = projectKey(g.id);
    for (const b of g.branches) {
      const session = b.sessions.find(s => s.id === id);
      if (session) return { session, pkey, bkey: `${pkey}:${b.branch}` };
    }
  }
  return null;
}

const flip = (set: Set<string>, put: (n: Set<string>) => void, k: string) => {
  const n = new Set(set);
  if (n.has(k)) n.delete(k); else n.add(k);
  put(n);
};

/** « 12 min » / « 1 h » / « 3 d », or the list's « just now ». Same units as the List. */
function shortWhen(iso: string, units: { min: string; h: string; d: string }, nowLabel: string): string {
  const span = spanOf(Date.now() - (Date.parse(iso) || 0));
  return span === 'now' ? nowLabel : `${span.n} ${units[span.unit]}`;
}

/** Project, then branch when the project has several, then session, then subagents.
 *  One branch folds into the project. Finished sessions (`isFinished`) hide behind « +N finished » until that row is opened. */
export function Tree(p: {
  groups: ProjectGroup[];
  sessions: readonly Session[];
  projects: Projects | null;
  current: string | null;
  filter: string;
  hideDone: boolean;
  dense: boolean;
  filing: Filing;
  revealCurrent: number;
  onHome(project?: string): void;
  onOpen(id: string, helper?: string): void;
  onLaunch(project?: string): void;
  onMenu(id: string, e: MouseEvent): void;
  onArchive(ids: string[]): void;
  onDelete(ids: string[]): void;
  onTerminal(s: Session): void;
  onToggleHide(): void;
  onToggleDense(): void;
  onNewProject(): void;
  paused: boolean;
  /** The tasks Ledge gave: a team row's « 1/2 ». */
  tasks?: readonly Task[];
}): JSX.Element {
  const { t } = useI18n();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const [kids, setKids] = useState<Set<string>>(() => new Set());
  const treeRef = useRef<HTMLDivElement>(null);
  const nav = useRef(new Map<string, Nav>());
  const latest = useRef(p);
  latest.current = p;
  nav.current = new Map();

  const reveal = (key: string) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.st [data-tree-key]')].find(x => x.dataset.treeKey === key);
      el?.scrollIntoView?.({ block: 'nearest' });
    }));
  };
  const openTo = (id: string, kidsToo: boolean) => {
    if (!latest.current.sessions.some(s => s.id === id)) return;
    const found = placeOf(latest.current.groups, id);
    if (!found) return;
    setClosed(c => { const n = new Set(c); n.delete(found.pkey); n.delete(found.bkey); return n; });
    if (isFinished(found.session)) setShown(s => { const n = new Set(s); n.add(found.pkey); n.add(found.bkey); return n; });
    if (kidsToo && found.session.helpers.length > 0) {
      const s = found.session;
      setKids(k => {
        const n = new Set(k);
        if (s.helpers.some(h => helperNeeds(s, h))) n.delete(s.id); else n.add(s.id);
        return n;
      });
    }
    reveal(id);
  };
  useEffect(() => { if (p.current) openTo(p.current, false); }, [p.current]);
  useEffect(() => { if (p.revealCurrent && p.current) openTo(p.current, true); }, [p.revealCurrent]);
  // H hides every finished session again, the ones a « +N finished » showed included, but not the open one.
  useEffect(() => {
    if (!p.hideDone) return;
    setShown(new Set());
    if (p.current) openTo(p.current, false);
  }, [p.hideDone]);

  // Roving tabindex: the open session, or the first row when the atelier has none, is the tree's only tab stop.
  const tabKey = p.current && placeOf(p.groups, p.current) ? p.current : (p.groups[0] ? projectKey(p.groups[0].id) : '');
  const tabOf = (key: string) => key === tabKey ? 0 : -1;

  const onTreeKey = (e: ReactKeyboardEvent) => {
    const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-tree-key]') : null;
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = nav.current.get(el.dataset.treeKey!);
    const items = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])];
    const focusKey = (k: string | undefined) => items.find(x => x.dataset.treeKey === k)?.focus();
    const i = items.indexOf(el);
    const k = e.key.toLowerCase();
    let done = true;
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'ArrowLeft') { if (n?.toggle && n.open) n.toggle(); else focusKey(n?.parent); }
    else if (e.key === 'ArrowRight') { if (n?.toggle && !n.open) n.toggle(); else items[i + 1]?.focus(); }
    else if (k === 'e') { if (n?.session) p.onArchive([n.session.id]); }
    else if (e.key === 'Delete') { if (n?.session) p.onDelete([n.session.id]); }
    else if (k === 'j' || k === 'k') { /* the atelier walks with these; the tree keeps them */ }
    else if (k === 'h') p.onToggleHide();
    else if (k === 'd') p.onToggleDense();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };

  const Chevron = ({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) => (
    <button type="button" tabIndex={-1} className="st-chev" aria-label={label} onClick={e => { e.stopPropagation(); onClick(); }}>
      <span className={open ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span>
    </button>
  );

  const agentRows = (s: Session, depth: number, parentKey: string, helper?: Helper): ReactNode[] => {
    const team = helper ? [] : (s.helpers ?? []);
    const auto = team.some(h => helperNeeds(s, h));
    const open = team.length > 0 && auto !== kids.has(s.id);
    const toggle = team.length > 0 ? () => flip(kids, setKids, s.id) : undefined;
    const treeKey = helper ? `${s.id}:${helper.id}` : s.id;
    if (!helper) nav.current.set(s.id, { toggle, open, parent: parentKey, session: s });
    else nav.current.set(treeKey, { parent: s.id });
    const selected = !helper && p.current === s.id;
    const name = helper ? helper.kind : s.name;
    const task = helper ? helper.task : taskOf(s);
    const waiting = helper ? helperNeeds(s, helper) : !s.offline && (s.state === 'waiting_permission' || s.state === 'waiting_input' || s.state === 'error');
    const timeClass = s.offline ? undefined : helper
      ? (helper.state === 'waiting_permission' ? 't-approval' : helper.state === 'waiting_input' ? 't-question' : helper.state === 'error' ? 't-error' : undefined)
      : (s.state === 'waiting_permission' ? 't-approval' : s.state === 'waiting_input' ? 't-question' : s.state === 'error' ? 't-error' : undefined);
    const row = (
      <div key={treeKey} role="treeitem" aria-level={depth + 1} aria-expanded={team.length > 0 ? open : undefined}
        aria-selected={selected} aria-current={selected ? 'true' : undefined}
        className={cls('st-row st-agent', selected && 'sel', !helper && isFinished(s) && 'done', s.offline && 'off', !!helper && 'helper')}
        style={{ '--d': depth } as CSSProperties}
        onContextMenu={helper ? undefined : e => { e.preventDefault(); p.onMenu(s.id, e); }}>
        {toggle ? <Chevron open={open} label={open ? t.side.foldKids(name) : t.side.unfoldKids(name)} onClick={toggle} /> : <span className="st-gap" />}
        <span className="st-bot">{helper
          ? <HelperBot helper={helper} parent={s} size={16} paused={p.paused} />
          : <SessionBot session={s} size={18} paused={p.paused} />}</span>
        {/* No « Name, » label: boot() and the title bar find the atelier seat with /^Name,/. */}
        <button type="button" className="st-main" data-tree-key={treeKey} tabIndex={tabOf(treeKey)}
          onClick={() => helper ? p.onOpen(s.id, helper.id) : p.onOpen(s.id)}>
          <strong>{name}{!helper && <AutoMark session={s} />}{!helper && s.role && <span className="role-pill" title={s.roleLabel ?? s.role}>@{s.role}</span>}</strong>{task && <span>{task}</span>}
        </button>
        {team.length > 0 && !open && <span className="st-kids" title={t.side.kids(team.length)}>{team.length}</span>}
        <span className={cls('st-time', waiting && timeClass)}>{s.offline ? t.side.offline : shortWhen(s.lastActivityAt, t.list.when.units, t.list.when.now)}</span>
        <span className="st-acts">
          <button type="button" tabIndex={-1} aria-label={t.side.terminalOne(name)} title="Terminal · T" onClick={() => p.onTerminal(s)}><Icon d={SHELL_ICONS.terminal} size={13} /></button>
          {!helper && <button type="button" tabIndex={-1} aria-label={t.side.archiveOne(s.name)} title={`${t.manage.menu.archive} · E`} onClick={() => p.onArchive([s.id])}><Icon d={SHELL_ICONS.archive} size={13} /></button>}
          {!helper && <button type="button" tabIndex={-1} aria-label={t.side.manageOne(s.name)} aria-haspopup="menu" title={t.manage.menu.more} onClick={e => p.onMenu(s.id, e)}><Icon d={[]} fill={SHELL_ICONS.dots} size={13} /></button>}
        </span>
      </div>
    );
    return [row, ...(open ? team.flatMap(h => agentRows(s, depth + 1, s.id, h)) : [])];
  };

  const sessionRows = (list: readonly Session[], depth: number, key: string, parentKey: string): ReactNode[] => {
    const done = list.filter(isFinished);
    const all = !p.hideDone || shown.has(key);
    const rows = list.filter(s => all || !isFinished(s)).flatMap(s => agentRows(s, depth, parentKey));
    // Once shown, the finished ones stay until H hides them all again: no « Hide finished » link. Archiving stays per session.
    if (!all && done.length > 0) {
      const moreKey = `${key}:more`;
      nav.current.set(moreKey, { parent: parentKey });
      rows.push(
        <div key={moreKey} className="st-row st-more" style={{ '--d': depth } as CSSProperties}>
          <span className="st-gap" />
          <button type="button" data-tree-key={moreKey} tabIndex={tabOf(moreKey)} aria-expanded={false} onClick={() => flip(shown, setShown, key)}>
            {t.side.moreDone(done.length)}
          </button>
        </div>
      );
    }
    return rows;
  };

  const tally = (g: ProjectGroup) => {
    const sessions = g.branches.flatMap(b => b.sessions);
    let need = 0, work = 0, off = 0, done = 0;
    for (const s of sessions) {
      if (s.offline) off++;
      else if (isFinished(s)) done++;
      else if (s.state === 'waiting_permission' || s.state === 'waiting_input' || s.state === 'error') need++;
      else if (s.state === 'working') work++;
      if (s.offline) continue;
      for (const h of s.helpers ?? []) {
        if (helperNeeds(s, h)) need++;
        else if (h.state === 'working') work++;
      }
    }
    return [
      { n: need, c: 't-need', label: t.side.tallyNeed },
      { n: work, c: 't-work', label: t.side.tallyWork },
      { n: off, c: 't-off', label: t.side.tallyOff },
      { n: p.hideDone ? 0 : done, c: 't-done', label: t.side.tallyDone }
    ].filter(x => x.n > 0);
  };

  const rows: ReactNode[] = [];
  for (const g of p.groups) {
    const label = g.id === null ? t.side.unassigned : g.name;
    const pkey = projectKey(g.id);
    const common = g.branches.flatMap(b => b.sessions);
    const sessions = [...common, ...g.teams.flatMap(x => x.sessions)];
    // With teams (atelier rooms spec §3.4): « table commune », then a row per team, each holding its seats.
    const teamed = g.teams.length > 0;
    const has = sessions.length > 0 || teamed;
    const open = has && !closed.has(pkey);
    const toggle = has ? () => flip(closed, setClosed, pkey) : undefined;
    const branch = g.branches.length === 1 ? g.branches[0]!.branch : undefined;
    const sub = teamed ? t.teams.tables(g.teams.length + (common.length > 0 ? 1 : 0)) : g.flatten && branch && g.repo ? `${g.repo} · ${branch}` : (!g.flatten && g.repo ? g.repo : '');
    const project = g.id ? p.projects?.projects.find(x => x.id === g.id) ?? null : null;
    nav.current.set(pkey, { toggle, open });
    rows.push(
      <div key={pkey} role="treeitem" aria-level={1} aria-expanded={has ? open : undefined}
        className={cls('st-row st-project', p.filter === (g.id ?? 'none') && !p.current && 'sel', g.id !== null && p.filing.over === g.id && 'drop-over')}
        style={{ '--d': 0 } as CSSProperties} {...(g.id ? p.filing.dropProps(g.id) : {})}>
        {toggle ? <Chevron open={open} label={open ? t.side.fold(label) : t.side.unfold(label)} onClick={toggle} /> : <span className="st-gap" />}
        <ProjectSwatch project={project} />
        <button type="button" className="st-main" data-tree-key={pkey} tabIndex={tabOf(pkey)} title={t.side.filterProject(label)} onClick={() => p.onHome(g.id ?? 'none')}>
          <strong>{label}</strong>{sub && <span className="mono">{sub}</span>}
        </button>
        <span className="st-tally">{tally(g).map(x => <span key={x.c} className={x.c} title={`${x.n} ${x.label}`}><i />{x.n}</span>)}</span>
        {g.id && <span className="st-acts"><button type="button" tabIndex={-1} aria-label={t.side.newHere(label)} title={t.side.newHere(label)} onClick={() => p.onLaunch(g.id!)}><Icon d={ICONS.plus.d} size={13} /></button></span>}
      </div>
    );
    if (!open) continue;
    // The common table: its own row only when the project has teams.
    let base = 0; let parent = pkey; let commonOpen = true;
    if (teamed && common.length > 0) {
      const ckey = `${pkey}:common`;
      commonOpen = !closed.has(ckey);
      const ctoggle = () => flip(closed, setClosed, ckey);
      nav.current.set(ckey, { toggle: ctoggle, open: commonOpen, parent: pkey });
      rows.push(
        <div key={ckey} role="treeitem" aria-level={2} aria-expanded={commonOpen} className="st-row st-common" style={{ '--d': 1 } as CSSProperties}>
          <Chevron open={commonOpen} label={commonOpen ? t.side.fold(t.teams.common) : t.side.unfold(t.teams.common)} onClick={ctoggle} />
          <button type="button" className="st-main" data-tree-key={ckey} tabIndex={tabOf(ckey)} onClick={ctoggle}><span>{t.teams.common}</span></button>
          <span className="st-fill" /><span className="st-count">{common.length}</span>
        </div>
      );
      base = 1; parent = ckey;
    }
    if (commonOpen && (!teamed || common.length > 0)) {
    if (g.flatten) rows.push(...sessionRows(common, 1 + base, parent, parent));
    else for (const b of g.branches) {
      const bkey = `${pkey}:${b.branch}`;
      const bopen = !closed.has(bkey);
      const btoggle = () => flip(closed, setClosed, bkey);
      const visible = b.sessions.filter(s => !p.hideDone || shown.has(bkey) || !isFinished(s)).length;
      nav.current.set(bkey, { toggle: btoggle, open: bopen, parent });
      rows.push(
        <div key={bkey} role="treeitem" aria-level={2 + base} aria-expanded={bopen} className="st-row st-branch" style={{ '--d': 1 + base } as CSSProperties}>
          <Chevron open={bopen} label={bopen ? t.side.fold(b.branch) : t.side.unfold(b.branch)} onClick={btoggle} />
          <Icon d={branchIcon} size={13} />
          <button type="button" className="st-main mono" data-tree-key={bkey} tabIndex={tabOf(bkey)} onClick={btoggle}><span>{b.branch}</span></button>
          {b.worktree && <span className="st-wt" title={t.side.wt}>wt</span>}
          <span className="st-fill" />
          <span className="st-count">{visible}</span>
          <span className="st-acts">
            <button type="button" tabIndex={-1} aria-label={t.side.newOn(b.branch)} title={t.side.newOn(b.branch)} onClick={() => p.onLaunch(g.id ?? undefined)}><Icon d={ICONS.plus.d} size={13} /></button>
            <button type="button" tabIndex={-1} aria-label={t.side.terminalOne(b.branch)} title="Terminal" onClick={() => { const s = b.sessions[0]; if (s) p.onTerminal(s); }}><Icon d={SHELL_ICONS.terminal} size={13} /></button>
          </span>
        </div>
      );
      if (bopen) rows.push(...sessionRows(b.sessions, 2 + base, bkey, bkey));
    }
    }
    for (const { team, sessions: seats } of g.teams) {
      const tkey = `${pkey}:team:${team.id}`;
      const topen = !closed.has(tkey);
      const ttoggle = () => flip(closed, setClosed, tkey);
      const { done, given } = ledgeProgress(p.tasks ?? [], team.id);
      const progress = t.home.point.progress(done, given);
      nav.current.set(tkey, { toggle: ttoggle, open: topen, parent: pkey });
      // One line, as a project's: the flag in the project's colour, the name, « team » or « resting », and Ledge's tasks once it gave some.
      rows.push(
        <div key={tkey} role="treeitem" aria-level={2} aria-expanded={topen} className={cls('st-row st-team', team.state === 'resting' && 'resting')}
          style={{ '--d': 1, ...(project ? { '--team': PROJECT_COLORS[project.color] } : {}) } as CSSProperties}>
          <Chevron open={topen} label={topen ? t.side.fold(team.name) : t.side.unfold(team.name)} onClick={ttoggle} />
          <span className="st-flag"><Icon d={SHELL_ICONS.flag} size={13} /></span>
          <button type="button" className="st-main" data-tree-key={tkey} tabIndex={tabOf(tkey)} onClick={() => p.onHome(g.id ?? 'none')}>
            <strong>{team.name}</strong><span>{team.state === 'resting' ? t.teams.treeResting : t.teams.tree}</span>
          </button>
          {given > 0 && <span className="st-progress" title={progress} aria-label={progress}><i><b style={{ width: `${Math.round((done / given) * 100)}%` }} /></i>{done}/{given}</span>}
        </div>
      );
      if (topen) rows.push(...sessionRows(seats, 2, tkey, tkey));
    }
  }

  return (
    <>
      <div className="st-label">
        <span>{t.side.projects}</span><span className="st-fill" />
        <button type="button" className={cls('st-icon', p.hideDone && 'on')} aria-pressed={p.hideDone} aria-label={t.side.hideDone} title={t.side.hideDone} onClick={p.onToggleHide}>
          <Icon d={SHELL_ICONS.eyeOff} size={14} />
        </button>
        <button type="button" className={cls('st-icon', p.dense && 'on')} aria-pressed={p.dense} aria-label={t.side.dense} title={t.side.dense} onClick={p.onToggleDense}>
          <Icon d={SHELL_ICONS.densityTight} size={14} />
        </button>
        <button type="button" className="st-icon" aria-label={t.side.foldAll} title={t.side.foldAll} onClick={() => setClosed(new Set(p.groups.map(g => projectKey(g.id))))}>
          <Icon d={SHELL_ICONS.foldAll} size={14} />
        </button>
        <button type="button" className="st-icon" aria-label={t.side.newProject} title={t.side.newProject} onClick={p.onNewProject}>
          <Icon d={ICONS.plus.d} size={14} />
        </button>
      </div>
      <div ref={treeRef} role="tree" aria-label={t.side.tree} className={cls('st-tree', p.dense && 'st-dense')} onKeyDown={onTreeKey}>{rows}</div>
    </>
  );
}
