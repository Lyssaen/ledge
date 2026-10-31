import { useMemo, useState, type JSX } from 'react';
import { answerEscalation, sayToLedge, useAnswerState, useAsks, useEscalations, useOpenRig, useRigs, type DaemonClient } from '@ledge/fleet';
import type { Escalation, LedgeDecision, Rig, Session } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { seatName } from '@ledge/ui/chat/ledge/threadModel';
import { rigFilter, seatSession, workingCount } from '@ledge/ui/rigs/model';
import type { FleetView } from '../fleet/useFleet';
import type { Decisions } from '../fleet/decisions';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import type { NavAction } from '../nav/state';
import { rigsCount, visibleRigs } from '../rigs/RigsTab';
import { SessionBot } from '../shell/SessionBot';
import { attentionOf, quickDecide, type AttnItem } from '../shell/sidebar/model';
import { useTheme } from '../shell/theme';
import { cls } from '../shell/cls';

const NO_WAITS: ReadonlyMap<string, { since: string }> = new Map();

/** What « À toi » lists, by the one rule the sidebar uses (`attentionOf`): standalone sessions waiting and open decisions. */
export function useAttention(client: DaemonClient, sessions: readonly Session[], rigs: readonly Rig[], waits: ReadonlyMap<string, { since: string }> = NO_WAITS): AttnItem[] {
  const escalations = useEscalations(client);
  const asks = useAsks(client);
  return useMemo(() => attentionOf(sessions, waits, escalations, rigs, asks), [sessions, waits, escalations, rigs, asks]);
}

function EscalationItem(p: { client: DaemonClient; escalation: Escalation; rigs: readonly Rig[]; dispatch(a: NavAction): void; paused: boolean }): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const e = p.escalation;
  const answer = useAnswerState(e.id);
  const rig = p.rigs.find(r => r.machine === e.machine && r.id === e.rigId);
  const seat = rig?.seats.find(x => x.ref === e.from);
  const tool = seat && rig ? seatSession(seat, rig, new Map()).tool : 'claude';
  const q = e.questions.length === 1 ? e.questions[0]! : null;
  const busy = answer.state === 'sending' || answer.state === 'done';
  return (
    <li className="rail-row" data-escalation={e.id}>
      <span className="rail-bot"><Bot tool={tool} state="question" pose={1} size={18} theme={theme} seed={e.from} paused={p.paused} reducedMotion={reduced} /></span>
      <span className="rail-text"><b>{seatName(e.from)}</b> <span title={e.summary}>{q?.question ?? e.summary}</span></span>
      {q && q.options.length <= 2
        ? q.options.map(o => <button key={o.id} type="button" className={cls('st-qa', o.recommended && 'pri')} disabled={busy}
            onClick={() => { answerEscalation(p.client, e.id, { [q.id]: o.id }); }}>{o.label}</button>)
        : <button type="button" className="st-qa" onClick={() => p.dispatch({ type: 'ledge', tab: 'conversation', focus: e.id })}>{t.side.see}</button>}
    </li>
  );
}

/**
 * The right rail of the Ledge screen (spec §8.2, `c-A.png`): « À toi · n » (answered in place), « Rigs · n » with who is at work,
 * « Tranché aujourd'hui · n » (only with decisions: the store arrives with lot 7) and « Résumer la journée ». `compact` is the narrow
 * layout: one line « À toi · 3 · Rigs · 2 », expandable.
 */
