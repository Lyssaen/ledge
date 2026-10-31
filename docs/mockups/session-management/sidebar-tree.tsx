import React, { useEffect, useRef, useState } from 'react';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import { HARNESS_LABELS, type PreviewTool } from './harness';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';
import { ago, archiveIcon, dotsIcon, restoreIcon, resumeIcon, trashIcon } from './manage';

/** The sidebar as an IDE explorer for agents: « Demander à Ledge… » (the old island's field), the views, « À toi » (what
 *  waits on you, oldest first, answered in place), then the tree project › branch or worktree › session › subagents.
 *  A level with one child folds into its parent; finished sessions hide behind « +N terminées », from where they archive. */
export type TreeAgent = { id: string; name: string; tool: PreviewTool; project: string; state: BotState; task: string; machine: string; repos: string; parent?: string; offline?: boolean; reply: string; since?: number };
export type TreeMachine = { id: string; label: string; offline: boolean; count: number };

/** Mock git context: each main agent's branch, and whether its folder is a linked worktree. Unlisted agents: `main`. */
const WORK: Record<string, { branch: string; wt?: boolean }> = {
  otto: { branch: 'desktop' }, rio: { branch: 'release-0.6', wt: true }, milo: { branch: 'ssh-reconnect', wt: true },
  nova: { branch: 'checkout' }, iris: { branch: 'checkout' },
  remy: { branch: 'about-page', wt: true },
  vega: { branch: 'nightly' }, tess: { branch: 'nightly' }, wren: { branch: 'nightly' }, orion: { branch: 'partitions', wt: true },
  kai: { branch: 'offline-mode' }, max: { branch: 'offline-mode' }, bo: { branch: 'offline-mode' }, nia: { branch: 'offline-mode' },
  lou: { branch: 'deps-bump', wt: true }, ivy: { branch: 'slim-bundle', wt: true }, ivo: { branch: 'i18n-nl', wt: true }
};
const REPO: Record<string, string> = { ledge: 'harness-assistant', commerce: 'payment', studio: 'portfolio', atlas: 'factory', mobile: 'doccle', docs: 'ui' };
const workOf = (a: TreeAgent) => WORK[a.id] ?? { branch: 'main' };

const cls = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const needs = (a: TreeAgent) => !a.offline && (a.state === 'approval' || a.state === 'question' || a.state === 'error');
const isDone = (a: TreeAgent) => a.state === 'done';
const when = (m = 0) => (m < 60 ? `${Math.max(1, Math.round(m))} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} j`);
const STATE: Partial<Record<BotState, string>> = { approval: 'attend ton accord', question: 'te pose une question', error: 'en erreur', working: 'au travail', starting: 'démarre', idle: 'au repos', done: 'terminée' };
const stateOf = (a: TreeAgent) => (a.offline ? 'hors ligne' : STATE[a.state] ?? a.state);

const eyeOffIcon = ['M9.9 9.9a3 3 0 1 0 4.2 4.2', 'M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7', 'M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M2 2l20 20'];
const denseIcon = ['M3 5h18', 'M3 10h18', 'M3 15h18', 'M3 20h18'];
const foldAllIcon = ['m7 20 5-5 5 5', 'm7 4 5 5 5-5'];
const branchIcon = ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M18 9a9 9 0 0 1-9 9'];
const terminalIcon = ['m4 17 6-6-6-6', 'M12 19h8'];
const gridIcon = ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'];
const searchIcon = ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'm16 16 5 5'];
const gearIcon = ['M20 7h-9', 'M14 17H5', 'M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6'];
const unassignedIcon = ['M4 7h16v12H4z', 'M4 7l2-3h4l2 3', 'M9 13h6'];

