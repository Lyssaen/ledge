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

/** A compact row's name (Q89): the harness's short name and its window, a model's week by the model's name; none for Cursor's pools. */
function compactLabel(harness: string, w: UsageWindow): string | null {
  const P = copy.chat.point;
  const name = P.harnessShort[harness] ?? harness;
  switch (w.kind) {
    case 'five_hour': return `${name} ${P.five}`;
    case 'seven_day': return `${name} ${P.weekShort}`;
    case 'month': return `${name} ${P.monthShort}`;
    case 'model': return `${P.model(w.model ?? name)} ${P.weekShort}`;
    default: return null;
  }
}

type CompactRow = { key: string; label: string } & ({ w: UsageWindow; dim: boolean } | { sentence: string; amber: boolean });

/**
 * The limits under an answer that read them (m3-chat.html §2, Q31): one compact row per window, « Claude 5 h », « Opus sem. »,
 * « Cursor mois », its gauge, its percent and « ↺ » when it starts again, even once reached (Q89 A: the red says it; Cursor's
 * total alone, its pools left to the answer). A harness without a readable window gets a row with « Limites »' sentence in the
 * gauge's place (Q90 A); old values stay at half, and « Lu il y a … » then says the oldest one's age.
 */
export function CompactLimits({ usage: given, now, alert, fresh = true, at }: { usage: readonly PhoneHarnessUsage[]; now: number; alert: number | null; fresh?: boolean; at: string }): JSX.Element | null {
  const P = copy.chat.point;
  const rows: CompactRow[] = [];
  const old: number[] = [];
  shownUsage(given, now, fresh).forEach((h, i) => {
    const name = P.harnessShort[h.harness] ?? h.harness;
    const line = (sentence: string, amber: boolean) => rows.push({ key: h.harness, label: name, sentence, amber });
    if (h.status === 'loading') return line(P.loading, false);
    if (h.status === 'expired') return line(P.notOnPc(P.harness[h.harness] ?? name), true);
    const g = given[i]!;
    // « Non lue »: Cursor answered without the limit (status ok, no window), as « Limites » says it.
    if (g.harness === 'cursor' && g.status === 'ok' && g.windows.length === 0 && g.readAt !== null) return line(P.unread, false);
    const dim = h.status === 'stale' || h.status === 'unreachable';
    const shown = h.windows.flatMap(w => { const label = compactLabel(h.harness, w); return label ? [{ key: `${h.harness}:${w.kind}:${w.model ?? ''}`, label, w, dim }] : []; });
    if (shown.length) { rows.push(...shown); if (dim && h.readAt) old.push(Date.parse(h.readAt)); return; }
    if (h.status === 'unreachable') line(h.readAt ? P.unreach(span(Math.max(0, now - Date.parse(h.readAt)))) : P.unreachNever, true);
  });
  if (!rows.length) return null;
  const since = Math.min(Date.parse(at), ...old);
  return (
    <div role="group" aria-label={P.limitsLabel} className={IN_ANSWER}>
      <div className="flex flex-col">
      {rows.map(r => {
        if ('sentence' in r) {
          return (
            <div key={r.key} className="grid grid-cols-[66px_1fr] items-center gap-2 py-0.5 text-[12px]">
              <span className="whitespace-nowrap">{r.label}</span>
              <span className={r.amber ? 'text-attention' : 'text-muted'}>{r.sentence}</span>
            </div>
          );
        }
        const tone = usageTone(r.w.pct, alert);
        return (
          <div key={r.key} className={`grid grid-cols-[66px_1fr_118px] items-center gap-2 py-0.5 text-[12px] ${r.dim ? 'opacity-50' : ''}`}>
            <span className="whitespace-nowrap">{r.label}</span>
            <UsageGauge pct={r.w.pct} alert={alert} />
            <span className="whitespace-nowrap font-mono text-[12px]">
              <b className={tone ? `font-medium ${TONE_TEXT[tone]}` : 'font-normal'}>{copy.percent(r.w.pct)}</b>
              {r.w.resetsAt && <small className="ml-[5px] text-[11px] text-muted">↺ {resetLabel(r.w.resetsAt, now, true)}</small>}
            </span>
          </div>
        );
      })}
      </div>
      {rows.some(r => 'w' in r) && <span className="text-[11.5px] text-muted">{P.stale(span(Math.max(0, now - since)))}</span>}
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
