import type { JSX } from 'react';
import type { PhoneHarnessUsage, UsageHarness, UsageWindow } from '@ledge/protocol';
import { harnessShell } from '@ledge/ui/bots/Bot';
import { copy } from '../../copy';
import { reached, resetLabel, span } from '../../model/usage';

/** A harness's logo: its Ledge silhouette (issue #61), filled in the harness's colour, without the eyes (M2). */
export function HarnessLogo({ harness, size = 14 }: { harness: UsageHarness; size?: number }): JSX.Element {
  const { viewBox, d } = harnessShell(harness);
  const [, , w, h] = viewBox.split(' ').map(Number) as [number, number, number, number];
  return <svg className={`harness-${harness} inline-block flex-none`} width={size} height={Math.round((size * h) / w)} viewBox={viewBox} aria-hidden="true"><path d={d} fill="currentColor" /></svg>;
}

/** The gauge of a window: neutral, red once reached (the phone has no threshold). */
export function UsageGauge({ pct }: { pct: number }): JSX.Element {
  return (
    <span className="block h-[5px] overflow-hidden rounded-[2px]" style={{ background: 'var(--u-track)' }}>
      <span className={`block h-full rounded-[2px] ${pct >= 100 ? 'bg-approval' : ''}`} style={{ width: `${Math.min(100, pct)}%`, ...(pct >= 100 ? {} : { background: 'var(--u-gauge)' }) }} />
    </span>
  );
}

function Row({ label, w, now }: { label: string; w: UsageWindow; now: number }) {
  const P = copy.chat.point;
  const at = w.resetsAt ? resetLabel(w.resetsAt, now) : null;
  return (
    <div className="grid grid-cols-[58px_1fr_128px] items-center gap-2 py-[3px] text-small">
      <span>{label}</span>
      <UsageGauge pct={w.pct} />
      <span className="truncate font-mono text-[12px]">
        <b className={`font-medium ${reached(w) ? 'text-approval' : ''}`}>{w.pct} %</b>
        {at && <small className="ml-1.5 text-[11px] text-muted">{reached(w) ? P.resumes(at) : `↺ ${at}`}</small>}
      </span>
    </div>
  );
}

/** « LIMITES » in « Le point » (docs/mockups/ledge-harness-usage.html, phone 1): per harness its logo, then each window's
 *  percent and reset; reading, expired, old or unreachable say so. Nothing when the PC gives no limits. */
export function Limits({ usage, now }: { usage: readonly PhoneHarnessUsage[]; now: number }): JSX.Element | null {
  const P = copy.chat.point;
  if (!usage.length) return null;
  const label = (w: UsageWindow) => (w.kind === 'five_hour' ? P.five : w.kind === 'seven_day' ? P.week : P.model(w.model ?? ''));
  return (
    <div role="group" aria-label={P.limitsLabel} className="flex flex-col">
      <h3 className="mt-1 text-meta tracking-[.4px] text-muted">{P.limits}</h3>
      {usage.map(h => {
        const age = h.readAt ? span(now - Date.parse(h.readAt)) : null;
        const dim = h.status === 'stale' || h.status === 'unreachable';
        return (
          <div key={h.harness} data-harness={h.harness} className="flex flex-col">
            <div className="mt-1.5 mb-0.5 flex items-baseline gap-1.5 text-small font-semibold"><HarnessLogo harness={h.harness} />{P.harness[h.harness] ?? h.harness}</div>
            {h.status === 'loading' && <p className="py-1 text-small text-muted">{P.loading}</p>}
            {h.status === 'expired' && <p className="py-1 text-small text-attention">{P.notOnPc}</p>}
            {h.status !== 'loading' && h.status !== 'expired' && h.windows.length > 0 && (
              <div className={dim ? 'opacity-50' : undefined}>{h.windows.map(w => <Row key={`${w.kind}:${w.model ?? ''}`} label={label(w)} w={w} now={now} />)}</div>
            )}
            {h.status === 'stale' && age && <p className="py-1 text-small text-attention">{P.stale(age)}</p>}
            {h.status === 'unreachable' && age && <p className="py-1 text-small text-attention">{P.unreach(age)}</p>}
          </div>
        );
      })}
    </div>
  );
}