export function LedgeRail(p: {
  view: FleetView; client: DaemonClient; dispatch: (a: NavAction) => void;
  waits?: ReadonlyMap<string, { since: string }>; decisions?: Decisions; paused?: boolean; compact?: boolean;
  /** What Ledge settled today (`by: 'ledge'`); the section is hidden while there are none. */
  settled?: readonly LedgeDecision[]; onRevisit?(d: LedgeDecision): void;
}): JSX.Element {
  const { client, view, dispatch } = p;
  const { t } = useI18n();
  const c = t.home.rail;
  const [open, setOpen] = useState(false);
  const allRigs = useRigs(client);
  const openrig = useOpenRig(client);
  const rigs = useMemo(() => visibleRigs(allRigs, openrig).filter(r => !r.kernel), [allRigs, openrig]);
  const count = rigsCount(allRigs, openrig);
  const items = useAttention(client, view.sessions, allRigs, p.waits);
  const paused = p.paused ?? false;
  const settled = (p.settled ?? []).filter(d => d.by === 'ledge');

  const body = (
    <>
      <section className="rail-sec" aria-label={c.yours(items.length)}>
        <h3>{c.yours(items.length)}</h3>
        <ul>
          {items.map(item => {
            if (item.kind === 'escalation') {
              return <EscalationItem key={`esc:${item.escalation.machine}:${item.escalation.id}`} client={client} escalation={item.escalation} rigs={allRigs} dispatch={dispatch} paused={paused} />;
            }
            const s = item.session;
            const ask = s.pending?.text || s.name;
            const openIt = (focus?: 'reply') => dispatch({ type: 'open', id: s.id, ...(item.helper ? { helper: item.helper.id } : {}), ...(focus ? { focus } : {}) });
            return (
              <li key={s.id} className="rail-row" data-session={s.id}>
                <span className="rail-bot"><SessionBot session={s} size={18} paused={paused} /></span>
                <span className="rail-text"><b>{s.name}</b> <span title={ask}>{item.kind === 'approval' ? ask : (s.pending?.text ?? '')}</span></span>
                {item.kind === 'approval' && quickDecide(s) ? <>
                  <button type="button" className="st-qa pri" onClick={() => { p.decisions?.decide(s, 'accept'); }}>{t.side.allow}</button>
                  <button type="button" className="st-qa" onClick={() => { p.decisions?.decide(s, 'deny'); }}>{t.side.deny}</button>
                </> : item.kind === 'question'
                  ? <button type="button" className="st-qa" onClick={() => openIt('reply')}>{t.side.reply}</button>
                  : <button type="button" className="st-qa" onClick={() => openIt()}>{t.side.see}</button>}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="rail-sec" aria-label={c.rigs(count)}>
        <h3>{c.rigs(count)}</h3>
        <ul>
          {rigs.map(r => {
            const live = r.seats.filter(x => x.state !== 'stopped').length;
            const n = workingCount(r);
            return (
              <li key={`${r.machine}/${r.id}`} className="rail-row" data-rig={r.id}>
                <span className="rail-text">{c.atWork(r.name, n, live)}</span>
                <span className="rail-bar" role="progressbar" aria-label={r.name} aria-valuemin={0} aria-valuemax={live} aria-valuenow={n}><i style={{ width: `${live ? Math.round((n / live) * 100) : 0}%` }} /></span>
                <button type="button" className="st-qa" onClick={() => dispatch({ type: 'home', project: rigFilter(r) })}>{c.table}</button>
              </li>
            );
          })}
        </ul>
      </section>
      {settled.length > 0 && (
        <section className="rail-sec" aria-label={c.settled(settled.length)}>
          <h3>{c.settled(settled.length)}</h3>
          <ul>
            {settled.map(d => (
              <li key={d.id} className="rail-row"><span className="rail-text">{d.summary}</span>
                <button type="button" className="st-qa" onClick={() => p.onRevisit?.(d)}>{c.revisit}</button></li>
            ))}
          </ul>
        </section>
      )}
      <button type="button" className="st-qa rail-sum" disabled={!view.machines.find(m => m.id === 'local')?.ready}
        onClick={() => sayToLedge(client, c.summarisePrompt)}>{c.summarise}</button>
    </>
  );
  if (!p.compact) return <aside className="home-rail" aria-label={c.label}>{body}</aside>;
  return (
    <aside className="home-rail compact" aria-label={c.label}>
      <button type="button" className="rail-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>{c.collapsed(items.length, count)}</button>
      {open && <div className="rail-open">{body}</div>}
    </aside>
  );
}
