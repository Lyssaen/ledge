import { useState, type JSX, type MouseEvent } from 'react';
import { useAnswerState, type FleetAsk } from '@ledge/fleet';
import type { Escalation, Project, Rig, Session } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { seatName } from '@ledge/ui/chat/ledge/threadModel';
import { seatSession } from '@ledge/ui/rigs/model';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../../i18n/lang';
import { spanOf } from '../../list/time';
import { taskOf } from '../../nav/agents';
import { ProjectSwatch } from '../../projects/ProjectSwatch';
import { cls } from '../cls';
import { HelperBot, SessionBot } from '../SessionBot';
import { AskCard } from './AskCard';
import { useMotionPreferences } from '../../motionPreferences';
import { useTheme } from '../theme';
import { quickDecide, type AttnItem } from './model';

const CAP = 4;
const NO_RIGS: readonly Rig[] = [];

/** One escalation of « À toi »: who (seat, rig, age), « Catégorie · résumé », then the options when they are one question of two
 *  at most (the recommended one filled), else « Voir » opening the Ledge screen. Ledge answering within its grace says so. */
function EscalationRow(p: {
  escalation: Escalation; since: string; rigs: readonly Rig[]; paused: boolean;
  onAnswer?(id: string, answers: Record<string, string>): void; onSee?(e: Escalation): void;
}): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const e = p.escalation;
  const answer = useAnswerState(e.id);
  const rig = p.rigs.find(r => r.machine === e.machine && r.id === e.rigId);
  const seat = rig?.seats.find(x => x.ref === e.from);
  const who = seatName(e.from);
  const tool = seat && rig ? seatSession(seat, rig, new Map()).tool : 'claude';
  const copy = t.ledgeThread;
  const lead = [e.category ? copy.category(e.category) : null, e.summary].filter(Boolean).join(' · ');
  const q = e.questions.length === 1 ? e.questions[0]! : null;
  const busy = answer.state === 'sending' || answer.state === 'done';
  const note = answer.state === 'refused' ? (answer.code === 'already_answered' ? copy.escalation.alreadyAnswered : copy.escalation.refused(answer.code ?? 'failed', answer.reason)) : e.state === 'grace' ? copy.escalation.grace : '';
  return (
    <div className="st-card st-esc" data-escalation={e.id}>
      <span className="st-bot"><Bot tool={tool} state="question" pose={1} size={18} theme={theme} seed={e.from} paused={p.paused} reducedMotion={reduced} /></span>
      <div className="st-card-body">
        <div className="st-l1">
          <span className="st-name">{who}</span>
          {rig && <span className="st-where">{rig.name}</span>}
          <span className="st-time t-question">{shortWhen(p.since, t.list.when.units, t.list.when.now)}</span>
        </div>
        <div className="st-l2">
          <span className="st-req" title={lead}>{lead}</span>
          {q && q.options.length <= 2 ? q.options.map(o => (
            <button key={o.id} type="button" className={cls('st-qa', o.recommended && 'pri')} disabled={busy}
              onClick={() => p.onAnswer?.(e.id, { [q.id]: o.id })}>{o.label}</button>
          )) : <button type="button" className="st-qa" onClick={() => p.onSee?.(e)}>{t.side.see}</button>}
        </div>
        {note && <div className="st-l2"><span className="st-where" role="status">{note}</span></div>}
      </div>
    </div>
  );
}

/** « 12 min » / « 1 h » / « 3 d », or the list's « just now ». Same units as the tree. */
function shortWhen(iso: string, units: { min: string; h: string; d: string }, nowLabel: string): string {
  const span = spanOf(Date.now() - (Date.parse(iso) || 0));
  return span === 'now' ? nowLabel : `${span.n} ${units[span.unit]}`;
}

/** « À toi »: the requests and errors, oldest first, answered in place. At most four cards until the rest are asked for.
 *  A helper-routed request is named for the helper and points at its parent; the menu stays the parent's. */
