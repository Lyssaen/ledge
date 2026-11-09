import type { JSX } from 'react';
import type { PipeStatus, PrJob } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

/** A pipeline's state as the mockup's dot (`pipeDot`): green, blue, red, grey. */
export function PipeDot({ status }: { status: PipeStatus }): JSX.Element {
  return <span className={`fg-dot ${status}`} aria-hidden="true" />;
}

const W = 180, H = 48, BW = 146, BH = 34;
const COLOUR: Record<PipeStatus, string> = { ok: 'var(--success)', run: 'var(--info)', fail: 'var(--destructive)', wait: 'var(--muted-foreground)', skip: 'var(--muted-foreground)', none: 'var(--muted-foreground)' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** The pipeline's graph (mockup `pipeGraph`): one column per stage (GitLab) or workflow (GitHub), its jobs centred in it, each
 *  linked to every job of the next column; a link is solid once its job passed, dashed otherwise. A job shows its duration once
 *  done, else its state. */
export function PipeGraph({ jobs }: { jobs: readonly PrJob[] }): JSX.Element | null {
  const { t } = useI18n();
  if (!jobs.length) return null;
  const byCol = new Map<number, number[]>();
  jobs.forEach((j, i) => byCol.set(j.column, [...(byCol.get(j.column) ?? []), i]));
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  // The columns as they come, without gaps: a stage with no job leaves no hole.
  const at = new Map(cols.map((c, k) => [c, k]));
  const nrow = Math.max(...[...byCol.values()].map(x => x.length));
  const pos: [number, number][] = [];
  for (const c of cols) byCol.get(c)!.forEach((i, r) => { pos[i] = [at.get(c)! * W + 4, (r + (nrow - byCol.get(c)!.length) / 2) * H + 22]; });
  const edges: JSX.Element[] = [];
  cols.slice(0, -1).forEach((c, k) => {
    for (const i of byCol.get(c)!) for (const j of byCol.get(cols[k + 1]!)!) {
      const s = jobs[i]!.status, sx = pos[i]![0] + BW, sy = pos[i]![1] + BH / 2, ex = pos[j]![0] - 6, ey = pos[j]![1] + BH / 2, mx = (sx + ex) / 2;
      edges.push(
        <g key={`${i}-${j}`}>
          <path d={`M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`} stroke={COLOUR[s]} strokeWidth="1.6" fill="none" strokeDasharray={s === 'ok' ? undefined : '4 4'} />
          <path d={`M${ex} ${ey - 4} L${ex + 6} ${ey} L${ex} ${ey + 4}`} fill={COLOUR[s]} />
        </g>
      );
    }
  });
  const w = (cols.length - 1) * W + BW + 8, h = nrow * H + 24;
  return (
    <div className="fg-graph" style={{ width: w, height: h }} role="img" aria-label={jobs.map(j => `${j.name} : ${t.forge.pipe[j.status]}`).join(', ')}>
      <svg width={w} height={h} aria-hidden="true">{edges}</svg>
      {cols.map(c => <span key={c} className="fg-col" style={{ left: at.get(c)! * W + 4 }}>{t.forge.step(at.get(c)! + 1)}</span>)}
      {jobs.map((j, i) => (
        <div key={j.id} className={`fg-node ${j.status}`} style={{ left: pos[i]![0], top: pos[i]![1], width: BW, height: BH }} aria-hidden="true">
          <PipeDot status={j.status} /><span className="fg-node-name">{j.name}</span>
          <span className="fg-node-t mono">{j.durationS !== undefined && j.status !== 'run' && j.status !== 'wait' ? mmss(j.durationS) : t.forge.pipe[j.status]}</span>
        </div>
      ))}
    </div>
  );
}
