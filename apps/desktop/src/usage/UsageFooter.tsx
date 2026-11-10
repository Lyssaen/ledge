import { useEffect, useRef, useState, type JSX } from 'react';
import type { UsageHarness, UsageWindow } from '@ledge/protocol';
import { HARNESS_PROVIDER, PROVIDER_MARKS } from '@ledge/ui/logos/providers';
import { openUrl } from '../tauri/bridge';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { isUnread, resetIsDate, resetLong, resetShort, shownWindows, span, usageTone, type UsageGroup } from './model';

/** A harness's logo: its provider's own mark (Claude's spark in its orange, OpenAI's, Cursor's cube in the text colour). */
export function HarnessLogo({ harness, size = 15 }: { harness: UsageHarness; size?: number }): JSX.Element {
  const mark = PROVIDER_MARKS[HARNESS_PROVIDER[harness]];
  return (
    <svg className="harness-logo" width={size} height={size} viewBox="0 0 24 24" fill={mark.fill} fillRule={mark.rule} aria-hidden="true">
      <path d={mark.d} fill={mark.fill} />
    </svg>
  );
}

/** What a hot window is called in the chip: a model's name, or for a Cursor pool its short name. */
const hotLabel = (w: UsageWindow, poolShort: Record<string, string>) => (w.kind === 'pool' ? (w.pool && poolShort[w.pool]) || '' : w.model ?? '');

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
  /** The alert setting the detail names (« Alerte à 80 % »), when the colours follow another threshold (the IDE's status bar has
   *  no amber, its alerts are toasts): `threshold` by default. */
  alertAt?: number;
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
    if (g.status === 'loading' && g.harness === 'cursor') {
      return <span className="ugroup" title={name}>{who}<span className="umini"><span className="ulb">{u.month}</span><span className="uskel" /></span></span>;
    }
    if (g.status === 'loading') {
      return (
        <span className="ugroup" title={name}>{who}
          <span className="umini"><span className="ulb">{u.five}</span><span className="uskel" /></span>
          <span className="umini"><span className="ulb">{u.week}</span><span className="uskel" /></span>
        </span>
      );
    }
    if (g.status === 'expired') {
      return <span className="ugroup" title={name}>{who}<span className="umsg"><span className="wide">{u.expired(name)}</span><span className="narrow">{u.expiredShort(name)}</span></span></span>;
    }
    const s = shownWindows(g, p.threshold);
    const total = s.month ?? (g.harness === 'cursor' ? s.week : undefined);
    const dim = g.status === 'stale' || g.status === 'unreachable';
    const age = g.status === 'unreachable' ? u.unreachable : g.status === 'stale' && g.readAt ? u.ago(span(p.now - Date.parse(g.readAt), lang)) : null;
    return (
      <button type="button" className={cls('ugroup', dim && 'dim', open === g.key && 'open', two && 'two')} title={name} aria-label={u.open(name)}
        aria-expanded={open === g.key} onClick={() => setOpen(o => (o === g.key ? null : g.key))}>
        {who}
        {g.harness === 'cursor' && isUnread(g, p.now) && <span className="unr">{u.unread}</span>}
        {g.harness === 'cursor' && total && <Mini label={s.month ? u.month : u.week} w={total} threshold={p.threshold} reset={!two} now={p.now} />}
        {g.harness !== 'cursor' && s.five && <Mini label={u.five} w={s.five} threshold={p.threshold} reset={!(two && multi(g))} now={p.now} />}
        {g.harness !== 'cursor' && s.week && <Mini label={two ? u.weekShort : u.week} w={s.week} threshold={p.threshold} reset={!two} now={p.now} />}
        {s.hot.map(w => <Mini key={`${w.kind}:${w.pool ?? w.model}`} label={hotLabel(w, u.poolShort)} w={w} threshold={p.threshold} reset={false} now={p.now} />)}
        {age && <span className="uage">{age}</span>}
      </button>
    );
  };

  const shown = p.groups.find(g => g.key === open);
  return (
    <div className="usage-foot" ref={box}>
      {p.groups.map((g, i) => <span key={g.key} className="ugroup-wrap">{i > 0 && <span className="usep" aria-hidden="true" />}{group(g)}</span>)}
      {shown && <UsageDetail g={shown} threshold={p.threshold} alertAt={p.alertAt ?? p.threshold} where={where(shown)} now={p.now} onSettings={() => { setOpen(null); p.onSettings(); }} />}
    </div>
  );
}

