import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';

/** The Liste: every session as an aligned row, grouped (project, machine or state), what awaits a decision first. */
export type ListAgent = { id: string; name: string; tool: 'claude' | 'codex' | 'cursor'; project: string; state: BotState; task: string; machine: string; repos: string; parent?: string; offline?: boolean; since?: number };
type ListProject = { id: string; name: string; branch: string; repos: string };
type ListMachine = { name: string; kind: string; online: boolean };
type Bucket = 'decide' | 'running' | 'done' | 'offline';
type GroupBy = 'project' | 'machine' | 'state';
type Props = {
  agents: ListAgent[]; projects: ListProject[]; machines: ListMachine[]; inScope: (a: ListAgent) => boolean; helpers: boolean;
  focusedId: string | null; setFocusedId: (id: string) => void; open: (id: string) => void; decide: (id: string, ok: boolean) => void;
  launch: (pid?: string) => void; isolate: (pid: string) => void; assign: (id: string, pid: string) => void; newProjectFrom: (a: ListAgent) => void;
  dragProps: (a: ListAgent) => object; dropProps: (pid: string) => object; dragging: string | null; dropOver: string | null;
  bot: (a: ListAgent, size: number) => React.ReactNode; status: (a: ListAgent) => React.ReactNode; onOrder: (ids: string[]) => void;
  emptyProject?: { id: string; name: string; repos: string };
};

const searchIcon = ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'm16 16 5 5'];
const machineIcon = ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'];
const densityIcon = { comfy: ['M4 5h16', 'M4 12h16', 'M4 19h16'], tight: ['M4 4h16', 'M4 8h16', 'M4 12h16', 'M4 16h16', 'M4 20h16'] };
const unassignedIcon = ['M4 7h16v12H4z', 'M4 7l2-3h4l2 3', 'M9 13h6'];
const bucketOf = (a: ListAgent): Bucket => a.offline ? 'offline' : a.state === 'approval' || a.state === 'question' ? 'decide' : a.state === 'done' ? 'done' : 'running';
const BUCKETS: { id: Bucket; label: string; group: string }[] = [{ id: 'decide', label: 'À décider', group: 'À décider' }, { id: 'running', label: 'En cours', group: 'En cours' }, { id: 'done', label: 'Terminés', group: 'Terminés' }, { id: 'offline', label: 'Hors ligne', group: 'Hors ligne' }];
const rank: Record<Bucket, number> = { decide: 0, running: 1, done: 2, offline: 3 };
/** Decisions: the longest wait first. Everything else: the most recent activity first. */
const byPriority = (a: ListAgent, b: ListAgent) => rank[bucketOf(a)] - rank[bucketOf(b)] || (bucketOf(a) === 'decide' ? (b.since ?? 0) - (a.since ?? 0) : (a.since ?? 0) - (b.since ?? 0));
const duration = (m: number) => m < 60 ? `${Math.max(1, Math.round(m))} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} j`;
const when = (a: ListAgent) => { const m = a.since ?? 0; if (bucketOf(a) === 'decide') return { text: m < 1 ? 'à l’instant' : `depuis ${duration(m)}`, title: m < 1 ? 'Demande reçue à l’instant' : `En attente depuis ${duration(m)}` }; if (m < 1) return { text: 'à l’instant', title: 'Dernière activité à l’instant' }; return { text: `il y a ${duration(m)}`, title: `${a.offline ? 'Vu pour la dernière fois' : 'Dernière activité'} il y a ${duration(m)}` } };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Marks the filter's match inside a label, when the accents fold character for character. */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>; const folded = [...text].map(c => norm(c)).join(''); const i = folded.indexOf(norm(q));
  if (i < 0 || folded.length !== text.length) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}
const stored = <T extends string>(k: string, fallback: T, allowed: readonly T[]): T => { try { const v = localStorage.getItem(k) as T | null; return v && allowed.includes(v) ? v : fallback } catch { return fallback } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window */ } };

type Row = { a: ListAgent; depth: 0 | 1; last?: boolean; context?: boolean; kids?: number; expanded?: boolean; parentName?: string };
type Group = { key: string; kind: GroupBy; label: string; projectId?: string; unassigned?: boolean; machine?: ListMachine; bucket?: Bucket; branch?: string; members: ListAgent[]; rows: Row[] };