export interface SidebarTreeProps {
  agents: TreeAgent[];
  projects: { id: string; name: string }[];
  machines: TreeMachine[];
  /** The open session (or null), the atelier's project filter, which view is active. */
  current: string | null; filter: string; atelierActive: boolean; settingsActive: boolean; chatOpen: boolean;
  theme: 'dark' | 'light'; paused: boolean;
  /** The sessions put away, newest first (`ago` in minutes), and what can be done with them. */
  archived: { agent: TreeAgent; helpers: TreeAgent[]; ago: number }[];
  onRead: (id: string) => void; onResume: (id: string) => void; onRestore: (id: string) => void; onDeleteArchived: (ids: string[]) => void;
  /** When finished sessions archive themselves: 'never', '1h', '1d', '7d'. */
  autoArchive: string; onAutoArchive: (v: string) => void;
  /** Bumped to unfold the Archives and bring them into view (the « Archives » crumb of an archived session). */
  revealArchives: number;
  /** Bumped to unfold the open session's subagents and bring them into view (the « N sous-agents » pill of its header). */
  revealCurrent: number;
  bot: (a: TreeAgent, size: number) => React.ReactNode;
  onHome: (pid?: string) => void; onOpen: (id: string) => void;
  /** The session menu of the session management (manage.tsx), on « … » and on a right click. */
  onMenu: (id: string, e: React.MouseEvent) => void;
  onArchive: (ids: string[]) => void; onDelete: (ids: string[]) => void; onDecide: (id: string, ok: boolean) => void;
  onAsk: (q: string) => void; onOpenChat: () => void; onLaunch: (pid?: string) => void; onSearch: () => void; onNewProject: () => void;
  onSettings: () => void; onMachines: () => void;
  dropProps: (pid: string) => object; dropOver: string | null; dragging: string | null;
}

/** A row the keyboard walks: Left folds it (or goes to its parent), Right unfolds it. */
interface Nav { toggle?: () => void; open?: boolean; parent?: string; agent?: TreeAgent }

const load = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const save = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private window */ } };