/** The API each harness's limits are read from, named when it does not answer. */
const HOSTS: Partial<Record<UsageHarness, string>> = { claude: 'api.anthropic.com', cursor: 'api2.cursor.sh' };

/** The detail of one account's limits: the 5 hours, the week, then each model (no credits, no plan: M4). */
function UsageDetail({ g, threshold, alertAt, where, now, onSettings }: { g: UsageGroup; threshold: number; alertAt: number; where: string; now: number; onSettings(): void }) {
  const { t, lang } = useI18n();
  const u = t.usage;
  const s = shownWindows(g, threshold);
  const age = g.readAt ? span(now - Date.parse(g.readAt), lang) : null;
  // Never read: nothing about when (a first failed read says only that it is unreachable).
  const read = !age ? (g.status === 'unreachable' ? null : u.neverRead) : g.status === 'stale' ? u.lastRead(age) : u.read(age);
  const sub = [u.signedIn(where), ...(g.status === 'unreachable' ? [HOSTS[g.harness] ? u.unreachHost(HOSTS[g.harness]!) : u.unreachable] : []), ...(read ? [read] : [])].join(' · ');
  const when = (w: UsageWindow, withIn: boolean) => {
    if (!w.resetsAt) return null;
    const date = resetIsDate(w.resetsAt, now);
    const at = resetLong(w.resetsAt, now, lang);
    if (w.pct >= 100) return u.resumes(at, date);
    return withIn ? u.resetIn(at, span(Date.parse(w.resetsAt) - now, lang), date) : u.resetAt(at, date);
  };
  // A Cursor pool: what it holds, then when it starts again (short), or that it is reached.
  const poolWhen = (w: UsageWindow) => {
    const hint = (w.pool && u.poolHint[w.pool]) || '';
    if (!w.resetsAt) return hint || null;
    const date = resetIsDate(w.resetsAt, now);
    const at = resetShort(w.resetsAt, now, lang);
    return [hint, w.pct >= 100 ? u.resumesOn(at, date) : u.resetAt(at, date)].filter(Boolean).join(' · ');
  };
  const cursor = g.harness === 'cursor';
  const unread = cursor && isUnread(g, now);
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
      {unread && <div className="umsg2">{u.unreadMsg}</div>}
      {s.five && row(u.session5, when(s.five, true), s.five)}
      {s.month && row(u.monthTotal, when(s.month, true), s.month)}
      {s.week && (cursor ? row(u.weekCursor, when(s.week, true), s.week) : row(u.weekAll, when(s.week, false), s.week))}
      {s.models.length > 0 && <div className="usep-row">{u.perModel}</div>}
      {s.models.map(w => row(u.weekOf(w.model ?? ''), when(w, false), w))}
      {s.pools.length > 0 && <div className="usep-row">{u.perPool}</div>}
      {s.pools.map(w => row((w.pool && u.pool[w.pool]) || '', poolWhen(w), w))}
      <div className="ufoot">
        <span>{unread ? '' : u.alertAt(Math.round(alertAt * 100))}</span>
        <span className="ulinks">
          {unread && <button type="button" className="ulink" onClick={() => openUrl('https://cursor.com/dashboard?tab=usage')}>{u.dashboard}</button>}
          <button type="button" className="ulink" onClick={onSettings}>{u.settings}</button>
        </span>
      </div>
    </div>
  );
}