export function SessionList(p: Props) {
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState<Bucket | 'all'>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>(() => stored('ledge-list-group', 'project', ['project', 'machine', 'state'] as const));
  const [density, setDensity] = useState<'comfy' | 'tight'>(() => stored('ledge-list-density', 'comfy', ['comfy', 'tight'] as const));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null); const [menuUp, setMenuUp] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null); const rootRef = useRef<HTMLDivElement>(null); const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => store('ledge-list-group', groupBy), [groupBy]); useEffect(() => store('ledge-list-density', density), [density]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 1800); return () => clearTimeout(t) }, [flash]);
  useEffect(() => { if (!menu) return; const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.lrow-menu')) setMenu(null) }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close) }, [menu]);
  // Sticky group headers sit under the toolbar, whose height changes when it wraps.
  useEffect(() => { const bar = barRef.current, root = rootRef.current; if (!bar || !root) return; const ro = new ResizeObserver(() => root.style.setProperty('--toolbar-h', `${bar.offsetHeight}px`)); ro.observe(bar); return () => ro.disconnect() }, []);
  // F focuses the filter (/ belongs to the chat).
  useEffect(() => { const key = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || t.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('.modal,.ledge-chat-panel')) return; e.preventDefault(); filterRef.current?.focus(); filterRef.current?.select() }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, []);

  const pool = p.agents.filter(a => p.inScope(a) && (p.helpers || !a.parent));
  const byId = (id?: string) => p.agents.find(a => a.id === id);
  const textMatch = (a: ListAgent) => !q.trim() || norm(`${a.name} ${a.task} ${a.machine} ${a.repos} ${p.projects.find(x => x.id === a.project)?.name ?? 'sans projet'}`).includes(norm(q.trim()));
  const textPool = pool.filter(textMatch);
  const counts = Object.fromEntries(BUCKETS.map(b => [b.id, textPool.filter(a => bucketOf(a) === b.id).length])) as Record<Bucket, number>;
  const matches = (a: ListAgent) => textMatch(a) && (bucket === 'all' || bucketOf(a) === bucket);
  const filtering = Boolean(q.trim()) || bucket !== 'all';
  const childrenOf = (a: ListAgent) => p.helpers ? pool.filter(b => b.parent === a.id).sort(byPriority) : [];

  /** Principals with their sub-agents nested under them; a principal stays as context when only a sub-agent matches. */
  const treeRows = (members: ListAgent[]): Row[] => members.filter(a => !a.parent).sort(byPriority).flatMap(a => {
    const kids = childrenOf(a); const kidHits = kids.filter(matches); const self = matches(a);
    if (!self && !kidHits.length) return [];
    const auto = kids.some(k => bucketOf(k) === 'decide'); const expanded = (filtering && kidHits.length > 0) || (auto !== toggled.has(a.id));
    const shown = expanded ? (filtering ? kidHits : kids) : [];
    return [{ a, depth: 0 as const, context: !self, kids: kids.length, expanded }, ...shown.map((k, i) => ({ a: k, depth: 1 as const, last: i === shown.length - 1 }))];
  });
  const groups: Group[] = (() => {
    if (groupBy === 'state') return BUCKETS.map(b => { const members = pool.filter(a => bucketOf(a) === b.id); return { key: 'state-' + b.id, kind: 'state' as const, label: b.group, bucket: b.id, members, rows: members.filter(matches).sort(byPriority).map(a => ({ a, depth: 0 as const, parentName: byId(a.parent)?.name })) } });
    if (groupBy === 'machine') { const names = [...p.machines.map(m => m.name), ...pool.map(a => a.machine)].filter((n, i, all) => all.indexOf(n) === i); return names.map(n => { const members = pool.filter(a => a.machine === n); return { key: 'machine-' + n, kind: 'machine' as const, label: n, machine: p.machines.find(m => m.name === n) ?? { name: n, kind: '', online: true }, members, rows: treeRows(members) } }) }
    const projects: Group[] = p.projects.map(x => { const members = pool.filter(a => a.project === x.id); return { key: 'project-' + x.id, kind: 'project' as const, label: x.name, projectId: x.id, branch: x.branch, members, rows: treeRows(members) } });
    const loose = pool.filter(a => !a.project);
    return [...projects, { key: 'project-none', kind: 'project' as const, label: 'Sans projet', unassigned: true, members: loose, rows: treeRows(loose) }];
  })();
  const visible = groups.filter(g => g.members.length > 0 && g.rows.length > 0);
  const order = visible.flatMap(g => collapsed.has(g.key) ? [] : g.rows.map(r => r.a.id));
  const orderKey = order.join(',');
  useEffect(() => { p.onOrder(order) }, [orderKey]);
  useEffect(() => () => p.onOrder([]), []);

  const toggleGroup = (k: string) => setCollapsed(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n });
  const toggleKids = (id: string) => setToggled(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n });
  const reply = (id: string) => { p.open(id); setTimeout(() => document.querySelector<HTMLElement>('.decision-card button,[aria-label="Répondre à l’agent"]:not(:disabled)')?.focus(), 60) };
  const decide = (a: ListAgent, ok: boolean) => { p.decide(a.id, ok); setFlash(a.id) };
  const clear = () => { setQ(''); setBucket('all') };
  const focusRow = (id?: string) => { if (!id) return; p.setFocusedId(id); document.querySelector<HTMLElement>(`.list-view [data-agent="${id}"]`)?.focus() };
  const summary = (members: ListAgent[]) => { const n = (b: Bucket) => members.filter(a => bucketOf(a) === b).length; const d = n('decide'), r = n('running'), f = n('done'), o = n('offline');
    return <span className="g-summary">{d > 0 && <span className="g-alert">{d} à décider</span>}<span className="muted">{[r && `${r} en cours`, f && `${f} terminé${f > 1 ? 's' : ''}`, o && `${o} hors ligne`].filter(Boolean).join(' · ')}</span></span> };

  const header = (g: Group) => { const shut = collapsed.has(g.key); const drop = g.projectId ? p.dropProps(g.projectId) : {};
    return <div className={`lgroup-head ${p.dropOver === g.projectId ? 'drop-over' : ''}`} {...drop}>
      <button className="g-toggle" aria-expanded={!shut} aria-label={`${shut ? 'Déplier' : 'Replier'} ${g.label}`} onClick={() => toggleGroup(g.key)}><Icon d={ICONS.chevronRight.d} size={13} /></button>
      {g.kind === 'project' ? g.unassigned ? <Icon d={unassignedIcon} size={14} /> : <i className={`side-swatch swatch-${g.projectId}`} /> : g.kind === 'machine' ? <i className={`machine-dot ${g.machine?.online ? '' : 'off'}`} /> : <i className={`g-dot dot-${g.bucket}`} />}
      {g.projectId ? <button className="g-name" title={`Voir seulement ${g.label}`} onClick={() => p.isolate(g.projectId!)}>{g.label}</button> : <strong className="g-name">{g.label}</strong>}
      {g.branch && <span className="g-branch mono" title={`Branche ${g.branch}`}>⎇ {g.branch}</span>}
      {g.machine && <span className="g-branch">{g.machine.online ? g.machine.kind : 'Hors ligne'}</span>}
      <span className="g-count mono">{g.rows.filter(r => !r.context).length}{filtering && g.rows.length !== g.members.length ? `/${g.members.length}` : ''}</span>
      {g.kind !== 'state' && summary(g.members)}
      {g.unassigned && <span className="g-help muted">{p.dragging ? 'Déposez sur un projet de la barre latérale ou sur son groupe.' : 'Glissez vers un projet, ou « Ranger dans… ».'}</span>}
      {p.dragging && g.projectId && <span className="drop-hint">{p.dropOver === g.projectId ? `Lâcher pour ranger ${byId(p.dragging)?.name}` : 'Déposer ici'}</span>}
      <span className="spacer" />
      {g.projectId && <button type="button" className="g-add" aria-label={`Nouvelle session dans ${g.label}`} onClick={() => p.launch(g.projectId)}><Icon d={ICONS.plus.d} size={13} /><span>Nouvelle session</span></button>}
    </div> };

  const row = (g: Group, r: Row) => { const a = r.a; const b = bucketOf(a); const w = when(a); const proj = p.projects.find(x => x.id === a.project); const loose = !a.project && !a.parent; const ctx = g.kind === 'machine' ? null : a.machine; const needs = !a.offline && !a.parent && b === 'decide';
    return <div key={a.id} role="listitem" tabIndex={0} data-agent={a.id} {...(loose ? p.dragProps(a) : {})}
      className={`lrow b-${b} s-${a.state} ${a.parent && g.kind !== 'state' ? 'child' : ''} ${r.last ? 'last' : ''} ${r.context ? 'context' : ''} ${p.focusedId === a.id ? 'keyboard-selected' : ''} ${flash === a.id ? 'flash' : ''} ${menu === a.id ? 'menu-open' : ''} ${p.dragging === a.id ? 'is-dragged' : ''}`}
      aria-label={`${a.name}, ${a.task}, ${BUCKETS.find(x => x.id === b)!.label.toLowerCase()}, ${a.machine}`}
      onFocus={e => { if (e.target === e.currentTarget) p.setFocusedId(a.id) }} onClick={e => { if (!(e.target as HTMLElement).closest('button,a,.lrow-menu')) p.open(a.id) }}>
      {loose && <span className="drag-grip" aria-hidden="true" title="Glisser vers un projet"><i /><i /><i /><i /><i /><i /></span>}
      <span className="r-bot">{p.bot(a, a.parent && g.kind !== 'state' ? 24 : density === 'tight' ? 24 : 32)}</span>
      <span className="r-name"><strong><Hl text={a.name} q={q} /></strong>
        {r.kids ? <button className="kids-chip" aria-expanded={r.expanded} aria-label={`${r.expanded ? 'Masquer' : 'Afficher'} ${r.kids} sous-agent${r.kids > 1 ? 's' : ''}`} title={`${r.kids} sous-agent${r.kids > 1 ? 's' : ''}`} onClick={() => toggleKids(a.id)}><Icon d={ICONS.chevronRight.d} size={10} />{r.kids}</button> : r.parentName ? <small className="muted">↳ {r.parentName}</small> : null}</span>
      <span className="r-task"><span className="r-title" title={a.task}><Hl text={a.task} q={q} /></span>
        <small className="r-repo mono">{g.kind === 'state' && <>{proj ? <i className={`side-swatch swatch-${proj.id}`} /> : <i className="filter-none" />}<span className="r-proj">{proj?.name ?? 'Sans projet'}</span><span className="sep">·</span></>}<Hl text={a.repos} q={q} /></small></span>
      <span className="r-state">{p.status(a)}</span>
      <span className="r-ctx">{ctx ? <><Icon d={machineIcon} size={12} /><Hl text={ctx} q={q} /></> : <>{proj ? <i className={`side-swatch swatch-${proj.id}`} /> : <i className="filter-none" />}{proj?.name ?? 'Sans projet'}</>}</span>
      <span className={`r-when ${b === 'decide' ? 'waiting' : ''}`} title={w.title}>{w.text}</span>
      <span className="r-actions">
        {!a.offline && a.state === 'approval' && !a.parent && <><Button variant="primary" size="sm" onClick={() => decide(a, true)}>Autoriser</Button><Button size="sm" onClick={() => decide(a, false)}>Refuser</Button></>}
        {!a.offline && a.state === 'question' && !a.parent && <Button variant="primary" size="sm" onClick={() => reply(a.id)}>Répondre</Button>}
        {loose && <span className="lrow-menu assign-wrap"><Button size="sm" aria-haspopup="menu" aria-expanded={menu === a.id} onClick={e => { setMenuUp(e.currentTarget.getBoundingClientRect().bottom > window.innerHeight * 0.55); setMenu(menu === a.id ? null : a.id) }}><Icon d={ICONS.folder.d} size={13} />Ranger dans…</Button>
          {menu === a.id && <div className={`assign-menu ${menuUp ? 'up' : ''}`} role="menu">{p.projects.map(x => <button key={x.id} role="menuitem" onClick={() => { setMenu(null); p.assign(a.id, x.id) }}>{x.name}<small>{x.repos}</small></button>)}<button role="menuitem" className="assign-new" onClick={() => { setMenu(null); p.newProjectFrom(a) }}><span><Icon d={ICONS.plus.d} size={12} />Nouveau projet…</span><small>À partir de {a.repos}</small></button></div>}</span>}
        <Button variant="ghost" size="sm" className="r-open" title="Ouvrir la session (Entrée)" onClick={() => p.open(a.id)}>Ouvrir{!(needs || loose) && <Kbd>Entrée</Kbd>}</Button>
      </span>
    </div> };

  const total = pool.length;
  return <div ref={rootRef} className={`list-view density-${density} group-${groupBy}`}>
    <div ref={barRef} className="list-toolbar">
      <label className="list-filter"><Icon d={searchIcon} size={14} /><input ref={filterRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Agent, tâche, machine, dépôt…" aria-label="Filtrer les sessions"
        onKeyDown={e => { if (e.key === 'Escape' && (q || bucket !== 'all')) { e.preventDefault(); e.stopPropagation(); clear() } else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur() } else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); focusRow(order[0]) } }} />
        {q ? <button className="filter-clear" aria-label="Effacer le filtre" onClick={() => { setQ(''); filterRef.current?.focus() }}><Icon d={ICONS.close.d} size={12} /></button> : <Kbd>F</Kbd>}</label>
      <div className="state-chips" role="group" aria-label="Filtrer par état">
        <button aria-pressed={bucket === 'all'} onClick={() => setBucket('all')}>Tous<span className="mono">{textPool.length}</span></button>
        {BUCKETS.filter(b => b.id !== 'offline' || counts.offline > 0 || bucket === 'offline').map(b => <button key={b.id} className={`chip-${b.id}`} aria-pressed={bucket === b.id} disabled={!counts[b.id] && bucket !== b.id} onClick={() => setBucket(bucket === b.id ? 'all' : b.id)}><i className={`g-dot dot-${b.id}`} />{b.label}<span className="mono">{counts[b.id]}</span></button>)}
      </div>
      <span className="spacer" />
      <div className="seg" role="radiogroup" aria-label="Grouper par"><span className="seg-label">Grouper</span>{([['project', 'Projet'], ['machine', 'Machine'], ['state', 'État']] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={groupBy === v} onClick={() => setGroupBy(v)}>{l}</button>)}</div>
      <Button variant="ghost" size="icon" className="density-toggle" aria-pressed={density === 'tight'} aria-label={density === 'tight' ? 'Lignes confortables' : 'Lignes compactes'} title={density === 'tight' ? 'Lignes confortables' : 'Lignes compactes'} onClick={() => setDensity(density === 'tight' ? 'comfy' : 'tight')}><Icon d={densityIcon[density === 'tight' ? 'comfy' : 'tight']} size={15} /></Button>
    </div>
    {p.emptyProject ? <div className="list-empty"><i className={`side-swatch swatch-${p.emptyProject.id}`} /><h2>Aucune session dans {p.emptyProject.name}</h2><p className="muted">Le projet se remplira dès qu’une session démarre dans {p.emptyProject.repos}.</p><Button variant="primary" onClick={() => p.launch(p.emptyProject!.id)}><Icon d={ICONS.plus.d} size={14} />Nouvelle session</Button></div>
      : !visible.length ? <div className="list-empty"><Icon d={searchIcon} size={20} /><h2>{total ? 'Aucune session ne correspond' : 'Aucune session'}</h2><p className="muted">{total ? <>{q.trim() && <>Rien pour « {q.trim()} »</>}{q.trim() && bucket !== 'all' && ' parmi '}{bucket !== 'all' && <>les sessions « {BUCKETS.find(b => b.id === bucket)!.label.toLowerCase()} »</>}.</> : 'Lancez une session pour la voir ici.'}</p>{total ? <Button onClick={clear}>Effacer les filtres</Button> : <Button variant="primary" onClick={() => p.launch()}><Icon d={ICONS.plus.d} size={14} />Nouvelle session</Button>}</div>
      : visible.map(g => <section key={g.key} className={`lgroup ${collapsed.has(g.key) ? 'collapsed' : ''} ${g.unassigned ? 'unassigned' : ''} ${p.dropOver === g.projectId ? 'drop-over' : ''}`} aria-label={g.label} data-project={g.projectId}>
        {header(g)}
        {!collapsed.has(g.key) && <div role="list" className="lgroup-rows" {...(g.projectId ? p.dropProps(g.projectId) : {})}>{g.rows.map(r => row(g, r))}</div>}
      </section>)}
    {visible.length > 0 && <p className="list-foot muted"><Kbd>J</Kbd><Kbd>K</Kbd> parcourir · <Kbd>Entrée</Kbd> ouvrir · <Kbd>F</Kbd> filtrer · les demandes en attente passent en tête de chaque groupe.</p>}
  </div>;
}
