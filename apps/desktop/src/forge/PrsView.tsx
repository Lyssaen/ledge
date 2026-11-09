import type { JSX, MouseEvent } from 'react';
import { mergedPrs, openPrs, type FleetPullRequest } from '@ledge/fleet';

const hhmm = (v: number | string): string => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5); };
import { useI18n } from '../i18n/lang';
import { PipeDot } from './PipeGraph';
import { cliOf, loginCommand, type ForgeLine } from './states';
import type { ShownPr } from './useForge';
import '../styles/forge.css';

export interface PrsViewProps {
  prs: readonly ShownPr[];
  /** What cannot be read, at the head (states 1, 3, 4); `noneReadable`: no forge at all can be (state 10). */
  lines?: readonly ForgeLine[]; noneReadable?: boolean;
  /** A machine's name as the user knows it (« WSL », « srv-build »), and a time of day. */
  machineLabel?(id: string): string; time?(ms: number | string): string;
  /** « Copier » a sign-in command: to the clipboard, told by a toast. */
  onCopy?(command: string): void;
  /** The agent working on its branch (its session's or seat's name), null when none is known. */
  agentOf(pr: FleetPullRequest): string | null;
  /** The request in front of the focused group, lit in the list. */
  current: string | null;
  /** A click opens it in a tab; Ctrl+click, to the right. */
  onOpen(pr: FleetPullRequest, right: boolean): void;
}

/** The sidebar's « MR et PR » (mockup explorer `prs`): the open requests, most recently updated first, then the merged ones,
 *  and how they are followed. A row: the pipeline's dot, its ref and title, then forge · repository · state · agent · pipeline
 *  · open threads. */
export function PrsView({ prs, agentOf, current, onOpen, lines = [], noneReadable = false, machineLabel = id => id, time = hhmm, onCopy }: PrsViewProps): JSX.Element {
  const { t } = useI18n();
  const f = t.forge;
  const line = (l: ForgeLine, i: number) => {
    const m = machineLabel(l.machine);
    switch (l.kind) {
      case 'missing': return <div key={i} className="fg-line"><div className="h"><span className="fg-dot wait" aria-hidden="true" /><span>{f.missing(cliOf(l.forge), m, l.host, f.prKind[l.forge])}</span></div></div>;
      case 'unauthenticated': {
        const cmd = loginCommand(l.forge, l.host);
        return (
          <div key={i} className="fg-line"><div className="h"><span className="fg-dot wait" aria-hidden="true" /><span>{f.unauth(cliOf(l.forge), l.host, m)}</span></div>
            <div className="cmd"><code>{cmd}</code><button type="button" className="fg-btn sm" onClick={() => onCopy?.(cmd)}>{f.copy}</button></div></div>
        );
      }
      case 'error': return (
        <div key={i} className="fg-line err"><div className="h"><span className="fg-dot fail" aria-hidden="true" /><span>{f.error(f.host[l.forge], m, time(l.since))}{l.retryAt && ` ${f.retry_at(time(l.retryAt))}`}</span></div>
          {l.message && <small>{l.message}</small>}</div>
      );
      case 'offline': case 'daemonDown': return <div key={i} className="fg-line off"><div className="h"><span className="fg-dot" aria-hidden="true" /><span>{(l.kind === 'offline' ? f.offline : f.daemonDown)(m, l.at === null ? '' : time(l.at))}</span></div></div>;
      case 'outdated': return <div key={i} className="fg-line off"><div className="h"><span className="fg-dot" aria-hidden="true" /><span>{f.outdated(m)}</span></div></div>;
    }
  };
  // A forge in error keeps its last read, its time in the head (state 3).
  const errorAt = lines.find(l => l.kind === 'error');
  const row = (p: ShownPr) => (
    <button key={p.id} type="button" className={`fg-row${current === p.id ? ' on' : ''}${p.stale ? ' stale' : ''}`} title={f.rowTip} aria-current={current === p.id || undefined}
      onClick={(e: MouseEvent) => onOpen(p, e.ctrlKey || e.metaKey)}>
      <PipeDot status={p.pipeline} />
      <span className="fg-row-t">
        <b>{p.ref}</b> {p.title}
        <small>{f.rowMeta(f.host[p.forge], p.repo, f.state[p.state], agentOf(p), f.pipe[p.pipeline], p.openThreads)}</small>
      </span>
    </button>
  );
  const open = openPrs(prs);
  const merged = mergedPrs(prs);
  return (
    <div className="fg-side" role="region" aria-label={f.view}>
      <div className="fg-side-h"><span>{f.view}</span><small>{errorAt?.kind === 'error' && errorAt.readAt ? f.asOf(time(errorAt.readAt)) : f.hosts}</small></div>
      {lines.length > 0 && <div className="fg-strip">{lines.map(line)}</div>}
      {open.length ? <div className="fg-tree">{open.map(row)}</div> : (
        <div className="fg-empty"><b>{f.emptyTitle}</b><span>{noneReadable ? f.emptyUnread : f.emptyBody}</span></div>
      )}
      {merged.length > 0 && <>
        <div className="fg-side-h"><span>{f.merged}</span></div>
        <div className="fg-tree">{merged.map(row)}</div>
      </>}
      <div className="fg-foot">{f.foot}</div>
    </div>
  );
}
