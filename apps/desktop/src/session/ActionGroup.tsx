import { useEffect, useLayoutEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { type ToolItem, doneCount, todosOf } from '@ledge/protocol';
import { Badge } from '@ledge/ui/ui/Badge';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { elapsedMs, SPINNER, SPINNER_STILL, target } from '@ledge/ui/thread/tools';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { parseDiff } from './diff';
import { Delta } from './DiffView';
import { fmtDur, kindOf, summarize, verbOf, type Summary as Sum, type ToolKind } from './exchanges';

const KINDS: readonly ToolKind[] = ['read', 'search', 'command', 'edit'];
export const KIND_ICON: Record<ToolKind, readonly string[]> = { read: SHELL_ICONS.file, search: SHELL_ICONS.search, command: SHELL_ICONS.terminal, edit: SHELL_ICONS.pencil };
const settled = (x: ToolItem) => x.status === 'failed' || x.status === 'unknown';
/** A run of more actions than this folds under one row (the mockup's « 11 actions · 7 lectures, 3 commandes… »). */
export const FOLD_AT = 6;

/** A running action's spinner in text (the work plan's bar): it turns on its own (an image every 80 ms), so its ticks render
 *  nothing else; still with reduced motion, or when nothing runs live (offline). */
export function Spinner({ live }: { live: boolean }): JSX.Element {
  const { reduced } = useMotionPreferences();
  const turning = live && !reduced;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!turning) return;
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(id);
  }, [turning]);
  return <>{turning ? SPINNER[frame] : SPINNER_STILL}</>;
}

/** The rail's spinner (the mockup's `.spin`): a turning ring, still with reduced motion (the app's setting; the OS one is
 *  the stylesheet's) or when nothing runs live. */
export function Spin({ live }: { live: boolean }): JSX.Element {
  const { reduced } = useMotionPreferences();
  return <span className={cls('spin', (!live || reduced) && 'still')} aria-hidden="true" />;
}

/** The folded run's row: how many actions, by kind, files changed, failures, interruptions, the work plan's updates, and the
 *  time they took. */
function FoldRow({ s, open, onToggle }: { s: Sum; open: boolean; onToggle(): void }): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const tt = t.session.todos;
  const kinds = KINDS.filter(k => s.kinds[k] > 0).map(k => th.kinds[k](s.kinds[k])).join(', ');
  return (
    <li className="r r-fold action-summary">
      <span className="n node" aria-hidden="true"><Icon d={open ? SHELL_ICONS.chevronDown : ICONS.chevronRight.d} size={13} /></span>
      <button type="button" className="fold-row" onClick={onToggle} aria-expanded={open}>
        <span className="fold-text">
          <strong>{th.actions(s.count)}</strong>
          {kinds && ` · ${kinds}`}
          {s.files > 0 && ` ${th.files(s.files)}`}
          {s.failed > 0 && <span className="fold-failed"> {th.failed(s.failed)}</span>}
          {s.cut > 0 && ` ${th.cut(s.cut)}`}
          {s.todos > 0 && ` · ${tt.updated}${s.todos > 1 ? ` ×${s.todos}` : ''}`}
        </span>
      </button>
      <span className="tm">{s.running ? th.running : ''}{fmtDur(s.ms, lang)}</span>
    </li>
  );
}

interface RowProps {
  tool: ToolItem; now: number; live: boolean;
  /** Its output shown under it (a failed one shows its own until the reader hides it). */
  expanded: boolean; onExpand(): void;
  /** Lit for a moment: the reader came back to it from « Modifié par ». */
  flash: boolean;
  /** « Voir la modification »: its first file's change in the side pane. */
  onChange(path: string): void;
}

/** One action as a rail row. Quiet (a pip) when it went well; a pencil node for a change, with its +/− and « Voir la
 *  modification » (a sibling of the target, so the keyboard reaches it even when the target is disabled); the info node
 *  and its ring while it runs; the danger node, « Échec » and its output when it failed. The target opens the output. */
