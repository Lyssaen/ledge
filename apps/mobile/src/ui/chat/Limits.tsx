import type { JSX } from 'react';
import type { PhoneHarnessUsage, UsageHarness, UsageWindow } from '@ledge/protocol';
import { HARNESS_PROVIDER, PROVIDER_MARKS } from '@ledge/ui/logos/providers';
import { copy } from '../../copy';
import { reached, resetLabel, shownUsage, span, usageTone } from '../../model/usage';

/** A harness's logo: its provider's own mark (Claude's spark in its orange; OpenAI's and Cursor's follow the text colour). */
export function HarnessLogo({ harness, size = 14 }: { harness: UsageHarness; size?: number }): JSX.Element {
  const { d, fill, rule } = PROVIDER_MARKS[HARNESS_PROVIDER[harness]];
  return <svg className={`harness-${harness} inline-block flex-none`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={d} fill={fill} fillRule={rule} /></svg>;
}

/** A window's label: « 5 h », « Semaine », « Mois », a model, or one of Cursor's pools (« Cursor », « Autres »). */
export function windowLabel(w: UsageWindow): string {
  const P = copy.chat.point;
  switch (w.kind) {
    case 'five_hour': return P.five;
    case 'seven_day': return P.week;
    case 'month': return P.month;
    case 'pool': return w.pool === 'other' ? P.poolOther : P.poolCursor;
    default: return P.model(w.model ?? '');
  }
}

const TONE_BG = { '': '', amber: 'bg-attention', red: 'bg-approval' } as const;
export const TONE_TEXT = { '': '', amber: 'text-attention', red: 'text-approval' } as const;

/** The gauge of a window: neutral under the PC's threshold, amber past it, red once reached. */
export function UsageGauge({ pct, alert }: { pct: number; alert: number | null }): JSX.Element {
  const tone = usageTone(pct, alert);
  return (
    <span className="block h-[5px] overflow-hidden rounded-[2px]" style={{ background: 'var(--u-track)' }}>
      <span className={`block h-full rounded-[2px] ${TONE_BG[tone]}`} style={{ width: `${Math.min(100, pct)}%`, ...(tone ? {} : { background: 'var(--u-gauge)' }) }} />
    </span>
  );
}

function Row({ label, w, now, alert }: { label: string; w: UsageWindow; now: number; alert: number | null }) {
  const P = copy.chat.point;
  const tone = usageTone(w.pct, alert);
  const at = w.resetsAt ? resetLabel(w.resetsAt, now) : null;
  return (
    <div className="grid grid-cols-[58px_1fr_128px] items-center gap-2 py-[3px] text-small">
      <span>{label}</span>
      <UsageGauge pct={w.pct} alert={alert} />
      <span className="truncate font-mono text-[12px]">
        <b className={`font-medium ${TONE_TEXT[tone]}`}>{w.pct} %</b>
        {at && <small className="ml-1.5 text-[11px] text-muted">{reached(w) ? P.resumes(at) : `↺ ${at}`}</small>}
      </span>
    </div>
  );
}

/** « LIMITES » in « Le point » (docs/mockups/ledge-harness-usage.html, phone 1): per harness its logo, then each window's
 *  percent and reset; reading, expired, old or unreachable say so. Nothing when the PC gives no limits. */
export function Limits({ usage: given, now, alert, fresh = true }: { usage: readonly PhoneHarnessUsage[]; now: number; alert: number | null; fresh?: boolean }): JSX.Element | null {
  const P = copy.chat.point;
  const usage = shownUsage(given, now, fresh);
  if (!usage.length) return null;
  // « Non lue »: Cursor answered without the limit (status ok, no window); the values' age is judged on the given reading.
  const unread = (i: number) => given[i]!.harness === 'cursor' && given[i]!.status === 'ok' && given[i]!.windows.length === 0 && given[i]!.readAt !== null;
  return (
    <div role="group" aria-label={P.limitsLabel} className="flex flex-col">
      <h3 className="mt-1 text-meta tracking-[.4px] text-muted">{P.limits}</h3>
      {usage.map((h, i) => {
        const age = h.readAt ? span(now - Date.parse(h.readAt)) : null;
        const dim = h.status === 'stale' || h.status === 'unreachable';
        return (
          <div key={h.harness} data-harness={h.harness} className="flex flex-col">
            <div className="mt-1.5 mb-0.5 flex items-baseline gap-1.5 text-small font-semibold"><HarnessLogo harness={h.harness} />{P.harness[h.harness] ?? h.harness}</div>
            {h.status === 'loading' && <p className="py-1 text-small text-muted">{P.loading}</p>}
            {h.status === 'expired' && <p className="py-1 text-small text-attention">{h.harness === 'cursor' ? P.notOnPcCursor : P.notOnPc}</p>}
            {h.status === 'ok' && unread(i) && <p className="py-1 text-small text-muted">{P.unread}</p>}
            {h.status !== 'loading' && h.status !== 'expired' && h.windows.length > 0 && (
              <div className={dim ? 'opacity-50' : undefined}>{h.windows.map(w => <Row key={`${w.kind}:${w.model ?? w.pool ?? ''}`} label={windowLabel(w)} w={w} now={now} alert={alert} />)}</div>
            )}
            {h.status === 'stale' && age && <p className="py-1 text-small text-attention">{P.stale(age)}</p>}
            {h.status === 'unreachable' && <p className="py-1 text-small text-attention">{age ? P.unreach(age) : P.unreachNever}</p>}
          </div>
        );
      })}
    </div>
  );
}
