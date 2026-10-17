import { useState, type JSX, type ReactNode } from 'react';
import type { ToolItem } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { elapsedMs, target } from '@ledge/ui/thread/tools';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { fmtDur, kindOf, summarize, verbOf, type Summary as Sum, type ToolKind } from './thread';

const KINDS: readonly ToolKind[] = ['read', 'search', 'command', 'edit'];
const KIND_ICON: Record<ToolKind, readonly string[]> = { read: SHELL_ICONS.file, search: SHELL_ICONS.search, command: SHELL_ICONS.terminal, edit: SHELL_ICONS.pencil };
const settled = (x: ToolItem) => x.status === 'failed' || x.status === 'unknown';

/** The fold's head: how many actions, by kind, files changed, failures, interruptions, and the time they took. */
function Summary({ s, open, onToggle }: { s: Sum; open: boolean; onToggle(): void }): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  return (
    <button type="button" className={cls('action-summary', open && 'open')} onClick={onToggle} aria-expanded={open}>
      <Icon d={SHELL_ICONS.chevronDown} size={13} />
      <span className="summary-count">{th.actions(s.count)}</span>
      <span className="kind-chips">
        {KINDS.map(k => s.kinds[k] > 0 && <span key={k} className={`kind-chip kind-${k}`} title={th.kinds[k](s.kinds[k])}><Icon d={KIND_ICON[k]} size={12} />{s.kinds[k]}</span>)}
      </span>
      {s.files > 0 && <span className="summary-meta">{th.files(s.files)}</span>}
      {s.failed > 0 && <span className="summary-failed">{th.failed(s.failed)}</span>}
      {s.cut > 0 && <span className="summary-meta">{th.cut(s.cut)}</span>}
      <span className="spacer" />
      <span className="summary-meta mono">{s.running ? th.running : ''}{fmtDur(s.ms, lang)}</span>
    </button>
  );
}

/** One action: its mark, kind, verb and target; the target opens its output when there is one. */
function ActionRow({ tool, now, spin, expanded, onExpand }: { tool: ToolItem; now: number; spin: string; expanded: boolean; onExpand(): void }): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const k = kindOf(tool.tool);
  const detail = tool.status === 'running' ? undefined : tool.error || tool.output || undefined;
  const mark = tool.status === 'running' ? spin : tool.status === 'success' ? '✓' : tool.status === 'failed' ? '✕' : '·';
  return (
    <div className={cls('action-row', `status-${tool.status}`)} data-tool={tool.id}>
      <div className="action-line">
        <span className={`action-mark mark-${tool.status}`} aria-label={th.marks[tool.status]}>{mark}</span>
        <span className={`action-kind kind-${k}`}><Icon d={KIND_ICON[k]} size={13} /></span>
        <span className="action-verb">{th.verbs[verbOf(tool)]}</span>
        <button type="button" className="action-target mono" title={tool.label} onClick={detail ? onExpand : undefined} aria-expanded={detail ? expanded : undefined} disabled={!detail}>{target(tool) || tool.tool}</button>
        <span className="action-time mono">{tool.status === 'unknown' ? th.interrupted : fmtDur(elapsedMs(tool, now), lang)}</span>
      </div>
      {expanded && detail && <pre className={cls('action-output', !!tool.error && 'is-error')}>{detail}</pre>}
    </div>
  );
}

/** A run of consecutive actions, folded under its summary. Folded, the failed and interrupted ones stay in sight and the
 *  running one has its live line; a run that is all running shows only that line. `live` false (offline): nothing runs live. */
export function ActionGroup({ tools, now, spin, live, marker }: { tools: ToolItem[]; now: number; spin: string; live: boolean; marker?: ReactNode }): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setShown(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const s = summarize(tools, now, live);
  const run = s.running;
  const onlyLive = run !== null && tools.every(x => x.status === 'running');
  const row = (x: ToolItem) => <ActionRow key={x.id} tool={x} now={now} spin={spin} expanded={shown.has(x.id)} onExpand={() => toggle(x.id)} />;
  return (
    <div className="action-group">
      {marker}
      {!onlyLive && <Summary s={s} open={open} onToggle={() => setOpen(o => !o)} />}
      {open && !onlyLive ? <div className="action-list">{tools.map(row)}</div> : <>
        {tools.filter(settled).map(x => <div key={x.id} className="action-list compact">{row(x)}</div>)}
        {run && (
          <div className="live-line" role="status" aria-label={th.liveAction}>
            <span className="action-mark mark-running" aria-hidden="true">{spin}</span>
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
