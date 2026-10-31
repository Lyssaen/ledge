import { useState, type JSX, type MouseEvent } from 'react';
import type { Project, Session, Task } from '@ledge/protocol';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../../i18n/lang';
import { spanOf } from '../../list/time';
import { taskOf } from '../../nav/agents';
import { ProjectSwatch } from '../../projects/ProjectSwatch';
import { DecisionAnswer } from '../../teams/DecisionAnswer';
import type { TeamsApi } from '../../teams/useTeamsApi';
import { cls } from '../cls';
import { HelperBot, SessionBot } from '../SessionBot';
import { quickDecide, type AttnItem } from './model';

const CAP = 4;

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
  /** The decisions sessions put to the user, open (`ledge task give ledge …`): who asks, the title, the options, and
   *  « Répondre », answered in place through `answer` (task.answer). */
  decisions?: readonly Task[];
  answer?: TeamsApi['answer'];
  /** The closed tasks Ledge gave, not put away (roles spec §3.7): « ✓ Otto a fini … · tâche de Ledge », with « Voir ». */
  ledgeTasks?: readonly Task[];
  onSeeTask?(id: string): void;
  onDismissTask?(id: string): void;
  /** The sessions near their context limit, or whose relief failed (context handover spec §3.2): « Passer le relais », « Plus tard ». */
  near?: readonly Session[];
  onHandover?(id: string): void;
  onLater?(id: string): void;
}): JSX.Element | null {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const tasks = p.ledgeTasks ?? [];
  const near = p.near ?? [];
  const asked = p.decisions ?? [];
  const count = p.items.length + asked.length + tasks.length + near.length;
  if (count === 0) return null;
  const shown = all ? p.items : p.items.slice(0, CAP);
  const units = t.list.when.units;
  return (
    <section className="st-attn" aria-label={t.side.yours}>
      <div className="st-label">
        <span>{t.side.yours}</span>
        <b className="st-badge">{count}</b>
        <span className="st-fill" />
        <Kbd>Alt ↓</Kbd>
      </div>
      {shown.map(item => {
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
      {asked.map(x => (
        <div key={x.id} className="st-card st-task st-decision" data-decision={x.id}>
          <span className="st-bot st-task-mark" aria-hidden="true">?</span>
          <div className="st-card-body">
            <div className="st-l1"><span className="st-req" title={t.decision.asks(x.giverName)}><strong>{x.giverName}</strong> {x.title}</span></div>
            <div className="st-l2">
              <span className="st-where" title={x.text}>{x.text ?? ''}</span>
              {answering !== x.id && p.answer && <button type="button" className="st-qa pri" onClick={() => setAnswering(x.id)}>{t.decision.answer}</button>}
            </div>
            {answering === x.id && p.answer && <DecisionAnswer task={x} teams={{ answer: p.answer }} onClose={() => setAnswering(null)} />}
          </div>
        </div>
      ))}
      {tasks.map(x => (
        <div key={x.id} className="st-card st-task" data-task={x.id}>
          <span className="st-bot st-task-mark" aria-hidden="true">{x.state === 'done' ? '✓' : '!'}</span>
          <div className="st-card-body">
            <div className="st-l1"><span className="st-req">{t.home.point.closed(x.ownerName, x.title, x.state as 'done' | 'refused' | 'dropped')}</span></div>
            <div className="st-l2">
              <span className="st-where">{t.home.point.ofLedge}</span>
              <button type="button" className="st-qa" onClick={() => p.onSeeTask?.(x.id)}>{t.side.see}</button>
              <button type="button" className="st-qa" onClick={() => p.onDismissTask?.(x.id)}>{t.home.point.dismiss}</button>
            </div>
          </div>
        </div>
      ))}
      {near.map(s => {
        const failed = s.handover?.state === 'failed';
        const pct = s.context ? Math.round((s.context.used / s.context.window) * 100) : 0;
        return (
          <div key={`near:${s.id}`} className="st-card st-task st-near" data-near={s.id}>
            <span className="st-bot st-task-mark" aria-hidden="true">{failed ? '!' : '◔'}</span>
            <div className="st-card-body">
              <div className="st-l1"><span className="st-req" title={failed ? s.handover?.reason : undefined}>{failed ? t.handover.failedShort(s.name) : t.handover.nearShort(`${s.name}${s.role ? ` @${s.role}` : ''}`, pct)}</span></div>
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
