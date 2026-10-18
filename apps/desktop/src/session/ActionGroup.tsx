import { useEffect, useLayoutEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import type { ToolItem } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { elapsedMs, SPINNER, SPINNER_STILL, target } from '@ledge/ui/thread/tools';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { parseDiff } from './diff';
import { Delta } from './DiffView';
import { fmtDur, kindOf, summarize, verbOf, type Summary as Sum, type ToolKind } from './exchanges';
import { doneCount, todosOf } from './todos';

const KINDS: readonly ToolKind[] = ['read', 'search', 'command', 'edit'];
const KIND_ICON: Record<ToolKind, readonly string[]> = { read: SHELL_ICONS.file, search: SHELL_ICONS.search, command: SHELL_ICONS.terminal, edit: SHELL_ICONS.pencil };
const settled = (x: ToolItem) => x.status === 'failed' || x.status === 'unknown';

/** A running action's spinner: it turns on its own (an image every 80 ms), so its ticks render nothing else; still with
 *  reduced motion, or when nothing runs live (offline). */
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

/** The fold's head: how many actions, by kind, files changed, failures, interruptions, the work plan's updates, and the
 *  time the actions took; a fold of updates alone says so (« Plan de travail mis à jour »), untimed. */
function Summary({ s, open, onToggle }: { s: Sum; open: boolean; onToggle(): void }): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const tt = t.session.todos;
  return (
    <button type="button" className={cls('action-summary', open && 'open')} onClick={onToggle} aria-expanded={open}>
      <Icon d={SHELL_ICONS.chevronDown} size={13} />
      <span className="summary-count">{s.count > 0 ? th.actions(s.count) : tt.workPlanUpdated}</span>
      <span className="kind-chips">
        {KINDS.map(k => s.kinds[k] > 0 && <span key={k} className={`kind-chip kind-${k}`} title={th.kinds[k](s.kinds[k])}><Icon d={KIND_ICON[k]} size={12} />{s.kinds[k]}</span>)}
      </span>
      {s.files > 0 && <span className="summary-meta">{th.files(s.files)}</span>}
      {s.failed > 0 && <span className="summary-failed">{th.failed(s.failed)}</span>}
      {s.cut > 0 && <span className="summary-meta">{th.cut(s.cut)}</span>}
      {s.todos > 0 && s.count > 0 && <span className="summary-meta">· {tt.updated}{s.todos > 1 ? ` ×${s.todos}` : ''}</span>}
      <span className="spacer" />
      {s.count > 0 && <span className="summary-meta mono">{s.running ? th.running : ''}{fmtDur(s.ms, lang)}</span>}
    </button>
  );
}

interface RowProps {
  tool: ToolItem; now: number; live: boolean; expanded: boolean; onExpand(): void;
  /** Lit for a moment: the reader came back to it from « Modifié par ». */
  flash: boolean;
  /** « Voir la modification »: its first file's change in the side pane. */
  onChange(path: string): void;
}

/** One action: its mark, kind, verb and target; the target opens its output when there is one (a label otherwise). A
 *  successful action that touched a file shows its first file's +/− (when its diff is known) and « Voir la modification »,
 *  a sibling of the target so the keyboard reaches it even when the target is disabled. */
