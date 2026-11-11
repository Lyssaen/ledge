import type { JSX } from 'react';
import type { PhoneHarnessUsage, UsageHarness, UsageWindow } from '@ledge/protocol';
import { HARNESS_PROVIDER, PROVIDER_MARKS } from '@ledge/ui/logos/providers';
import { copy } from '../../copy';
import { reached, resetIsDate, resetLabel, shownUsage, span, usageTone } from '../../model/usage';
import { IN_ANSWER } from './TurnView';

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
        <b className={`font-medium ${TONE_TEXT[tone]}`}>{copy.percent(w.pct)}</b>
        {at && <small className="ml-1.5 text-[11px] text-muted">{reached(w) ? (w.resetsAt && resetIsDate(w.resetsAt, now) ? P.resumesOn(at) : P.resumes(at)) : `↺ ${at}`}</small>}
      </span>
    </div>
  );
}

/**
 * The limits under an answer that read them (m3-chat.html §2, Q31): one compact row per window, « Claude 5 h », « Codex sem. »,
 * its gauge, its percent and « ↺ » when it starts again. Only the 5 hours and the week of Claude and Codex: a model's week,
 * Cursor's windows and a harness without windows wait for Q89 and Q90 (design-ux 3ccd3da3).
 */
export function CompactLimits({ usage: given, now, alert, fresh = true, at }: { usage: readonly PhoneHarnessUsage[]; now: number; alert: number | null; fresh?: boolean; at: string }): JSX.Element | null {
  const P = copy.chat.point;
  const rows = shownUsage(given, now, fresh)
    .filter(h => h.harness !== 'cursor' && h.status !== 'loading' && h.status !== 'expired')
    .flatMap(h => h.windows.filter(w => w.kind === 'five_hour' || w.kind === 'seven_day').map(w => ({ h, w })));
  if (!rows.length) return null;
  return (
    <div role="group" aria-label={P.limitsLabel} className={IN_ANSWER}>
      <div className="flex flex-col">
      {rows.map(({ h, w }) => {
        const tone = usageTone(w.pct, alert);
        return (
          <div key={`${h.harness}:${w.kind}`} className="grid grid-cols-[66px_1fr_118px] items-center gap-2 py-0.5 text-[12px]">
            <span className="whitespace-nowrap">{`${P.harnessShort[h.harness] ?? h.harness} ${w.kind === 'five_hour' ? P.five : P.weekShort}`}</span>
            <UsageGauge pct={w.pct} alert={alert} />
            <span className="whitespace-nowrap font-mono text-[12px]">
              <b className={tone ? `font-medium ${TONE_TEXT[tone]}` : 'font-normal'}>{copy.percent(w.pct)}</b>
              {w.resetsAt && <small className="ml-[5px] text-[11px] text-muted">↺ {resetLabel(w.resetsAt, now, true)}</small>}
            </span>
          </div>
        );
      })}
      </div>
      <span className="text-[11.5px] text-muted">{P.stale(span(Math.max(0, now - Date.parse(at))))}</span>
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
            {h.status === 'expired' && <p className="py-1 text-small text-attention">{P.notOnPc(P.harness[h.harness] ?? h.harness)}</p>}
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