function ActionRow({ tool, now, live, expanded, onExpand, flash, onChange }: RowProps): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const k = kindOf(tool.tool);
  const detail = tool.status === 'running' ? undefined : tool.error || tool.output || undefined;
  const f = tool.files[0];
  const delta = useMemo(() => (f?.diff ? parseDiff(f.diff) : null), [f?.diff]);
  const change = f !== undefined && tool.status === 'success';
  const running = tool.status === 'running';
  const failed = tool.status === 'failed';
  const node = running ? <span className="n node info action-mark mark-running" role="img" aria-label={th.marks.running}><Spin live={live} /></span>
    : failed ? <span className="n node danger action-mark mark-failed" role="img" aria-label={th.marks.failed}><Icon d={ICONS.close.d} size={13} /></span>
    : change ? <span className="n node" aria-hidden="true"><Icon d={SHELL_ICONS.pencil} size={13} /></span>
    : <span className="n pip" aria-hidden="true" />;
  // The check of a quiet action, or the dot of an interrupted one; a change's node says it already.
  const mark = tool.status === 'success' && !change ? <span className="action-mark mark-success" role="img" aria-label={th.marks.success}><Icon d={ICONS.check.d} size={13} /></span>
    : tool.status === 'unknown' ? <span className="action-mark mark-unknown" role="img" aria-label={th.marks.unknown}>·</span>
    : null;
  return (
    <li className={cls('r action-row', `status-${tool.status}`, `kind-${k}`, change && 'is-change', flash && 'flash')} data-tool={tool.id} {...(running && live && { role: 'status', 'aria-label': th.liveAction })}>
      {node}
      <div className="act-col">
        <div className="act">
          {mark}
          <span className="vb">{!change && <Icon d={KIND_ICON[k]} size={13} />}<span className="action-verb">{th.verbs[verbOf(tool)]}</span></span>
          <button type="button" className="tg action-target" title={tool.label} onClick={detail ? onExpand : undefined} aria-expanded={detail ? expanded : undefined} disabled={!detail}>{target(tool) || tool.tool}</button>
          {failed && <Badge state="error" label={th.marks.failed} />}
          {tool.byClose && <Badge state="error" label={th.questionByClose} />}
          {delta && <Delta plus={delta.plus} minus={delta.minus} />}
          {change && <button type="button" className="lnk action-link" data-short={th.seeChangeShort} onClick={() => onChange(f.path)}><Icon d={SHELL_ICONS.diff} size={12} /><span>{th.seeChange}</span></button>}
        </div>
        {expanded && detail && <pre className={cls('pre action-output', !!tool.error && 'is-error')}>{detail}</pre>}
      </div>
      {/* The ticking time of a running action is left out of what the live region announces. */}
      <span className="tm action-time" aria-hidden={running || undefined}>{tool.status === 'unknown' ? th.interrupted : fmtDur(elapsedMs(tool, now), lang)}</span>
    </li>
  );
}

/** The run's updates of the work plan, as one row: how many are done by the last one, and the task then in progress. */
function TodoRow({ tool }: { tool: ToolItem }): JSX.Element {
  const { t } = useI18n();
  const tt = t.session.todos;
  const list = useMemo(() => todosOf(tool), [tool]);
  const current = list?.find(x => x.status === 'in_progress');
  return (
    <li className="r action-row todo-row">
      <span className="n pip" aria-hidden="true" />
      <div className="act-col">
        <div className="act">
          <span className="vb"><Icon d={SHELL_ICONS.plan} size={13} /><span className="action-verb">{tt.workPlan}</span></span>
          {list && <span className="tg action-target">{tt.doneOf(doneCount(list), list.length)}{current ? ` · ${tt.inProgress(current.text)}` : ''}</span>}
        </div>
      </div>
      <span className="tm" />
    </li>
  );
}

/** A run of consecutive actions, as rail rows: up to FOLD_AT of them one row each, more folded under one row. The work plan's
 *  updates in it are no actions: one row for the last of them, counted in the fold's row. Folded, the failed, interrupted and
 *  running ones stay in sight. `live` false (offline): nothing runs live, and `now` is the instant the thread froze. */
export function ActionGroup({ tools, todos, now, live, marker, flash = null, onChange }: {
  tools: ToolItem[];
  /** The work plan's updates that fell in this run (the segment's `todos`). */
  todos: ToolItem[];
  now: number; live: boolean;
  /** The unread marker's row, when the run opens what is new. */
  marker?: ReactNode;
  /** One of these actions, reached from the Changes view: the fold opens and the action lights up. */
  flash?: string | null;
  onChange(path: string): void;
}): JSX.Element {
  const [open, setOpen] = useState(() => flash !== null);
  // Before the page looks for the action to scroll it into view.
  useLayoutEffect(() => { if (flash !== null) setOpen(true); }, [flash]);
  // The outputs the reader opened, and the failed ones they closed.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const flip = (id: string) => setFlipped(s => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const row = (x: ToolItem) => <ActionRow key={x.id} tool={x} now={now} live={live} expanded={flipped.has(x.id) !== (x.status === 'failed')} onExpand={() => flip(x.id)} flash={x.id === flash} onChange={onChange} />;
  const plan = todos.at(-1);
  const all = <>{tools.map(row)}{plan && <TodoRow key={plan.id} tool={plan} />}</>;
  if (tools.length <= FOLD_AT) return <>{marker}{all}</>;
  return <>
    {marker}
    <FoldRow s={summarize(tools, now, live, todos)} open={open} onToggle={() => setOpen(o => !o)} />
    {open ? all : tools.filter(x => settled(x) || x.status === 'running').map(row)}
  </>;
}