function ActionRow({ tool, now, live, expanded, onExpand, flash, onChange }: RowProps): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const k = kindOf(tool.tool);
  const detail = tool.status === 'running' ? undefined : tool.error || tool.output || undefined;
  const mark = tool.status === 'running' ? <Spinner live={live} /> : tool.status === 'success' ? '✓' : tool.status === 'failed' ? '✕' : '·';
  const f = tool.files[0];
  const delta = useMemo(() => (f?.diff ? parseDiff(f.diff) : null), [f?.diff]);
  return (
    <div className={cls('action-row', `status-${tool.status}`, flash && 'flash')} data-tool={tool.id}>
      <div className="action-line">
        <span className={`action-mark mark-${tool.status}`} aria-label={th.marks[tool.status]}>{mark}</span>
        <span className={`action-kind kind-${k}`}><Icon d={KIND_ICON[k]} size={13} /></span>
        <span className="action-verb">{th.verbs[verbOf(tool)]}</span>
        <button type="button" className="action-target mono" title={tool.label} onClick={detail ? onExpand : undefined} aria-expanded={detail ? expanded : undefined} disabled={!detail}>{target(tool) || tool.tool}</button>
        {delta && <Delta plus={delta.plus} minus={delta.minus} />}
        {f && tool.status === 'success' && <button type="button" className="action-link" data-short={th.seeChangeShort} onClick={() => onChange(f.path)}>{th.seeChange}</button>}
        <span className="action-time mono">{tool.status === 'unknown' ? th.interrupted : fmtDur(elapsedMs(tool, now), lang)}</span>
      </div>
      {expanded && detail && <pre className={cls('action-output', !!tool.error && 'is-error')}>{detail}</pre>}
    </div>
  );
}

/** An update of the work plan, unfolded: how many are done, and the task then in progress. */
function TodoRow({ tool }: { tool: ToolItem }): JSX.Element {
  const { t } = useI18n();
  const tt = t.session.todos;
  const list = useMemo(() => todosOf(tool), [tool]);
  const current = list?.find(x => x.status === 'in_progress');
  return (
    <div className="action-row todo-row">
      <div className="action-line">
        <span className="action-mark mark-success" aria-hidden="true">☰</span>
        <span className="action-verb">{tt.workPlan}</span>
        {list && <span className="action-target">{tt.doneOf(doneCount(list), list.length)}{current ? ` · ${tt.inProgress(current.text)}` : ''}</span>}
      </div>
    </div>
  );
}

/** A run of consecutive actions, folded under its summary; the work plan's updates in it are no actions, summed up in the
 *  summary and listed after the actions once unfolded. Folded, the failed and interrupted ones stay in sight and the
 *  running one has its live line; a run that is all running shows only that line. `live` false (offline): nothing runs live,
 *  and `now` is the instant the thread froze. */
export function ActionGroup({ tools, todos, now, live, marker, flash = null, onChange }: {
  tools: ToolItem[];
  /** The work plan's updates that fell in this run (the segment's `todos`). */
  todos: ToolItem[];
  now: number; live: boolean; marker?: ReactNode;
  /** One of these actions, reached from the Changes view: the fold opens and the action lights up. */
  flash?: string | null;
  onChange(path: string): void;
}): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const [open, setOpen] = useState(() => flash !== null);
  // Before the page looks for the action to scroll it into view.
  useLayoutEffect(() => { if (flash !== null) setOpen(true); }, [flash]);
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setShown(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const s = summarize(tools, now, live, todos);
  const run = s.running;
  // Every action running and nothing else: no summary, only the live line. Updates of the plan beside them make it a fold.
  const onlyLive = run !== null && tools.every(x => x.status === 'running') && todos.length === 0;
  const row = (x: ToolItem) => <ActionRow key={x.id} tool={x} now={now} live={live} expanded={shown.has(x.id)} onExpand={() => toggle(x.id)} flash={x.id === flash} onChange={onChange} />;
  return (
    <div className="action-group">
      {marker}
      {!onlyLive && <Summary s={s} open={open} onToggle={() => setOpen(o => !o)} />}
      {open && !onlyLive ? <div className="action-list">{tools.map(row)}{todos.map(x => <TodoRow key={x.id} tool={x} />)}</div> : <>
        {tools.filter(settled).map(x => <div key={x.id} className="action-list compact">{row(x)}</div>)}
        {run && (
          <div className="live-line" role="status" aria-label={th.liveAction}>
            <span className="action-mark mark-running" aria-hidden="true"><Spinner live /></span>
            <strong>{th.verbs[verbOf(run)]}</strong>
            <span className="mono live-target" title={run.label}>{target(run) || run.tool}</span>
            {/* The ticking time is left out of what the live region announces. */}
            <span className="mono action-time" aria-hidden="true">{fmtDur(elapsedMs(run, now), lang)}</span>
          </div>
        )}
      </>}
    </div>
  );
}
