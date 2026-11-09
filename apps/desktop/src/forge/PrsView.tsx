import type { JSX, MouseEvent } from 'react';
import { mergedPrs, openPrs, type FleetPullRequest } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { PipeDot } from './PipeGraph';
import '../styles/forge.css';

export interface PrsViewProps {
  prs: readonly FleetPullRequest[];
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
export function PrsView({ prs, agentOf, current, onOpen }: PrsViewProps): JSX.Element {
  const { t } = useI18n();
  const f = t.forge;
  const row = (p: FleetPullRequest) => (
    <button key={p.id} type="button" className={`fg-row${current === p.id ? ' on' : ''}`} title={f.rowTip} aria-current={current === p.id || undefined}
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
      <div className="fg-side-h"><span>{f.view}</span><small>{f.hosts}</small></div>
      <div className="fg-tree">{open.map(row)}</div>
      <div className="fg-side-h"><span>{f.merged}</span></div>
      <div className="fg-tree">{merged.map(row)}</div>
      <div className="fg-foot">{f.foot}</div>
    </div>
  );
}