export function SidebarTree(p: SidebarTreeProps) {
  const { agents, projects } = p;
  const [hideDone, setHideDone] = useState(() => load('ledge-mock-side-hide', true));
  const [dense, setDense] = useState(() => load('ledge-mock-side-dense', false));
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const [kids, setKids] = useState<Set<string>>(() => new Set());
  const [allAttn, setAllAttn] = useState(false);
  const [ask, setAsk] = useState('');
  const treeRef = useRef<HTMLDivElement>(null);
  // Archives: folded at first; unfolded by the « Archives » crumb and while an archived session is read.
  const [archOpen, setArchOpen] = useState(false);
  const [archQ, setArchQ] = useState('');
  const archRef = useRef<HTMLElement>(null);
  const reading = p.archived.some(e => e.agent.id === p.current);
  /** Brings a row into view once it is rendered (keys compared as data, never built into a selector). */
  const reveal = (key: string) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = [...(document.querySelectorAll<HTMLElement>('.st [data-tree-key],.st [data-arch-key]'))].find(x => (x.dataset.treeKey ?? x.dataset.archKey) === key);
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }));
  /** Unfolds what hides an agent: its project, its branch, the finished ones, and its parent's subagents (`kids` too: the agent's own). */
  const unfold = (id: string, kids_: boolean) => {
    const a = agents.find(x => x.id === id);
    if (!a) return;
    const main = (a.parent && agents.find(x => x.id === a.parent)) || a;
    const pkey = `p:${main.project || 'none'}`, bkey = `${pkey}:${workOf(main).branch}`;
    setClosed(c => { const n = new Set(c); n.delete(pkey); n.delete(bkey); return n; });
    if (isDone(main)) setShown(s => new Set(s).add(pkey).add(bkey));
    const openKids = (pid: string) => setKids(k => { const n = new Set(k); if (agents.filter(x => x.parent === pid).some(needs)) n.delete(pid); else n.add(pid); return n; });
    if (a.parent) openKids(main.id);
    if (kids_ && agents.some(x => x.parent === a.id)) openKids(a.id);
  };
  // The open session is always in sight in the sidebar: unfolded to, and scrolled to; an archived one in the Archives.
  useEffect(() => {
    if (!p.current) return;
    if (reading) setArchOpen(true); else unfold(p.current, false);
    reveal(p.current);
  }, [p.current, reading]);
  useEffect(() => {
    if (!p.revealCurrent || !p.current) return;
    unfold(p.current, true);
    reveal(p.current);
  }, [p.revealCurrent]);
  useEffect(() => {
    if (!p.revealArchives) return;
    setArchOpen(true);
    requestAnimationFrame(() => archRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  }, [p.revealArchives]);
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const archShown = p.archived.filter(e => !archQ.trim() || fold(`${e.agent.name}\n${e.agent.task}\n${projects.find(x => x.id === e.agent.project)?.name ?? 'Sans projet'}`).includes(fold(archQ.trim())));
  const nav = useRef(new Map<string, Nav>());
  nav.current.clear();
  const flip = (set: Set<string>, put: (s: Set<string>) => void, k: string) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); put(n); };
  const toggleHide = () => { setHideDone(h => { save('ledge-mock-side-hide', !h); return !h; }); };
  const toggleDense = () => { setDense(d => { save('ledge-mock-side-dense', !d); return !d; }); };

  const mains = agents.filter(a => !a.parent);
  const kidsOf = (id: string) => agents.filter(a => a.parent === id);
  const swatch = (pid: string) => (pid ? <i className={`side-swatch swatch-${pid}`} /> : <i className="side-swatch st-none" />);

  // « À toi »: requests and errors, helpers included, the longest wait first.
  const attn = agents.filter(needs).sort((x, y) => (y.since ?? 0) - (x.since ?? 0));
  const attnShown = allAttn ? attn : attn.slice(0, 4);

  // Ctrl ⇧ E puts the focus in the tree (the open session, else the first row); Alt ↓ opens the next agent that waits.
  const latest = useRef({ attn, current: p.current, onOpen: p.onOpen });
  latest.current = { attn, current: p.current, onOpen: p.onOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        const items = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])];
        (items.find(el => el.dataset.treeKey === latest.current.current) ?? items[0])?.focus();
      } else if (e.altKey && e.key === 'ArrowDown' && latest.current.attn.length) {
        e.preventDefault();
        const { attn, current, onOpen } = latest.current;
        const i = attn.findIndex(a => a.id === current);
        onOpen(attn[(i + 1) % attn.length]!.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onTreeKey = (e: React.KeyboardEvent) => {
    const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-tree-key]') : null;
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = el.dataset.treeKey!;
    const n = nav.current.get(key);
    const items = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])];
    const focus = (k: string | undefined) => items.find(x => x.dataset.treeKey === k)?.focus();
    const i = items.indexOf(el);
    const k = e.key.toLowerCase();
    let done = true;
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'ArrowLeft') { if (n?.toggle && n.open) n.toggle(); else focus(n?.parent); }
    else if (e.key === 'ArrowRight') { if (n?.toggle && !n.open) n.toggle(); else items[i + 1]?.focus(); }
    else if (k === 'e' && n?.agent && !n.agent.parent) p.onArchive([n.agent.id]);
    else if (e.key === 'Delete' && n?.agent && !n.agent.parent) p.onDelete([n.agent.id]);
    else if (k === 'h') toggleHide();
    else if (k === 'd') toggleDense();
    else done = false;
    // The atelier's own E / Suppr / J / K must not act on the same key.
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };

  const Chevron = ({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) => (
    <button type="button" tabIndex={-1} className="st-chev" aria-label={label} onClick={e => { e.stopPropagation(); onClick(); }}>
      <span className={open ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span>
    </button>
  );

  const agentRow = (a: TreeAgent, depth: number, parentKey: string): React.ReactNode[] => {
    const team = kidsOf(a.id);
    // Subagents unfold on their own when one of them waits on you; the chevron overrides it.
    const auto = team.some(needs);
    const open = team.length > 0 && auto !== kids.has(a.id);
    const toggle = team.length ? () => flip(kids, setKids, a.id) : undefined;
    nav.current.set(a.id, { toggle, open, parent: parentKey, agent: a });
    const waiting = needs(a);
    const row = (
      <div key={a.id} role="treeitem" aria-level={depth + 1} aria-expanded={team.length ? open : undefined} aria-selected={p.current === a.id}
        className={cls('st-row st-agent', p.current === a.id && 'sel', isDone(a) && 'done', a.offline && 'off', a.parent && 'helper')}
        style={{ '--d': depth } as React.CSSProperties} onContextMenu={e => p.onMenu(a.id, e)}>
        {toggle ? <Chevron open={open} label={`${open ? 'Masquer' : 'Afficher'} les sous-agents de ${a.name}`} onClick={toggle} /> : <span className="st-gap" />}
        <span className="st-bot" title={HARNESS_LABELS[a.tool]}>{p.bot(a, a.parent ? 16 : 18)}</span>
        <button type="button" className="st-main" data-tree-key={a.id} tabIndex={p.current === a.id ? 0 : -1} aria-label={`${a.name}, ${stateOf(a)}, ${a.task}`} onClick={() => p.onOpen(a.id)}>
          <strong>{a.name}</strong><span>{a.task}</span>
        </button>
        {team.length > 0 && !open && <span className="st-kids" title={`${team.length} sous-agent${team.length > 1 ? 's' : ''}`}>{team.length}</span>}
        <span className={cls('st-time', waiting && `t-${a.state}`)}>{a.offline ? 'hors ligne' : when(a.since)}</span>
        <span className="st-acts">
          <button type="button" tabIndex={-1} aria-label={a.tool === 'omp' ? `Ouvrir la session native de ${a.name} et son shell projet` : `Ouvrir le terminal de ${a.name}`} title={a.tool === 'omp' ? 'Session native · shell projet' : 'Terminal · T'} onClick={() => p.onOpen(a.id)}><Icon d={terminalIcon} size={13} /></button>
          {!a.parent && <button type="button" tabIndex={-1} aria-label={`Archiver ${a.name}`} title="Archiver · E" onClick={() => p.onArchive([a.id])}><Icon d={archiveIcon} size={13} /></button>}
          <button type="button" tabIndex={-1} aria-label={`Gérer la session ${a.name}`} aria-haspopup="menu" title="Plus d’actions" onClick={e => p.onMenu(a.id, e)}><Icon d={dotsIcon} size={13} /></button>
        </span>
      </div>
    );
    return [row, ...(open ? team.flatMap(k => agentRow(k, depth + 1, a.id)) : [])];
  };

  /** A branch's sessions, its finished ones folded behind « +N terminées » when they are hidden. */
  const sessions = (list: TreeAgent[], depth: number, key: string, parentKey: string): React.ReactNode[] => {
    const done = list.filter(isDone);
    const all = !hideDone || shown.has(key);
    const rows = list.filter(a => all || !isDone(a)).flatMap(a => agentRow(a, depth, parentKey));
    if (hideDone && done.length) rows.push(
      <div key={`${key}:more`} className="st-row st-more" style={{ '--d': depth } as React.CSSProperties}>
        <span className="st-gap" />
        <button type="button" data-tree-key={`${key}:more`} tabIndex={-1} aria-expanded={all} onClick={() => flip(shown, setShown, key)}>
          {all ? `Masquer ${done.length > 1 ? 'les terminées' : 'la terminée'}` : `+${done.length} terminée${done.length > 1 ? 's' : ''}`}
        </button>
        <span className="st-fill" />
        <button type="button" tabIndex={-1} className="st-link" title="Archiver les sessions terminées de cette branche" onClick={() => p.onArchive(done.map(a => a.id))}>
          <Icon d={archiveIcon} size={12} />Archiver
        </button>
      </div>
    );
    return rows;
  };

  const tree: React.ReactNode[] = [];
  const groups = [...projects.map(pr => ({ id: pr.id, name: pr.name })), ...(mains.some(a => !a.project) ? [{ id: '', name: 'Sans projet' }] : [])];
  for (const g of groups) {
    const team = mains.filter(a => a.project === g.id);
    const key = `p:${g.id || 'none'}`;
    const open = !closed.has(key) && team.length > 0;
    const everyone = agents.filter(a => a.project === g.id);
    const n = (f: (a: TreeAgent) => boolean) => everyone.filter(f).length;
    const tally = [
      { n: n(needs), c: 't-need', label: 'à décider' },
      { n: n(a => !a.offline && a.state === 'working'), c: 't-work', label: 'au travail' },
      { n: n(a => !!a.offline), c: 't-off', label: 'hors ligne' },
      { n: hideDone ? 0 : n(isDone), c: 't-done', label: 'terminées' }
    ].filter(t => t.n > 0);
    const branches = [...new Set(team.map(a => workOf(a).branch))];
    const single = branches.length <= 1 || !g.id;
    const toggle = team.length ? () => flip(closed, setClosed, key) : undefined;
    nav.current.set(key, { toggle, open });
    tree.push(
      <div key={key} role="treeitem" aria-level={1} aria-expanded={team.length ? open : undefined} {...(g.id ? p.dropProps(g.id) : {})}
        className={cls('st-row st-project', p.filter === (g.id || 'none') && !p.current && 'sel', p.dropOver === g.id && g.id && 'drop-over')} style={{ '--d': 0 } as React.CSSProperties}>
        {toggle ? <Chevron open={open} label={`${open ? 'Replier' : 'Déplier'} ${g.name}`} onClick={toggle} /> : <span className="st-gap" />}
        {g.id ? swatch(g.id) : <Icon d={unassignedIcon} size={13} />}
        <button type="button" className="st-main" data-tree-key={key} tabIndex={-1} title={`N’afficher que ${g.name} dans l’atelier`} onClick={() => p.onHome(g.id || 'none')}>
          <strong>{g.name}</strong><span className="mono">{g.id ? (single && branches[0] ? `${REPO[g.id] ?? g.id} · ${branches[0]}` : REPO[g.id] ?? '') : ''}</span>
        </button>
        <span className="st-tally">{tally.map(t => <span key={t.c} className={t.c} title={`${t.n} ${t.label}`}><i />{t.n}</span>)}</span>
        {g.id && <span className="st-acts"><button type="button" tabIndex={-1} aria-label={`Nouvelle session dans ${g.name}`} title="Nouvelle session ici" onClick={() => p.onLaunch(g.id)}><Icon d={ICONS.plus.d} size={13} /></button></span>}
      </div>
    );
    if (!open) continue;
    if (single) { tree.push(...sessions(team, 1, key, key)); continue; }
    for (const b of branches) {
      const bkey = `${key}:${b}`;
      const list = team.filter(a => workOf(a).branch === b);
      const wt = list.some(a => workOf(a).wt);
      const bopen = !closed.has(bkey);
      const btoggle = () => flip(closed, setClosed, bkey);
      nav.current.set(bkey, { toggle: btoggle, open: bopen, parent: key });
      tree.push(
        <div key={bkey} role="treeitem" aria-level={2} aria-expanded={bopen} className="st-row st-branch" style={{ '--d': 1 } as React.CSSProperties}>
          <Chevron open={bopen} label={`${bopen ? 'Replier' : 'Déplier'} ${b}`} onClick={btoggle} />
          <Icon d={branchIcon} size={13} />
          <button type="button" className="st-main mono" data-tree-key={bkey} tabIndex={-1} onClick={btoggle}><span>{b}</span></button>
          {wt && <span className="st-wt" title="Worktree lié">wt</span>}
          <span className="st-fill" />
          <span className="st-count">{list.filter(a => !hideDone || !isDone(a)).length}</span>
          <span className="st-acts">
            <button type="button" tabIndex={-1} aria-label={`Nouvelle session sur ${b}`} title="Nouvelle session ici" onClick={() => p.onLaunch(g.id)}><Icon d={ICONS.plus.d} size={13} /></button>
            <button type="button" tabIndex={-1} aria-label={`Terminal dans ${b}`} title="Ouvrir un terminal ici" onClick={() => list[0] && p.onOpen(list[0].id)}><Icon d={terminalIcon} size={13} /></button>
          </span>
        </div>
      );
      if (bopen) tree.push(...sessions(list, 2, bkey, bkey));
    }
  }

  const submitAsk = () => { const q = ask.trim(); p.onOpenChat(); if (q) { p.onAsk(q); setAsk(''); } };
  const live = mains.filter(a => !a.offline && !isDone(a)).length;

  return (
    <aside className={cls('sidebar st', dense && 'st-dense')} aria-label="Barre latérale de Ledge">
      <div className="st-brand">
        <strong>Ledge<span>.</span></strong>
        <span className="st-fill" />
        <button type="button" className="st-new" onClick={() => p.onLaunch()} aria-label="Nouvelle session"><Icon d={ICONS.plus.d} size={13} /><span>Session</span><Kbd accent>N</Kbd></button>
      </div>
      <label className={cls('st-ask', p.chatOpen && 'on')}>
        <button type="button" tabIndex={-1} className="st-mascot" aria-label="Ouvrir la conversation avec Ledge" title="Ouvrir la conversation avec Ledge" onClick={e => { e.preventDefault(); p.onOpenChat(); }}>
          <ResidentMascot size={20} theme={p.theme} paused={p.paused} />
        </button>
        <input data-ask-input type="text" aria-label="Demander à Ledge" placeholder="Demander à Ledge…" value={ask} onChange={e => setAsk(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitAsk(); } else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }} />
        <Kbd>/</Kbd>
      </label>
      <button type="button" className="st-search" onClick={p.onSearch} aria-label="Rechercher une session"><Icon d={searchIcon} size={14} /><span>Rechercher un agent, une branche…</span><Kbd>Ctrl K</Kbd></button>
      <nav className="st-views" aria-label="Vue globale">
        <button type="button" className={cls(p.atelierActive && 'on')} aria-current={p.atelierActive ? 'page' : undefined} onClick={() => p.onHome()}><Icon d={gridIcon} size={13} />Atelier<span className="st-fill" /><small>{live} actifs</small></button>
      </nav>
      <div className="st-scroll">
        {attn.length > 0 && (
          <section className="st-attn" aria-label="À toi">
            <div className="st-label"><span>À toi</span><b className="st-badge">{attn.length}</b><span className="st-fill" /><Kbd>Alt ↓</Kbd></div>
            {attnShown.map(a => {
              const parent = a.parent ? agents.find(x => x.id === a.parent) : undefined;
              return (
                <div key={a.id} className={cls('st-card', p.current === a.id && 'sel')} onContextMenu={e => p.onMenu(a.id, e)}>
                  <span className="st-bot">{p.bot(a, 18)}</span>
                  <div className="st-card-body">
                    <div className="st-l1">
                      <button type="button" className="st-name" onClick={() => p.onOpen(a.id)} aria-label={`Ouvrir ${a.name}, ${stateOf(a)}`}>{a.name}</button>
                      <span className="st-where">{swatch(a.project)}{parent ? `↳ ${parent.name}` : a.project ? projects.find(x => x.id === a.project)?.name ?? '' : a.repos}</span>
                      <span className={`st-time t-${a.state}`}>{when(a.since)}</span>
                    </div>
                    <div className="st-l2">
                      <span className="st-req" title={a.reply}>{a.task}</span>
                      {a.state === 'approval' && <>
                        <button type="button" className="st-qa pri" onClick={() => p.onDecide(a.id, true)} aria-label={`Autoriser ${a.name}`}>Oui</button>
                        <button type="button" className="st-qa" onClick={() => p.onDecide(a.id, false)} aria-label={`Refuser ${a.name}`}>Non</button>
                      </>}
                      {a.state === 'question' && <button type="button" className="st-qa" onClick={() => p.onOpen(a.id)}>Répondre</button>}
                      {a.state === 'error' && <button type="button" className="st-qa" onClick={() => p.onOpen(a.id)}>Voir</button>}
                    </div>
                  </div>
                </div>
              );
            })}
            {attn.length > 4 && <button type="button" className="st-showall" onClick={() => setAllAttn(v => !v)}>{allAttn ? 'Réduire' : `Voir les ${attn.length - 4} autres`}</button>}
          </section>
        )}
        <section aria-label="Projets">
          <div className="st-label">
            <span>Projets</span><span className="st-fill" />
            <button type="button" className={cls('st-icon', hideDone && 'on')} aria-pressed={hideDone} aria-label="Masquer les sessions terminées (H)" title="Masquer les terminées · H" onClick={toggleHide}><Icon d={eyeOffIcon} size={14} /></button>
            <button type="button" className={cls('st-icon', dense && 'on')} aria-pressed={dense} aria-label="Mode compact (D)" title="Compact · D" onClick={toggleDense}><Icon d={denseIcon} size={14} /></button>
            <button type="button" className="st-icon" aria-label="Tout replier" title="Tout replier" onClick={() => setClosed(new Set(groups.map(g => `p:${g.id || 'none'}`)))}><Icon d={foldAllIcon} size={14} /></button>
            <button type="button" className="st-icon" aria-label="Nouveau projet" title="Nouveau projet" onClick={p.onNewProject}><Icon d={ICONS.plus.d} size={14} /></button>
          </div>
          <div ref={treeRef} role="tree" aria-label="Projets, branches et sessions" className="st-tree" onKeyDown={onTreeKey}>{tree}</div>
          {p.dragging && <p className="st-help">Déposez sur un projet pour y ranger {agents.find(a => a.id === p.dragging)?.name}.</p>}
        </section>
        <section ref={archRef} className="st-archives" aria-label="Archives">
          <div className="st-label">
            <button type="button" className="st-arch-toggle" aria-expanded={archOpen} onClick={() => setArchOpen(o => !o)}>
              <span className={archOpen ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span>
              <Icon d={archiveIcon} size={13} />Archives<small>{p.archived.length || ''}</small>
            </button>
          </div>
          {archOpen && <>
            {p.archived.length > 4 && (
              <label className="st-arch-q"><Icon d={searchIcon} size={12} />
                <input type="search" aria-label="Filtrer les archives" placeholder="Filtrer les archives…" value={archQ} onChange={e => setArchQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setArchQ(''); } }} />
              </label>
            )}
            <div role="list" className="st-arch-list">
              {archShown.map(e => {
                const a = e.agent;
                const pname = projects.find(x => x.id === a.project)?.name ?? 'Sans projet';
                return (
                  <div key={a.id} role="listitem" className={cls('st-row st-agent st-arch', p.current === a.id && 'sel')} style={{ '--d': 0 } as React.CSSProperties}>
                    <span className="st-bot">{p.bot({ ...a, state: 'done' }, 16)}</span>
                    <button type="button" className="st-main" data-arch-key={a.id} aria-current={p.current === a.id ? 'page' : undefined} onClick={() => p.onRead(a.id)} aria-label={`Relire ${a.name}, ${pname}, ${a.task}, archivée ${ago(e.ago)}`}>
                      <strong>{swatch(a.project)}{a.name}</strong><span>{a.task}</span>
                    </button>
                    {e.helpers.length > 0 && <span className="st-kids" title={`${e.helpers.length} sous-agent${e.helpers.length > 1 ? 's' : ''} archivé${e.helpers.length > 1 ? 's' : ''} avec`}>{e.helpers.length}</span>}
                    <span className="st-time" title={`Archivée ${ago(e.ago)}`}>{when(e.ago)}</span>
                    <span className="st-acts">
                      <button type="button" aria-label={`Remettre ${a.name} à la table`} title="Remettre à la table" onClick={() => p.onRestore(a.id)}><Icon d={restoreIcon} size={13} /></button>
                      <button type="button" aria-label={`Reprendre ${a.name}`} title="Reprendre la conversation" onClick={() => p.onResume(a.id)}><Icon d={resumeIcon} size={13} /></button>
                      <button type="button" className="danger" aria-label={`Supprimer ${a.name}`} title="Supprimer définitivement" onClick={() => p.onDeleteArchived([a.id])}><Icon d={trashIcon} size={13} /></button>
                    </span>
                  </div>
                );
              })}
              {archShown.length === 0 && <p className="st-help">{p.archived.length ? 'Aucune archive ne correspond.' : 'Rien d’archivé pour l’instant.'}</p>}
            </div>
            <label className="st-auto">
              <span>Archiver les terminées</span>
              <select value={p.autoArchive} onChange={e => p.onAutoArchive(e.target.value)} aria-label="Archiver automatiquement les sessions terminées">
                <option value="never">à la main</option>
                <option value="1h">après 1 h</option>
                <option value="1d">après 1 jour</option>
                <option value="7d">après 7 jours</option>
              </select>
            </label>
          </>}
        </section>
        <p className="st-hint"><Kbd>↑</Kbd><Kbd>↓</Kbd>parcourir · <Kbd>←</Kbd><Kbd>→</Kbd>plier · <Kbd>E</Kbd>archiver · <Kbd>H</Kbd>terminées · <Kbd>Ctrl ⇧ E</Kbd>focus</p>
      </div>
      <div className="st-foot">
        {p.machines.map(m => (
          <button key={m.id} type="button" className="st-mach" onClick={p.onMachines} title={m.offline ? `${m.label} · hors ligne` : `${m.label} · ${m.count} agent${m.count > 1 ? 's' : ''}`}>
            <i className={cls('machine-dot', m.offline && 'off')} />{m.label}{!m.offline && <small>{m.count}</small>}
          </button>
        ))}
        <span className="st-fill" />
        <button type="button" className={cls('st-icon', p.settingsActive && 'on')} aria-label="Réglages (Ctrl ,)" title="Réglages · Ctrl ," aria-current={p.settingsActive ? 'page' : undefined} onClick={p.onSettings}><Icon d={gearIcon} size={15} /></button>
      </div>
    </aside>
  );
}
