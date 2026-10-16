import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Badge } from '../../../apps/overlay/src/ui/Badge';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { ThreadMarkdown, MarkdownDocument } from '../../../apps/overlay/src/documents/MarkdownDocument';
import type { DocumentReference } from '../../../apps/overlay/src/documents/references';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';
import { DOCS, type Item, type Pending, type Thread, type ToolItem, type Turn, type Change, type Todo } from './sessions-data';

/** The session page's content (spec 2026-10-16 desktop atelier): what the agent did (the thread by turn), what it
 *  changed (Modifications), and the request waiting for you, pinned above the reply field. All of it simulated. */
export type SessionAgent = { id: string; name: string; tool: 'claude' | 'codex' | 'cursor'; state: BotState; task: string; machine: string; repos: string; parent?: string; offline?: boolean; since?: number };
type Props = {
  agent: SessionAgent; agents: SessionAgent[]; thread: Thread;
  /** Updates this session's thread in the app's state: it keeps working after the page closes (a simulated reply). */
  update: (fn: (t: Thread) => Thread) => void;
  setAgentState: (state: BotState, reply?: string) => void;
  bot: (a: SessionAgent, size: number) => ReactNode;
  open: (id: string) => void; notify: (s: string) => void; openMachines: () => void;
  headingExtra?: ReactNode;
  /** The app's key handler asks the page first (never while typing): Y / N, 1…9, J / K, Échap. */
  keys: React.MutableRefObject<((k: string) => boolean) | null>;
  onSeen: () => void;
};

const fileIcon = ['M14 3H6v18h12V8z', 'M14 3v5h4', 'M9 13h6', 'M9 17h6'];
const searchIcon = ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'm16 16 5 5'];
const terminalIcon = ['m4 6 5 6-5 6', 'M12 18h8'];
const pencilIcon = ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'];
const chevronDown = ['m6 9 6 6 6-6'];
const arrowDown = ['M12 5v14', 'm19 12-7 7-7-7'];
const copyIcon = ['M9 9h11v11H9z', 'M5 15H4V4h11v1'];
const subagentsIcon = ['M4 4h7v6H4z', 'M13 14h7v6h-7z', 'M7.5 10v7H13'];
const diffIcon = ['M12 3v8', 'M8 7h8', 'M8 17h8', 'M5 21h14'];
const threadIcon = ['M4 6h16', 'M4 12h10', 'M4 18h13'];
const planIcon = ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'm9 12 1.5 1.5L14 10', 'M9 17h6'];
const splitIcon = ['M3 4h18v16H3z', 'M12 4v16'];
const offlineIcon = ['M2 8.8a15 15 0 0 1 4.2-2.6', 'M22 8.8A15 15 0 0 0 10.4 5.1', 'M5 12.6a10 10 0 0 1 5.3-2.5', 'M19 12.6a10 10 0 0 0-2.4-1.6', 'M8.5 16.4a5 5 0 0 1 7 0', 'M12 20h.01', 'M3 3l18 18'];

