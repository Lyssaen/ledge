import { useEffect, useRef, useState, type JSX } from 'react';
import type { UsageHarness, UsageWindow } from '@ledge/protocol';
import { harnessShell } from '@ledge/ui/bots/Bot';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { resetLong, resetShort, shownWindows, span, usageTone, type UsageGroup } from './model';

/** A harness's logo: its Ledge silhouette (issue #61), filled in the harness's colour, without the eyes (M2). */
export function HarnessLogo({ harness, size = 15 }: { harness: UsageHarness; size?: number }): JSX.Element {
  const { viewBox, d } = harnessShell(harness);
  const [, , w, h] = viewBox.split(' ').map(Number) as [number, number, number, number];
  return (
    <svg className={`harness-logo harness-${harness}`} width={size} height={Math.round((size * h) / w)} viewBox={viewBox} aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

const Gauge = ({ pct, tone }: { pct: number; tone: string }) => (
  <span className={cls('ugauge', tone)}><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
);

/** One window in the footer: its label, a mini gauge, the percent and, when there is room, when it starts again. */
function Mini({ label, w, threshold, reset, now }: { label: string; w: UsageWindow; threshold: number; reset: boolean; now: number }) {
  const { lang } = useI18n();
  const tone = usageTone(w.pct, threshold);
  return (
    <span className={cls('umini', tone)}>
      <span className="ulb">{label}</span><Gauge pct={w.pct} tone={tone} /><b>{w.pct} %</b>
      {reset && w.resetsAt && <span className="urs">↺ {resetShort(w.resetsAt, now, lang)}</span>}
    </span>
  );
}

export interface UsageFooterProps {
  groups: UsageGroup[];
  threshold: number;
  /** A machine's label by its id. */
  label(machine: string): string;
  onSettings(): void;
  now: number;
}

/**
 * The right of the footer (variant B): per account its harness's logo, the 5 hours and the week, the models past the threshold,
 * and how old the values are when they are; a click opens the detail above it. Machine names when one harness has two
 * accounts, and always on Codex's (N2). Nothing at all when no harness gives limits (M: « Aucune »).
 */
export function UsageFooter(p: UsageFooterProps): JSX.Element | null {
  const { t, lang } = useI18n();
  const u = t.usage;
  const [open, setOpen] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); } };
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('keydown', escape, true); };
  }, [open]);
  if (!p.groups.length) return null;

  const harnesses = p.groups.map(g => g.harness);
  // The machine's name when one harness shows two groups; always for Codex, which has one group per machine (N2, decided
  // by the user over the mockup: its account cannot be told without reading auth.json).
  const multi = (g: UsageGroup) => g.harness === 'codex' || harnesses.filter(h => h === g.harness).length > 1;
  const two = p.groups.length > 1;
  const where = (g: UsageGroup) => g.machines.map(p.label).join(u.and);

  const group = (g: UsageGroup) => {
    const name = u.harness[g.harness] ?? g.harness;
    const who = <><HarnessLogo harness={g.harness} />{multi(g) && <span className="uhm">{where(g)}</span>}</>;
    if (g.status === 'loading') {
      return (
        <span className="ugroup" title={name}>{who}
          <span className="umini"><span className="ulb">{u.five}</span><span className="uskel" /></span>
          <span className="umini"><span className="ulb">{u.week}</span><span className="uskel" /></span>
        </span>
      );
    }
    if (g.status === 'expired') {
      return <span className="ugroup" title={name}>{who}<span className="umsg"><span className="wide">{u.expired}</span><span className="narrow">{u.expiredShort}</span></span></span>;
    }
    const s = shownWindows(g, p.threshold);
    const dim = g.status === 'stale' || g.status === 'unreachable';
    const age = g.status === 'unreachable' ? u.unreachable : g.status === 'stale' && g.readAt ? u.ago(span(p.now - Date.parse(g.readAt), lang)) : null;
    return (
      <button type="button" className={cls('ugroup', dim && 'dim', open === g.key && 'open', two && 'two')} title={name} aria-label={u.open(name)}
        aria-expanded={open === g.key} onClick={() => setOpen(o => (o === g.key ? null : g.key))}>
        {who}
        {s.five && <Mini label={u.five} w={s.five} threshold={p.threshold} reset={!(two && multi(g))} now={p.now} />}
        {s.week && <Mini label={two ? u.weekShort : u.week} w={s.week} threshold={p.threshold} reset={!two} now={p.now} />}
        {s.hot.map(w => <Mini key={w.model} label={w.model ?? ''} w={w} threshold={p.threshold} reset={false} now={p.now} />)}
        {age && <span className="uage">{age}</span>}
      </button>
    );
  };

  const shown = p.groups.find(g => g.key === open);
  return (
    <div className="usage-foot" ref={box}>
      {p.groups.map((g, i) => <span key={g.key} className="ugroup-wrap">{i > 0 && <span className="usep" aria-hidden="true" />}{group(g)}</span>)}
      {shown && <UsageDetail g={shown} threshold={p.threshold} where={where(shown)} now={p.now} onSettings={() => { setOpen(null); p.onSettings(); }} />}
    </div>
  );
}

/** The detail of one account's limits: the 5 hours, the week, then each model (no credits, no plan: M4). */
function UsageDetail({ g, threshold, where, now, onSettings }: { g: UsageGroup; threshold: number; where: string; now: number; onSettings(): void }) {
  const { t, lang } = useI18n();
  const u = t.usage;
  const s = shownWindows(g, threshold);
  const age = g.readAt ? span(now - Date.parse(g.readAt), lang) : null;
  const read = !age ? u.neverRead : g.status === 'stale' ? u.lastRead(age) : u.read(age);
  const sub = [u.signedIn(where), ...(g.status === 'unreachable' ? [g.harness === 'claude' ? u.unreachHost('api.anthropic.com') : u.unreachable] : []), read].join(' · ');
  const when = (w: UsageWindow, withIn: boolean) => {
    if (!w.resetsAt) return null;
    const at = resetLong(w.resetsAt, now, lang);
    if (w.pct >= 100) return u.resumes(at);
    return withIn ? u.resetIn(at, span(Date.parse(w.resetsAt) - now, lang)) : u.resetAt(at);
  };
  const row = (label: string, small: string | null, w: UsageWindow) => {
    const tone = usageTone(w.pct, threshold);
    return (
      <div key={label} className={cls('urow', tone)}>
        <div className="url">{label}{small && <small>{small}</small>}</div>
        <Gauge pct={w.pct} tone={tone} />
        <div className="urp">{w.pct} %</div>
      </div>
    );
  };
  return (
    <div className="usage-pop" role="dialog" aria-label={u.title(u.harness[g.harness] ?? g.harness)}>
      <h5>{u.title(u.harness[g.harness] ?? g.harness)}</h5>
      <div className="usub">{sub}</div>
      {s.five && row(u.session5, when(s.five, true), s.five)}
      {s.week && row(u.weekAll, when(s.week, false), s.week)}
      {s.models.length > 0 && <div className="usep-row">{u.perModel}</div>}
      {s.models.map(w => row(u.weekOf(w.model ?? ''), when(w, false), w))}
      <div className="ufoot"><span>{u.alertAt(Math.round(threshold * 100))}</span><button type="button" className="ulink" onClick={onSettings}>{u.settings}</button></div>
    </div>
  );
}