export function Attention(p: {
  items: AttnItem[];
  current: string | null;
  projectOf: (s: Session) => { id: string; name: string; color: Project['color'] } | null;
  onOpen(id: string, helper?: string, focus?: 'reply'): void;
  onDecide(s: Session, ok: boolean): void;
  onMenu(id: string, e: MouseEvent): void;
  paused: boolean;
  /** The decisions sessions asked of the user (`ledge ask`), after the waiting sessions and before the near-limit ones. */
  asks?: readonly FleetAsk[];
  onAnswerAsk?(ask: FleetAsk, text: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** The sessions near their context limit, or whose relief failed (context handover spec §3.2): « Passer le relais », « Plus tard ». */
  near?: readonly Session[];
  onHandover?(id: string): void;
  onLater?(id: string): void;
  /** The rigs, for the escalation rows (rig name, the seat's bot). */
  rigs?: readonly Rig[];
  onAnswerEscalation?(id: string, answers: Record<string, string>): void;
  onSeeEscalation?(escalation: Escalation): void;
}): JSX.Element | null {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const asks = p.asks ?? [];
  const near = p.near ?? [];
  if (p.items.length === 0 && asks.length === 0 && near.length === 0) return null;
  const shown = all ? p.items : p.items.slice(0, CAP);
  const units = t.list.when.units;
  return (
    <section className="st-attn" aria-label={t.side.yours}>
      <div className="st-label">
        <span>{t.side.yours}</span>
        <b className="st-badge">{p.items.length + asks.length + near.length}</b>
        <span className="st-fill" />
        <Kbd>Alt ↓</Kbd>
      </div>
      {shown.map(item => {
        if (item.kind === 'escalation') {
          return <EscalationRow key={`esc:${item.escalation.machine}:${item.escalation.id}`} escalation={item.escalation} since={item.since}
            rigs={p.rigs ?? NO_RIGS} paused={p.paused} onAnswer={p.onAnswerEscalation} onSee={p.onSeeEscalation} />;
        }
        const who = item.helper?.kind ?? item.session.name;
        const project = p.projectOf(item.session);
        const where = item.helper ? t.side.ofHelper(item.session.name) : (project?.name ?? t.side.unassigned);
        const ask = item.session.pending?.text || (item.helper?.task ?? taskOf(item.session));
        return (
          <div key={item.session.id} className={cls('st-card', p.current === item.session.id && 'sel')}
            onContextMenu={e => { e.preventDefault(); p.onMenu(item.session.id, e); }}>
            <span className="st-bot">{item.helper
              ? <HelperBot helper={item.helper} parent={item.session} size={18} paused={p.paused} />
              : <SessionBot session={item.session} size={18} paused={p.paused} />}</span>
            <div className="st-card-body">
              <div className="st-l1">
                <button type="button" className="st-name" onClick={() => p.onOpen(item.session.id, item.helper?.id)}
                  aria-label={`${t.list.open} ${who}`}>{who}</button>
                <span className="st-where"><ProjectSwatch project={project} />{where}</span>
                <span className={cls('st-time', `t-${item.kind}`)}>{shortWhen(item.since, units, t.list.when.now)}</span>
              </div>
              <div className="st-l2">
                <span className="st-req" title={ask}>{ask}</span>
                {item.kind === 'approval' && (quickDecide(item.session) ? <>
                  <button type="button" className="st-qa pri" onClick={() => p.onDecide(item.session, true)}>{t.side.allow}</button>
                  <button type="button" className="st-qa" onClick={() => p.onDecide(item.session, false)}>{t.side.deny}</button>
                </> : <button type="button" className="st-qa" onClick={() => p.onOpen(item.session.id, item.helper?.id)}>{t.side.see}</button>)}
                {item.kind === 'question' && <button type="button" className="st-qa" onClick={() => p.onOpen(item.session.id, item.helper?.id, 'reply')}>{t.side.reply}</button>}
                {item.kind === 'error' && <button type="button" className="st-qa" onClick={() => p.onOpen(item.session.id, item.helper?.id)}>{t.side.see}</button>}
              </div>
            </div>
          </div>
        );
      })}
      {asks.map(a => <AskCard key={`ask:${a.machine}:${a.id}`} ask={a} onAnswer={text => p.onAnswerAsk?.(a, text) ?? Promise.resolve({ ok: false as const, reason: '?' })} />)}
      {near.map(s => {
        const failed = s.handover?.state === 'failed';
        const pct = s.context ? Math.round((s.context.used / s.context.window) * 100) : 0;
        return (
          <div key={`near:${s.id}`} className="st-card st-near" data-near={s.id}>
            <span className="st-bot st-near-mark" aria-hidden="true">{failed ? '!' : '◔'}</span>
            <div className="st-card-body">
              <div className="st-l1"><span className="st-req" title={failed ? s.handover?.reason : undefined}>{failed ? t.handover.failedShort(s.name) : t.handover.nearShort(s.name, pct)}</span></div>
              <div className="st-l2">
                <span className="st-where" title={failed ? s.handover?.reason : t.handover.nearHint}>{failed ? (s.handover?.reason ?? '') : ''}</span>
                <button type="button" className="st-qa pri" title={t.handover.passTitle} onClick={() => p.onHandover?.(s.id)}>{failed ? t.handover.retry : t.handover.pass}</button>
                <button type="button" className="st-qa" onClick={() => p.onLater?.(s.id)}>{t.handover.later}</button>
              </div>
            </div>
          </div>
        );
      })}
      {p.items.length > CAP && (
        <button type="button" className="st-showall" onClick={() => setAll(v => !v)}>
          {all ? t.side.yoursLess : t.side.yoursMore(p.items.length - CAP)}
        </button>
      )}
    </section>
  );
}