type Kind = 'read' | 'search' | 'command' | 'edit';
const kindOf = (t: ToolItem): Kind => /^(Edit|Write|MultiEdit|Delete)$/.test(t.tool) ? 'edit' : /^(Grep|Glob|WebFetch|WebSearch)$/.test(t.tool) ? 'search' : t.tool === 'Read' ? 'read' : 'command';
const KIND: Record<Kind, { icon: string[]; one: string; many: string }> = {
  read: { icon: fileIcon, one: 'lecture', many: 'lectures' }, search: { icon: searchIcon, one: 'recherche', many: 'recherches' },
  command: { icon: terminalIcon, one: 'commande', many: 'commandes' }, edit: { icon: pencilIcon, one: 'modification', many: 'modifications' }
};
const verb = (t: ToolItem) => t.files?.[0]?.change === 'add' ? 'Création' : t.files?.[0]?.change === 'delete' ? 'Suppression' : { read: 'Lecture', search: 'Recherche', command: 'Commande', edit: 'Modification' }[kindOf(t)];
const CHANGE: Record<Change, { letter: string; label: string }> = { add: { letter: 'A', label: 'Ajouté' }, edit: { letter: 'M', label: 'Modifié' }, write: { letter: 'M', label: 'Réécrit' }, delete: { letter: 'D', label: 'Supprimé' } };
const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;
/** "0,4 s", "6,8 s", "48 s", "2 min 14 s", "1 h 35". */
export function fmtDur(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1).replace('.', ',')} s`;
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), r = t % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')}`;
  return m ? (r ? `${m} min ${r} s` : `${m} min`) : `${r} s`;
}
const sinceLabel = (min = 0) => min < 1 ? 'à l’instant' : min < 60 ? `il y a ${min} min` : `il y a ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
const toolMs = (t: ToolItem, now: number) => t.durationMs ?? (t.startedAt ? Math.max(0, now - t.startedAt) : 0);
const clock = () => new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const noop = () => {};

/* ---------- Diffs ---------- */
type DLine = { t: 'ctx' | 'add' | 'del'; o?: number; n?: number; text: string };
type Hunk = { o: number; n: number; ctx: string; lines: DLine[] };
export function parseDiff(diff: string): Hunk[] {
  const hunks: Hunk[] = []; let h: Hunk | null = null, o = 0, n = 0;
  for (const raw of diff.split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(raw);
    if (head) { o = Number(head[1]); n = Number(head[2]); if (o === 0) o = 1; h = { o, n, ctx: head[3] ?? '', lines: [] }; hunks.push(h); continue; }
    if (!h) continue;
    const c = raw[0], text = raw.slice(1);
    if (c === '+') h.lines.push({ t: 'add', n: n++, text });
    else if (c === '-') h.lines.push({ t: 'del', o: o++, text });
    else h.lines.push({ t: 'ctx', o: o++, n: n++, text });
  }
  return hunks;
}
const counts = (diff: string) => { let plus = 0, minus = 0; for (const h of parseDiff(diff)) for (const l of h.lines) { if (l.t === 'add') plus++; else if (l.t === 'del') minus++; } return { plus, minus }; };
const Delta = ({ plus, minus }: { plus: number; minus: number }) => <span className="delta mono"><span className="plus">+{plus}</span><span className="minus">−{minus}</span></span>;

/* ---------- Thread helpers ---------- */
const lastTurn = (t: Thread) => t.turns[t.turns.length - 1];
const pushItems = (t: Thread, ...items: Item[]): Thread => ({ ...t, turns: t.turns.map((tu, i) => i === t.turns.length - 1 ? { ...tu, items: [...tu.items, ...items] } : tu) });
const patchTool = (t: Thread, id: string, patch: Partial<ToolItem>): Thread => ({ ...t, turns: t.turns.map(tu => ({ ...tu, items: tu.items.map(it => it.id === id && it.kind === 'tool' ? { ...it, ...patch } : it) })) });
const tools = (items: Item[]) => items.filter((i): i is ToolItem => i.kind === 'tool');
const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
/** A flat thread: every exchange stays open in full, separated only by its time. The body: consecutive tool calls fold into one group; messages, decisions and sub-agent launches stand between. */
/** Task-list updates (TodoWrite) are not rows: the latest list sits on top of the thread, earlier ones fold into the summary. */
type TodosItem = Extract<Item, { kind: 'todos' }>;
type Seg = { kind: 'tools'; id: string; items: ToolItem[]; todos: TodosItem[] } | { kind: 'item'; item: Item };
function segments(items: Item[]): Seg[] {
  const out: Seg[] = [];
  for (const it of items) {
    if (it.kind === 'prompt') continue;
    const last = out[out.length - 1];
    if (it.kind === 'tool' || it.kind === 'todos') {
      const g = last?.kind === 'tools' ? last : (out.push({ kind: 'tools', id: 'g-' + it.id, items: [], todos: [] }), out[out.length - 1] as Extract<Seg, { kind: 'tools' }>);
      if (it.kind === 'tool') g.items.push(it); else g.todos.push(it);
    } else out.push({ kind: 'item', item: it });
  }
  return out;
}
const done = (l: Todo[]) => l.filter(t => t.status === 'completed').length;
const stepsOf = (md: string) => [...md.matchAll(/^\d+\. (?:\*\*(.+?)\*\*)?(.*)$/gm)].map(m => (m[1] ?? m[2] ?? '').replace(/^ — /, '').trim());

/* ---------- Thread pieces ---------- */
function Summary({ list, now, open, onToggle, live, todos = 0 }: { list: ToolItem[]; now: number; open: boolean; onToggle?: () => void; live?: boolean; todos?: number }) {
  const by = (k: Kind) => list.filter(t => kindOf(t) === k).length;
  const files = new Set(list.flatMap(t => (t.status === 'success' ? t.files ?? [] : []).map(f => f.path))).size;
  const failed = list.filter(t => t.status === 'failed').length, cut = list.filter(t => t.status === 'unknown').length;
  const total = list.reduce((s, t) => s + toolMs(t, now), 0);
  return <button className={`action-summary ${open ? 'open' : ''}`} onClick={onToggle} aria-expanded={open} disabled={!onToggle}>
    <Icon d={chevronDown} size={13} />
    <span className="summary-count">{list.length ? plural(list.length, 'action') : 'Plan de travail mis à jour'}</span>
    <span className="kind-chips">{(['read', 'search', 'command', 'edit'] as Kind[]).map(k => by(k) ? <span key={k} className={`kind-chip kind-${k}`} title={plural(by(k), KIND[k].one, KIND[k].many)}><Icon d={KIND[k].icon} size={12} />{by(k)}</span> : null)}</span>
    {files > 0 && <span className="summary-meta">· {plural(files, 'fichier modifié', 'fichiers modifiés')}</span>}
    {failed > 0 && <span className="summary-failed">· {plural(failed, 'échec')}</span>}
    {cut > 0 && <span className="summary-meta">· {plural(cut, 'interrompue', 'interrompues')}</span>}
    {todos > 0 && list.length > 0 && <span className="summary-meta">· plan de travail mis à jour{todos > 1 ? ` ×${todos}` : ''}</span>}
    <span className="spacer" />
    {list.length > 0 && <span className="summary-meta mono">{live ? 'en cours · ' : ''}{fmtDur(total)}</span>}
  </button>;
}

function ActionRow({ t, now, spin, expanded, onExpand, onDiff, flash }: { t: ToolItem; now: number; spin: string; expanded: boolean; onExpand: () => void; onDiff: (path: string) => void; flash: boolean }) {
  const k = kindOf(t); const detail = t.status === 'running' ? undefined : t.error ?? t.output;
  const f = t.files?.[0];
  return <div className={`action-row status-${t.status} ${flash ? 'flash' : ''}`} data-tool={t.id}>
    <div className="action-line">
      <span className={`action-mark mark-${t.status}`} aria-label={{ running: 'En cours', success: 'Réussi', failed: 'Échec', unknown: 'Interrompu' }[t.status]}>{t.status === 'running' ? spin : t.status === 'success' ? '✓' : t.status === 'failed' ? '✕' : '·'}</span>
      <span className={`action-kind kind-${k}`}><Icon d={KIND[k].icon} size={13} /></span>
      <span className="action-verb">{verb(t)}</span>
      <button className="action-target mono" title={t.label} onClick={detail ? onExpand : undefined} aria-expanded={detail ? expanded : undefined} disabled={!detail}>{t.label}</button>
      {f && f.plus !== undefined && <Delta plus={f.plus} minus={f.minus ?? 0} />}
      {f && t.status === 'success' && <button className="action-link" onClick={() => onDiff(f.path)}>Voir la modification</button>}
      <span className="action-time mono">{t.status === 'unknown' ? 'interrompu' : fmtDur(toolMs(t, now))}</span>
    </div>
    {expanded && detail && <pre className={`action-output ${t.error ? 'is-error' : ''}`}>{detail}</pre>}
  </div>;
}

function Chip({ item }: { item: Extract<Item, { kind: 'permission' | 'answer' }> }) {
  if (item.kind === 'answer') return <div className="decision-chip answer"><Icon d={ICONS.send.d} size={12} /><span>Vous avez répondu</span><strong>{item.text}</strong></div>;
  if (item.tool === 'ExitPlanMode') { const ok = item.decision !== 'deny'; return <div className={`decision-chip plan ${item.decision}`}><span className="chip-mark">{ok ? '✓' : '↺'}</span><span>{ok ? (item.decision === 'always' ? 'Plan approuvé · modifications acceptées automatiquement' : 'Plan approuvé') : 'Plan à revoir'}</span><strong>{item.text}</strong></div>; }
  const d = { accept: ['✓', 'Accordé'], always: ['✓', 'Toujours autorisé'], deny: ['✕', 'Refusé'], unknown: ['·', 'Répondu dans le terminal'] }[item.decision];
  return <div className={`decision-chip ${item.decision}`}><span className="chip-mark">{d[0]}</span><span>{d[1]}</span><code>{item.text}</code></div>;
}

/* ---------- Diff viewer ---------- */
function DiffView({ diff }: { diff: string }) {
  const hunks = useMemo(() => parseDiff(diff), [diff]);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const rows: ReactNode[] = [];
  hunks.forEach((h, hi) => {
    const prev = hunks[hi - 1];
    if (prev) { const end = prev.o + prev.lines.filter(l => l.t !== 'add').length; const gap = h.o - end; if (gap > 0) rows.push(<div key={'gap' + hi} className="diff-gap">⋯ {plural(gap, 'ligne non modifiée', 'lignes non modifiées')} (lignes {end}–{h.o - 1})</div>); }
    const oc = h.lines.filter(l => l.t !== 'add').length, nc = h.lines.filter(l => l.t !== 'del').length;
    rows.push(<div key={'h' + hi} className="diff-hunk mono"><span>@@ -{h.o},{oc} +{h.n},{nc} @@</span>{h.ctx && <span className="hunk-ctx">{h.ctx}</span>}</div>);
    // Unchanged runs keep 3 lines next to each change; longer runs fold, and unfold on demand.
    let i = 0;
    while (i < h.lines.length) {
      if (h.lines[i]!.t !== 'ctx') { const l = h.lines[i]!; rows.push(<Line key={hi + ':' + i} l={l} />); i++; continue; }
      let j = i; while (j < h.lines.length && h.lines[j]!.t === 'ctx') j++;
      const keepHead = i === 0 ? 0 : 3, keepTail = j === h.lines.length ? 0 : 3;
      const key = `${hi}:${i}`;
      const hidden = j - i - keepHead - keepTail;
      if (hidden >= 3 && !shown.has(key)) {
        for (let x = i; x < i + keepHead; x++) rows.push(<Line key={hi + ':' + x} l={h.lines[x]!} />);
        rows.push(<button key={'fold' + key} className="diff-fold" onClick={() => setShown(s => new Set(s).add(key))}><Icon d={['M12 5v14', 'm8 9 4-4 4 4', 'm8 15 4 4 4-4']} size={12} />Afficher {plural(hidden, 'ligne inchangée', 'lignes inchangées')}</button>);
        for (let x = j - keepTail; x < j; x++) rows.push(<Line key={hi + ':' + x} l={h.lines[x]!} />);
      } else for (let x = i; x < j; x++) rows.push(<Line key={hi + ':' + x} l={h.lines[x]!} />);
      i = j;
    }
  });
  return <div className="diff-view mono" role="table" aria-label="Différences">{rows}</div>;
}
function Line({ l }: { l: DLine }) {
  return <div className={`diff-line ${l.t}`} role="row"><span className="ln">{l.o ?? ''}</span><span className="ln">{l.n ?? ''}</span><span className="sign">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span><span className="code">{l.text || ' '}</span></div>;
}

/* ---------- The page ---------- */
export function SessionPage(p: Props) {
  const { agent, thread } = p;
  const parent = p.agents.find(a => a.id === agent.parent);
  const pending: Pending | undefined = !agent.offline && (agent.state === 'approval' || agent.state === 'question') ? thread.pending : undefined;
  /** The side pane beside the thread: documents, diffs and plans, one tab each. */
  type Tab = { kind: 'doc' | 'diff' | 'plan'; key: string };
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [split, setSplitState] = useState<number>(() => { try { const v = Number(localStorage.getItem('ledge-mock-split')); return v >= 0.3 && v <= 0.72 ? v : 0.5; } catch { return 0.5; } });
  const setSplit = (v: number) => { const x = Math.min(0.72, Math.max(0.3, v)); setSplitState(x); try { localStorage.setItem('ledge-mock-split', String(x)); } catch { /* per-viewer convenience only */ } };
  const tabId = (t: Tab) => t.kind + ':' + t.key;
  const openTab = (t: Tab) => { setTabs(ts => ts.some(x => tabId(x) === tabId(t)) ? ts : [...ts, t]); setActiveTab(tabId(t)); if (view !== 'thread') switchView('thread'); };
  const closeTab = (id: string) => setTabs(ts => { const i = ts.findIndex(x => tabId(x) === id); const next = ts.filter(x => tabId(x) !== id); if (activeTab === id) setActiveTab(next.length ? tabId(next[Math.min(i, next.length - 1)]!) : null); return next; });
  const active = tabs.find(t => tabId(t) === activeTab);
  const [todoOpen, setTodoOpen] = useState(false);
  const replyRef = useRef<HTMLDivElement>(null);
  const [replyH, setReplyH] = useState(0);
  const [view, setView] = useState<'thread' | 'changes'>('thread');
  const lastId = lastTurn(thread)?.id;
  const [openTurns, setOpenTurns] = useState<Set<string>>(() => new Set([lastId ?? '', ...thread.turns.filter(t => t.items.some(i => i.id === thread.unreadFrom)).map(t => t.id)]));
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [frame, setFrame] = useState(0);
  const [fileListOpen, setFileListOpen] = useState(false);
  const unread = useRef(thread.unreadFrom);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const allTools = thread.turns.flatMap(t => tools(t.items));
  const running = allTools.some(t => t.status === 'running') && !agent.offline;
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => set(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // A new last turn opens itself (a reply sent, a turn started by the simulation).
  useEffect(() => { if (lastId) setOpenTurns(s => s.has(lastId) ? s : new Set(s).add(lastId)); }, [lastId]);
  useEffect(() => () => p.onSeen(), []);
  useEffect(() => { if (!running) return; const a = setInterval(() => setNow(Date.now()), 1000), b = setInterval(() => setFrame(f => (f + 1) % 10), 90); return () => { clearInterval(a); clearInterval(b); }; }, [running]);
  // A live turn: the running tool ends and the next one starts, while the page is open (Milo).
  useEffect(() => {
    if (!thread.script?.length || agent.state !== 'working' || agent.offline) return;
    const id = setTimeout(() => p.update(t => {
      const run = tools(lastTurn(t)?.items ?? []).find(x => x.status === 'running');
      if (!run || !t.script?.length) return t;
      const [next, ...rest] = t.script;
      return { ...pushItems(patchTool(t, run.id, { status: 'success', durationMs: toolMs(run, Date.now()) }), { ...next!, startedAt: Date.now() }), script: rest };
    }), 6500);
    return () => clearTimeout(id);
  }, [thread, agent.state]);

  /* Scrolling: open on the "Nouveau" marker, or at the end; follow the end while the reader is there. */
  const saved = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current; if (!el || view !== 'thread') return;
    if (saved.current !== null) { el.scrollTop = saved.current; onScroll(); return; }
    const mark = el.querySelector<HTMLElement>('.unread-marker');
    if (mark) el.scrollTop = Math.max(0, el.scrollTop + mark.getBoundingClientRect().top - el.getBoundingClientRect().top - 120); else el.scrollTop = el.scrollHeight;
    onScroll();
  }, [view]);
  const switchView = (v: 'thread' | 'changes') => { if (v === view) return; if (view === 'thread' && scroller.current) saved.current = scroller.current.scrollTop; if (v === 'thread' && flash) saved.current = null; setView(v); };
  const follow = useRef(false);
  useEffect(() => { const el = scroller.current; if (el && (atBottom || follow.current) && view === 'thread') { el.scrollTo({ top: el.scrollHeight }); follow.current = false; } }, [thread, pending]);
  const onScroll = () => { const el = scroller.current; if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60); };
  const toBottom = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });

  /* Files touched in the session, in the order the thread first touched them. */
  const files = useMemo(() => {
    const order: string[] = [];
    for (const t of allTools) for (const f of t.files ?? []) if (t.status === 'success' && !order.includes(f.path) && thread.files[f.path]) order.push(f.path);
    for (const path of Object.keys(thread.files)) if (!order.includes(path)) order.push(path);
    return order.map(path => ({ path, ...thread.files[path]!, ...counts(thread.files[path]!.diff), touches: thread.turns.flatMap((tu, ti) => tools(tu.items).filter(x => x.files?.some(f => f.path === path)).map(x => ({ tool: x, turn: ti + 1 }))) }));
  }, [thread]);
  const [file, setFile] = useState<string | null>(null);
  const currentFile = files.find(f => f.path === file) ?? files[0];
  const fileIndex = currentFile ? files.indexOf(currentFile) : -1;
  const showDiff = (path: string) => openTab({ kind: 'diff', key: path });
  const showAllChanges = (path: string) => { setFile(path); switchView('changes'); };
  const stepFile = (d: 1 | -1) => { if (!files.length) return; setFile(files[(fileIndex + d + files.length) % files.length]!.path); };
  /** From a file back to the action that changed it: open its turn and group, scroll to it, flash it. */
  const showInThread = (toolId: string) => {
    const turn = thread.turns.find(t => t.items.some(i => i.id === toolId)); if (!turn) return;
    const seg = segments(turn.items).find(s => s.kind === 'tools' && s.items.some(x => x.id === toolId));
    setOpenTurns(s => new Set(s).add(turn.id)); if (seg?.kind === 'tools') setOpenGroups(s => new Set(s).add(seg.id));
    saved.current = null; setView('thread'); setFlash(toolId);
  };
  useEffect(() => { if (!flash || view !== 'thread') return; requestAnimationFrame(() => scroller.current?.querySelector(`[data-tool="${flash}"]`)?.scrollIntoView({ block: 'center' })); const t = setTimeout(() => setFlash(null), 1800); return () => clearTimeout(t); }, [flash, view]);

  /* ---------- Answering (simulated) ---------- */
  const later = (ms: number, fn: () => void) => { setTimeout(fn, ms); };
  const resolveApproval = (decision: 'accept' | 'deny' | 'always', note?: string) => {
    if (pending?.kind !== 'approval') return;
    const cmd = pending.command, tool = pending.tool === 'Action' ? 'Bash' : pending.tool, runId = uid('run');
    const ok = decision !== 'deny'; follow.current = true;
    p.update(t => {
      let next: Thread = pushItems({ ...t, pending: undefined }, { kind: 'permission', id: uid('k'), tool, text: cmd, decision }, ...(note ? [{ kind: 'answer', id: uid('a'), text: note } as Item] : []));
      if (ok) next = pushItems(next, { kind: 'tool', id: runId, tool, label: cmd, status: 'running', startedAt: Date.now() });
      return next;
    });
    p.setAgentState('working');
    p.notify(`${agent.name} : ${ok ? decision === 'always' ? 'autorisé pour toute la session' : 'autorisation accordée' : 'demande refusée'}. Décision simulée, aucun agent réel contacté.`);
    if (ok) {
      const otto = agent.id === 'otto';
      later(3400, () => p.update(t => patchTool(t, runId, { status: 'success', durationMs: 3400, output: otto ? ' Test Files  48 passed (48)\n      Tests  412 passed (412)\n   Duration  38.2s' : 'Terminé sans erreur.' })));
      const reply = otto ? 'Toute la suite overlay passe : **412 tests** dans 48 fichiers, en 38 s. Les six modifications de la session sont prêtes à relire dans l’onglet **Modifications**.' : 'C’est fait. L’action s’est terminée sans erreur.';
      later(4300, () => { p.update(t => { const last = [...t.turns.flatMap(x => x.items)].reverse().find((i): i is TodosItem => i.kind === 'todos'); const upd: Item[] = otto && last ? [{ kind: 'todos', id: uid('d'), items: last.items.map((x, i) => ({ ...x, status: i <= 3 ? 'completed' : i === 4 ? 'in_progress' : x.status })) }] : []; return pushItems(t, ...upd, { kind: 'reply', id: uid('r'), text: reply }); }); p.setAgentState('idle', reply.replace(/\*\*/g, '')); });
    } else {
      const reply = note ? `Compris, je ne lance pas \`${cmd}\`. Je tiens compte de ta consigne : « ${note} ».` : `D’accord, je ne lance pas \`${cmd}\`. Dis-moi comment tu préfères vérifier les modifications.`;
      later(1500, () => { p.update(t => pushItems(t, { kind: 'reply', id: uid('r'), text: reply })); p.setAgentState('idle', reply.replace(/`/g, '')); });
    }
  };
  const planOf = (id: string) => thread.turns.flatMap(t => t.items).find((i): i is Extract<Item, { kind: 'plan' }> => i.kind === 'plan' && i.id === id);
  const setPlanStatus = (t: Thread, id: string, status: 'approved' | 'revised'): Thread => ({ ...t, turns: t.turns.map(tu => ({ ...tu, items: tu.items.map(it => it.id === id && it.kind === 'plan' ? { ...it, status } : it) })) });
  /** Plan mode (ExitPlanMode): approving lets the agent act on its plan; "keep planning" sends it back with your note. */
  const resolvePlan = (decision: 'accept' | 'always' | 'deny', note?: string) => {
    if (pending?.kind !== 'plan') return; const plan = planOf(pending.plan); if (!plan) return;
    follow.current = true; const ok = decision !== 'deny';
    p.update(t => pushItems(setPlanStatus({ ...t, pending: undefined }, plan.id, ok ? 'approved' : 'revised'), { kind: 'permission', id: uid('k'), tool: 'ExitPlanMode', text: plan.title, decision }, ...(note ? [{ kind: 'answer', id: uid('a'), text: note } as Item] : [])));
    p.notify(`${agent.name} : ${ok ? 'plan approuvé' : 'le plan repart en préparation'}. Simulation, aucun agent réel contacté.`);
    if (ok) {
      const steps = stepsOf(plan.text); const runId = uid('run'), run2 = uid('run');
      p.setAgentState('working', `Plan approuvé. ${steps[0] ?? 'Première étape'} en cours.`);
      const list = (n: number): Item => ({ kind: 'todos', id: uid('d'), items: steps.map((x, i) => ({ text: x, status: i < n ? 'completed' : i === n ? 'in_progress' : 'pending' })) });
      later(700, () => p.update(t => pushItems(t, list(0), { kind: 'message', id: uid('m'), text: `Je commence par le **${(steps[0] ?? 'changelog').toLowerCase()}**${decision === 'always' ? ', en acceptant les modifications de fichiers sans te les demander' : ''}.` }, { kind: 'tool', id: runId, tool: 'Edit', label: 'CHANGELOG.md', status: 'running', startedAt: Date.now() })));
      later(3200, () => p.update(t => pushItems(patchTool(t, runId, { status: 'success', durationMs: 2500 }), list(1), { kind: 'tool', id: run2, tool: 'Edit', label: 'apps/overlay/src-tauri/Cargo.toml', status: 'running', startedAt: Date.now() })));
    } else {
      p.setAgentState('working');
      const revised = plan.text.replace('## Hors périmètre', `## Ajusté selon ta remarque\n\n- ${note ?? 'Plan revu à ta demande.'}\n\n## Hors périmètre`);
      const id = uid('plan');
      later(2200, () => { p.update(t => ({ ...pushItems(t, { kind: 'message', id: uid('m'), text: 'J’ai revu le plan en tenant compte de ta remarque.' }, { kind: 'plan', id, title: plan.title + ' (révisé)', text: revised, status: 'proposed' }), pending: { kind: 'plan', plan: id, since: 'à l’instant' } })); p.setAgentState('approval'); });
    }
  };
  const answer = (text: string, choice?: number) => {
    if (pending?.kind !== 'question') return;
    const runId = uid('run'); follow.current = true;
    p.update(t => pushItems({ ...t, pending: undefined }, { kind: 'answer', id: uid('a'), text }));
    p.setAgentState('working', `Réponse reçue : ${text}. Je reprends.`);
    p.notify(`${agent.name} : réponse transmise${choice ? ` (choix ${choice})` : ''}. Simulation, aucun agent réel contacté.`);
    const nova = agent.id === 'nova';
    later(1200, () => p.update(t => pushItems(t, { kind: 'message', id: uid('m'), text: nova ? `C’est noté : **${text.toLowerCase()}**. Je prépare le plan d’exécution sur la base de développement, sans toucher à la prod.` : `C’est noté : ${text}. Je reprends.` }, { kind: 'tool', id: runId, tool: 'Bash', label: nova ? 'pnpm migrate:plan --target 0043 --env dev' : 'Reprise du travail', status: 'running', startedAt: Date.now() })));
  };
  const sendReply = (text: string) => {
    const runId = uid('run'), at = clock(); follow.current = true;
    p.update(t => ({ ...t, turns: [...t.turns, { id: uid('turn'), at, items: [{ kind: 'prompt', id: uid('p'), text }] }] }));
    p.setAgentState('working');
    p.notify('Message ajouté à la simulation.');
    later(900, () => p.update(t => pushItems(t, { kind: 'tool', id: runId, tool: 'Read', label: agent.repos.split(' · ')[0] + '/README.md', status: 'running', startedAt: Date.now() })));
    const reply = `Bien reçu. Je tiens compte de « ${text} » pour la suite de « ${agent.task.toLowerCase()} ».`;
    later(2600, () => { p.update(t => pushItems(patchTool(t, runId, { status: 'success', durationMs: 1700 }), { kind: 'reply', id: uid('r'), text: reply })); p.setAgentState('idle', reply); });
  };
  const subagent = Boolean(parent);
  const canReply = !agent.offline && !subagent;
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault(); const text = draft.trim(); if (!text || !canReply) return; setDraft('');
    if (pending?.kind === 'approval') resolveApproval('deny', text); else if (pending?.kind === 'plan') resolvePlan('deny', text); else if (pending?.kind === 'question') answer(text); else sendReply(text);
  };

  /* The app's key handler asks here first; it never calls while the viewer types. */
  const handleKey = (k: string) => {
    if (k === 'escape') { if (fileListOpen) { setFileListOpen(false); return true; } if (todoOpen) { setTodoOpen(false); return true; } if (activeTab) { closeTab(activeTab); return true; } return false; }
    if (pending && !subagent) {
      if (pending.kind === 'approval' && (k === 'y' || k === 'n')) { resolveApproval(k === 'y' ? 'accept' : 'deny'); return true; }
      if (pending.kind === 'plan' && (k === 'y' || k === 'n')) { if (k === 'y') resolvePlan('accept'); else { input.current?.focus(); p.notify('Écrivez ce qu’il faut revoir, puis Entrée : le plan repart en préparation.'); } return true; }
      if (pending.kind === 'question' && /^[1-9]$/.test(k)) { const c = pending.choices[Number(k) - 1]; if (c) { answer(c.label, Number(k)); return true; } }
    }
    if (view === 'changes' && (k === 'j' || k === 'k')) { stepFile(k === 'j' ? 1 : -1); return true; }
    if (active?.kind === 'diff' && (k === 'j' || k === 'k') && files.length) { const i = files.findIndex(f => f.path === active.key); const next = files[(i + (k === 'j' ? 1 : -1) + files.length) % files.length]!.path; setTabs(ts => ts.map(t => tabId(t) === activeTab ? { kind: 'diff', key: next } : t)); setActiveTab('diff:' + next); return true; }
    return false;
  };
  useEffect(() => { p.keys.current = handleKey; return () => { if (p.keys.current === handleKey) p.keys.current = null; }; });

  const onDocument = (ref: DocumentReference) => { if (DOCS[ref.path]) openTab({ kind: 'doc', key: ref.path }); else p.notify(`${ref.path} n’existe pas dans la maquette.`); };
  const spin = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[frame]!;
  const author = (id?: string) => id ? p.agents.find(a => a.id === id) : undefined;

  /* ---------- Thread ---------- */
  const renderItem = (it: Item) => {
    const isNew = it.id === unread.current;
    const marker = isNew ? <div key={'new' + it.id} className="unread-marker" role="separator"><span>Nouveau depuis votre dernière visite</span></div> : null;
    let node: ReactNode = null;
    if (it.kind === 'message' || it.kind === 'reply') node = <div className={`agent-message ${it.kind}`}><div className="msg-author">{p.bot(agent, 20)}<strong>{agent.name}</strong></div><div className="msg-body"><ThreadMarkdown text={it.text} onDocument={onDocument} /></div>
      {it.doc && <button className="document-card" onClick={() => openTab({ kind: 'doc', key: it.doc!.path })}><Icon d={fileIcon} size={16} /><span><strong>{it.doc.title}</strong><small className="mono">{it.doc.path}</small></span><span className="doc-open">Lire<Icon d={ICONS.chevronRight.d} size={13} /></span></button>}</div>;
    else if (it.kind === 'permission' || it.kind === 'answer') node = <Chip item={it} />;
    else if (it.kind === 'plan') { const steps = stepsOf(it.text); const intro = it.text.split('\n').find(l => l.trim() && !l.startsWith('#')) ?? ''; const isOpen = activeTab === 'plan:' + it.id;
      node = <div className={`plan-card status-${it.status}`} data-plan-card={it.id}>
        <div className="plan-card-head"><Icon d={planIcon} size={14} /><span className="plan-kicker">Plan proposé</span><strong>{it.title}</strong><span className="spacer" /><span className={`plan-status ${it.status}`}>{{ proposed: 'En attente de votre accord', approved: 'Approuvé', revised: 'Révisé ensuite' }[it.status]}</span></div>
        <div className="plan-intro"><ThreadMarkdown text={intro} /></div>
        <ol className="plan-steps">{steps.slice(0, 3).map(x => <li key={x}>{x}</li>)}{steps.length > 3 && <li className="more">… et {plural(steps.length - 3, 'autre étape', 'autres étapes')}</li>}</ol>
        <div className="plan-card-foot"><span className="muted">{plural(steps.length, 'étape')}</span><span className="spacer" /><Button variant={isOpen ? 'secondary' : 'outline'} size="sm" onClick={() => openTab({ kind: 'plan', key: it.id })}>{isOpen ? 'Ouvert à côté' : 'Lire le plan'}<Icon d={ICONS.chevronRight.d} size={13} /></Button></div>
      </div>; }
    else if (it.kind === 'helper') { const a = author(it.agent); node = <button className="helper-card" data-helper={it.agent} onClick={() => a && p.open(a.id)} aria-label={`Ouvrir ${a?.name ?? 'le sous-agent'} : ${it.task}`}><span className="helper-icon"><Icon d={subagentsIcon} size={12} />Sous-agent lancé</span>{a && p.bot(a, 26)}<span className="helper-copy"><strong>{a?.name ?? it.agent}</strong><small>{it.task}</small></span>{a && <Badge state={a.offline ? 'readonly' : a.state} />}<Icon d={ICONS.chevronRight.d} size={14} /></button>; }
    return <React.Fragment key={it.id}>{marker}{node}</React.Fragment>;
  };
  const renderTurn = (turn: Turn, index: number) => {
    const isLast = turn.id === lastId; const open = true;
    const prompt = turn.items.find((i): i is Extract<Item, { kind: 'prompt' }> => i.kind === 'prompt');
    const list = tools(turn.items);
    const total = list.reduce((s, t) => s + toolMs(t, now), 0);
    const from = author(prompt?.from);
    const live = list.find(t => t.status === 'running');
    const hasUnread = turn.items.some(i => i.id === unread.current);
    const end = [...turn.items].reverse().find(i => i.kind === 'reply' || i.kind === 'message');
    return <section key={turn.id} className={`turn open ${isLast ? 'current' : ''}`} aria-label={`Échange de ${turn.at}`}>
      <div className="turn-time" aria-hidden="true"><span className="mono">{turn.at}</span>{live && !agent.offline && <span className="turn-live"><i />en cours</span>}</div>
      {prompt && <div className={`prompt-block ${from ? 'from-agent' : ''}`}><div className="prompt-author">{from ? <>{p.bot(from, 16)}Consigne de {from.name}</> : 'Vous'}</div><p>{prompt.text}</p></div>}
      {turn.items.some(i => i.kind !== 'prompt') && <div className="turn-author">{p.bot(agent, 20)}<strong>{agent.name}</strong></div>}
      {open ? segments(turn.items).map(s => {
        if (s.kind === 'item') return renderItem(s.item);
        const expanded = openGroups.has(s.id); const run = s.items.find(t => t.status === 'running' && !agent.offline);
        const failed = s.items.filter(t => t.status === 'failed' || t.status === 'unknown');
        const unreadHere = s.items.some(t => t.id === unread.current);
        return <div key={s.id} className="action-group">
          {unreadHere && <div className="unread-marker" role="separator"><span>Nouveau depuis votre dernière visite</span></div>}
          {!(run && s.items.length && s.items.every(t => t.status === 'running') && !s.todos.length) && <Summary list={s.items} now={now} open={expanded} onToggle={() => toggle(setOpenGroups, s.id)} live={Boolean(run)} todos={s.todos.length} />}
          {expanded && !(s.items.length && s.items.every(t => t.status === 'running')) ? <div className="action-list">{s.items.map(t => <ActionRow key={t.id} t={t} now={now} spin={spin} expanded={openTools.has(t.id)} onExpand={() => toggle(setOpenTools, t.id)} onDiff={showDiff} flash={flash === t.id} />)}{s.todos.map(d => <div key={d.id} className="action-row todo-row"><div className="action-line"><span className="action-mark mark-success">☰</span><span className="action-verb">Plan de travail</span><span className="action-target">{done(d.items)}/{d.items.length} faites{d.items.find(x => x.status === 'in_progress') ? ` · en cours : ${d.items.find(x => x.status === 'in_progress')!.text}` : ''}</span></div></div>)}</div>
            : <>{failed.map(t => <div key={t.id} className="action-list compact"><ActionRow t={t} now={now} spin={spin} expanded={openTools.has(t.id)} onExpand={() => toggle(setOpenTools, t.id)} onDiff={showDiff} flash={false} /></div>)}
              {run && <div className="live-line" role="status" aria-label="Action en cours"><span className="action-mark mark-running">{spin}</span><strong>{verb(run)}</strong><span className="mono live-target" title={run.label}>{run.label}</span><span className="mono action-time">{fmtDur(toolMs(run, now))}</span></div>}</>}
        </div>;
      }) : <>
        {list.length > 0 && <div className="action-group"><Summary list={list} now={now} open={false} onToggle={() => toggle(setOpenTurns, turn.id)} />{list.filter(t => t.status === 'failed' || t.status === 'unknown').map(t => <div key={t.id} className="action-list compact"><ActionRow t={t} now={now} spin={spin} expanded={openTools.has(t.id)} onExpand={() => toggle(setOpenTools, t.id)} onDiff={showDiff} flash={false} /></div>)}</div>}
        {end && renderItem(end)}
        {hasUnread && <p className="muted folded-note">Ce tour contient du nouveau.</p>}
      </>}
      {isLast && agent.offline && <div className="frozen-end"><Icon d={offlineIcon} size={13} />Plus aucune nouvelle depuis la perte de connexion · {sinceLabel(agent.since)}</div>}
      {isLast && !agent.offline && agent.state === 'done' && <div className="turn-end">Session terminée · {sinceLabel(agent.since)}</div>}
    </section>;
  };

  /* ---------- Modifications ---------- */
  const totals = files.reduce((s, f) => ({ plus: s.plus + f.plus, minus: s.minus + f.minus }), { plus: 0, minus: 0 });
  const dirs = useMemo(() => { const m = new Map<string, typeof files>(); for (const f of files) { const d = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.'; m.set(d, [...(m.get(d) ?? []), f]); } return [...m.entries()]; }, [files]);
  const fileList = <nav className={`file-list ${fileListOpen ? 'open' : ''}`} aria-label="Fichiers modifiés">
    <div className="file-list-head"><span>{plural(files.length, 'fichier')}</span><Delta {...totals} /></div>
    {dirs.map(([dir, fs]) => <div key={dir} className="file-dir"><div className="dir-name mono" title={dir}><Icon d={ICONS.folder.d} size={12} />{dir}</div>
      {fs.map(f => <button key={f.path} className={`file-row ${f.path === currentFile?.path ? 'current' : ''}`} aria-current={f.path === currentFile?.path ? 'true' : undefined} onClick={() => { setFile(f.path); setFileListOpen(false); }} title={f.path}>
        <span className={`change-letter change-${f.change}`} title={CHANGE[f.change].label}>{CHANGE[f.change].letter}</span><span className="file-name mono">{f.path.split('/').pop()}</span><Delta plus={f.plus} minus={f.minus} /></button>)}</div>)}
  </nav>;
  const changes = !files.length ? <div className="changes-empty"><Icon d={diffIcon} size={22} /><strong>Aucun fichier modifié</strong><p className="muted">{agent.tool === 'cursor' ? 'Cursor Agent ne transmet pas les fichiers qu’il touche.' : `${agent.name} n’a encore rien modifié dans cette session.`}</p></div>
    : <div className="changes-view"><div className="changes-layout">{fileList}
      <div className="file-pane">{currentFile && <>
        <div className="file-head">
          <button className="file-list-toggle" aria-expanded={fileListOpen} onClick={() => setFileListOpen(o => !o)}><Icon d={ICONS.folder.d} size={13} />Fichiers · {files.length}<Icon d={chevronDown} size={12} /></button>
          <div className="file-title"><span className={`change-badge change-${currentFile.change}`}>{CHANGE[currentFile.change].label}</span><code title={currentFile.path}>{currentFile.path}</code><Delta plus={currentFile.plus} minus={currentFile.minus} /></div>
          <div className="file-actions">
            <Button variant="ghost" size="sm" onClick={() => { try { void navigator.clipboard?.writeText(currentFile.path); } catch { /* the notice says it */ } p.notify(`Chemin copié : ${currentFile.path}`); }}><Icon d={copyIcon} size={13} />Copier le chemin</Button>
            <Button variant="ghost" size="sm" onClick={() => p.notify(`Simulation : ${currentFile.path} s’ouvrirait dans l’éditeur de ${agent.machine}.`)}><Icon d={ICONS.external.d} size={13} />Ouvrir dans l’éditeur</Button>
            <span className="spacer" />
            <span className="file-pos mono">{fileIndex + 1} / {files.length}</span>
            <Button variant="outline" size="icon" aria-label="Fichier précédent" title="Fichier précédent (K)" onClick={() => stepFile(-1)} style={{ width: 30, height: 30 }}><Icon d={ICONS.chevronLeft.d} size={14} /></Button>
            <Button variant="outline" size="icon" aria-label="Fichier suivant" title="Fichier suivant (J)" onClick={() => stepFile(1)} style={{ width: 30, height: 30 }}><Icon d={ICONS.chevronRight.d} size={14} /></Button>
          </div>
          {currentFile.touches.length > 0 && <div className="file-touches"><span className="muted">{currentFile.change === 'add' ? 'Créé' : 'Modifié'} par</span>{currentFile.touches.map(({ tool, turn }) => <button key={tool.id} className="touch-link" onClick={() => showInThread(tool.id)}>{tool.tool} · tour {turn}{tool.files?.[0]?.plus !== undefined ? <> · <Delta plus={tool.files[0].plus} minus={tool.files[0].minus ?? 0} /></> : null}</button>)}<span className="muted">· voir dans le fil</span></div>}
        </div>
        <div className="diff-scroll"><DiffView key={currentFile.path} diff={currentFile.diff} /></div>
      </>}</div></div></div>;

  /* ---------- Pinned request and reply ---------- */
  const pendingPlan = pending?.kind === 'plan' ? planOf(pending.plan) : undefined;
  const pendingCard = pending && <div className={`pending-card ${pending.kind}`} role="region" aria-label={pending.kind === 'approval' ? 'Autorisation demandée' : pending.kind === 'plan' ? 'Plan à approuver' : 'Question de l’agent'}>
    <div className="pending-head"><Badge state={pending.kind === 'plan' ? 'approval' : pending.kind} label={pending.kind === 'plan' ? 'Plan à approuver' : undefined} /><strong>{pending.kind === 'plan' ? `${agent.name} propose un plan · ${pendingPlan?.title ?? ''}` : pending.kind === 'approval' ? `${agent.name} veut ${pending.tool === 'Action' ? 'votre accord' : 'exécuter une commande'}` : `${agent.name} vous pose une question`}</strong><span className="spacer" /><span className="muted pending-since">{pending.since}</span></div>
    {pending.kind === 'plan' ? <>
      {pendingPlan && <p className="pending-summary">{plural(stepsOf(pendingPlan.text).length, 'étape')} : {stepsOf(pendingPlan.text).slice(0, 4).join(' · ')}{stepsOf(pendingPlan.text).length > 4 ? ' …' : ''} <button className="action-link" onClick={() => openTab({ kind: 'plan', key: pendingPlan.id })}>Lire le plan</button></p>}
      {subagent ? <p className="pending-relay muted">C’est {parent!.name} qui transmet cette décision.</p> : <div className="pending-actions">
        <Button variant="primary" size="sm" onClick={() => resolvePlan('accept')}>Approuver le plan<Kbd accent>Y</Kbd></Button>
        <Button variant="outline" size="sm" onClick={() => { if (draft.trim()) { const n = draft.trim(); setDraft(''); resolvePlan('deny', n); } else { input.current?.focus(); p.notify('Écrivez ce qu’il faut revoir, puis Entrée.'); } }}>Continuer à planifier<Kbd>N</Kbd></Button>
        <Button variant="ghost" size="sm" onClick={() => resolvePlan('always')}>Approuver et accepter les modifications automatiquement</Button>
      </div>}
    </> : pending.kind === 'approval' ? <>
      {pending.tool !== 'Action' && <div className="pending-command"><span className="tool-tag">{pending.tool}</span><code>{pending.command}</code></div>}
      <p className="pending-summary">{pending.summary}{pending.cwd && <> <span className="mono muted">· {pending.cwd}</span></>}</p>
      {subagent ? <p className="pending-relay muted">C’est {parent!.name} qui transmet cette décision.</p> : <div className="pending-actions">
        <Button variant="primary" size="sm" onClick={() => resolveApproval('accept')}>Autoriser<Kbd accent>Y</Kbd></Button>
        <Button variant="outline" size="sm" onClick={() => resolveApproval('deny')}>Refuser<Kbd>N</Kbd></Button>
        {pending.tool !== 'Action' && <Button variant="ghost" size="sm" onClick={() => resolveApproval('always')}>Toujours autoriser pour cette session</Button>}
      </div>}
    </> : <>
      <p className="pending-question">{pending.text}</p>
      {pending.choices.length > 0 && <ol className="pending-choices">{pending.choices.map((c, i) => <li key={c.label}><button disabled={subagent} onClick={() => answer(c.label, i + 1)}><Kbd>{i + 1}</Kbd><span><strong>{c.label}</strong>{c.detail && <small>{c.detail}</small>}</span></button></li>)}</ol>}
      {subagent && <p className="pending-relay muted">{parent!.name} relaiera votre réponse.</p>}
    </>}
  </div>;
  const placeholder = pending?.kind === 'plan' ? 'Ce qu’il faut revoir dans le plan… (Entrée : continuer à planifier)' : pending?.kind === 'approval' ? 'Ou refusez en expliquant quoi faire autrement…' : pending?.kind === 'question' ? `Ou répondez librement à ${agent.name}…` : agent.state === 'done' ? `Relancer ${agent.name} avec une nouvelle consigne…` : `Répondre à ${agent.name}…`;
  const replyArea = <div className="reply-area session-reply" ref={replyRef}>
    {pendingCard}
    {agent.offline ? <div className="reply-note offline"><Icon d={offlineIcon} size={15} /><span><strong>{agent.machine} est hors ligne.</strong> Le fil est figé à la dernière activité connue ; vous pourrez répondre à la reconnexion.</span><Button variant="outline" size="sm" onClick={p.openMachines}>Voir la machine</Button></div>
      : subagent ? <div className="reply-note">{p.bot(parent!, 22)}<span>Les réponses à {agent.name} passent par <strong>{parent!.name}</strong>, qui l’a lancé.</span><Button variant="outline" size="sm" onClick={() => p.open(parent!.id)}>Ouvrir {parent!.name}</Button></div>
      : <form onSubmit={submit} className={pending ? 'with-pending' : ''}>
        <textarea ref={input} rows={1} aria-label="Répondre à l’agent" placeholder={placeholder} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLElement).blur(); } }} />
        <span className="reply-hint">{pending?.kind === 'approval' && draft.trim() ? 'Entrée refuse avec ce message' : pending?.kind === 'plan' && draft.trim() ? 'Entrée renvoie le plan en préparation' : <><Kbd>R</Kbd> écrire</>}</span>
        <Button variant="primary" size="icon" type="submit" aria-label={pending?.kind === 'approval' ? 'Refuser avec ce message' : 'Envoyer'} disabled={!draft.trim()} style={{ width: 32, height: 32 }}><Icon d={ICONS.send.d} /></Button>
      </form>}
  </div>;

  const nChanges = files.length;
  const latestTodos = [...thread.turns.flatMap(t => t.items)].reverse().find((i): i is TodosItem => i.kind === 'todos');
  const todoBar = latestTodos && <div className={`todo-bar ${todoOpen ? 'open' : ''}`}>
    <button className="todo-head" aria-expanded={todoOpen} onClick={() => setTodoOpen(o => !o)}>
      <Icon d={planIcon} size={14} /><strong>Plan de travail</strong><span className="mono todo-count">{done(latestTodos.items)}/{latestTodos.items.length}</span>
      <span className="todo-progress" aria-hidden="true"><i style={{ width: `${(done(latestTodos.items) / latestTodos.items.length) * 100}%` }} /></span>
      <span className="todo-current">{(() => { const c = latestTodos.items.find(x => x.status === 'in_progress'); return c ? <><span className="todo-dot" />{c.text}</> : done(latestTodos.items) === latestTodos.items.length ? 'Tout est fait' : 'En pause'; })()}</span>
      <Icon d={chevronDown} size={13} />
    </button>
    {todoOpen && <ol className="todo-list">{latestTodos.items.map(x => <li key={x.text} className={x.status}><span className="todo-box" aria-label={{ completed: 'Fait', in_progress: 'En cours', pending: 'À faire' }[x.status]}>{x.status === 'completed' ? '✓' : x.status === 'in_progress' ? spin : ''}</span>{x.text}</li>)}</ol>}
  </div>;
  const paneDoc = (t: Tab) => t.kind === 'doc' ? { title: /^---[\s\S]*?title: (.+)/.exec(DOCS[t.key] ?? '')?.[1] ?? t.key.split('/').pop()!, path: t.key, label: t.key.split('/').pop()! }
    : t.kind === 'plan' ? { title: planOf(t.key)?.title ?? 'Plan', path: 'Plan proposé par ' + agent.name, label: 'Plan · ' + (planOf(t.key)?.title ?? '') }
    : { title: 'Modification · ' + t.key.split('/').pop()!, path: t.key, label: '± ' + t.key.split('/').pop()! };
  const paneFile = active?.kind === 'diff' ? files.find(f => f.path === active.key) : undefined;
  const sidePane = active && view === 'thread' && <aside className="side-pane" aria-label="Volet de lecture" style={{ '--split': `${split * 100}%` } as React.CSSProperties}>
    {tabs.length > 1 && <div className="pane-tabs" role="tablist" aria-label="Documents ouverts">{tabs.map(t => { const id = tabId(t); const d = paneDoc(t); return <div key={id} className={`pane-tab ${id === activeTab ? 'current' : ''}`}><button role="tab" aria-selected={id === activeTab} onClick={() => setActiveTab(id)} title={d.path}><Icon d={t.kind === 'diff' ? diffIcon : t.kind === 'plan' ? planIcon : fileIcon} size={12} /><span>{d.label}</span></button><button className="tab-close" aria-label={`Fermer ${d.label}`} onClick={() => closeTab(id)}><Icon d={ICONS.close.d} size={11} /></button></div>; })}</div>}
    <div className="side-head">
      <span className="side-title"><strong>{paneDoc(active).title}</strong><code title={paneDoc(active).path}>{paneDoc(active).path}</code></span>
      <Button variant="ghost" size="sm" className="side-grow" onClick={() => setSplit(split < 0.6 ? 0.65 : 0.5)} title={split < 0.6 ? 'Agrandir le volet (65 %)' : 'Réduire le volet (50 %)'}><Icon d={splitIcon} size={13} />{split < 0.6 ? 'Agrandir' : 'Réduire'}</Button>
      <Button variant="ghost" size="sm" className="side-close" onClick={() => closeTab(activeTab!)} aria-label="Fermer le volet (Échap)" title="Fermer (Échap)"><Icon d={ICONS.close.d} size={14} /><span>Fermer</span></Button>
    </div>
    <div className="side-body">
      {active.kind === 'doc' && <MarkdownDocument text={DOCS[active.key] ?? ''} onDocument={onDocument} onHeadings={noop} />}
      {active.kind === 'plan' && (() => { const pl = planOf(active.key); return pl ? <div className={`plan-doc status-${pl.status}`}><div className="plan-doc-status"><span className={`plan-status ${pl.status}`}>{{ proposed: 'En attente de votre accord', approved: 'Approuvé', revised: 'Révisé ensuite' }[pl.status]}</span>{pl.status === 'proposed' && pending?.kind === 'plan' && pending.plan === pl.id && <span className="muted">Répondez sous le fil : <Kbd>Y</Kbd> approuver · <Kbd>N</Kbd> continuer à planifier</span>}</div><MarkdownDocument text={pl.text} onDocument={onDocument} onHeadings={noop} /></div> : null; })()}
      {active.kind === 'diff' && (paneFile ? <div className="side-diff"><div className="side-diff-head"><span className={`change-badge change-${paneFile.change}`}>{CHANGE[paneFile.change].label}</span><Delta plus={paneFile.plus} minus={paneFile.minus} /><span className="spacer" /><span className="file-pos mono">{files.indexOf(paneFile) + 1} / {files.length}</span><Button variant="ghost" size="sm" onClick={() => showAllChanges(paneFile.path)}><Icon d={diffIcon} size={13} />Toutes les modifications</Button></div><div className="diff-scroll"><DiffView key={paneFile.path} diff={paneFile.diff} /></div></div> : <p className="muted" style={{ padding: 20 }}>Ce fichier n’a pas de différence enregistrée.</p>)}
    </div>
  </aside>;
  const dragSplit = (e: React.PointerEvent) => { const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId); const move = (ev: PointerEvent) => setSplit((box.right - ev.clientX) / box.width); const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); }; el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); };
  useLayoutEffect(() => { const el = replyRef.current; if (!el) return; const ro = new ResizeObserver(() => setReplyH(el.offsetHeight)); ro.observe(el); return () => ro.disconnect(); }, []);
  return <section className="conversation session-page" data-session={agent.id}>
    <div className="pane-heading">
      <div className="view-switch" role="tablist" aria-label="Vue de la session">
        {([['thread', 'Fil', threadIcon], ['changes', 'Modifications', diffIcon]] as const).map(([v, label, d]) => <button key={v} role="tab" id={`session-tab-${v}`} aria-selected={view === v} tabIndex={view === v ? 0 : -1} onClick={() => switchView(v)} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const n = view === 'thread' ? 'changes' : 'thread'; switchView(n); document.getElementById(`session-tab-${n}`)?.focus(); } }}><Icon d={d} size={13} />{label}{v === 'changes' && <span className="tab-count mono">{nChanges}</span>}</button>)}
      </div>
      <span className="pane-meta mono" title="Machine et dépôts">{agent.machine} · {agent.repos}</span><span className="spacer" />{p.headingExtra}
    </div>
    <div className={`session-split ${sidePane ? 'has-pane' : ''}`} style={{ '--split': `${split * 100}%`, '--reply-h': `${replyH}px` } as React.CSSProperties}>
    <div className="session-main">
    <div className="session-body" role="tabpanel" aria-labelledby={`session-tab-${view}`}>
      {view === 'thread' ? <>
        <div className="messages session-thread" ref={scroller} onScroll={onScroll}>
          {todoBar}
          {agent.offline && <div className="frozen-banner" role="status"><Icon d={offlineIcon} size={15} /><span><strong>Connexion perdue avec {agent.machine}</strong> · {sinceLabel(agent.since)}. Le fil est figé : ce qui suit est le dernier état connu, l’activité actuelle n’est pas connue.</span></div>}
          {thread.turns.map(renderTurn)}
          {thread.note && <p className="source-note muted">{thread.note}</p>}
        </div>
        {!atBottom && <button className="to-latest" onClick={toBottom}><Icon d={arrowDown} size={13} />Aller au dernier message</button>}
      </> : changes}
    </div>
    {replyArea}
    </div>
    {sidePane && <div className="split-handle" role="separator" aria-orientation="vertical" aria-label="Redimensionner le volet" tabIndex={0} onPointerDown={dragSplit} onDoubleClick={() => setSplit(0.5)} onKeyDown={e => { if (e.key === 'ArrowLeft') setSplit(split + 0.03); if (e.key === 'ArrowRight') setSplit(split - 0.03); }} />}
    {sidePane}
    </div>
  </section>;
}
