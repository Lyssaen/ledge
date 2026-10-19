import { useState, type JSX, type MouseEvent } from 'react';
import type { Project, Session } from '@ledge/protocol';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../../i18n/lang';
import { spanOf } from '../../list/time';
import { taskOf } from '../../nav/agents';
import { ProjectSwatch } from '../../projects/ProjectSwatch';
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
}): JSX.Element | null {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  if (p.items.length === 0) return null;
  const shown = all ? p.items : p.items.slice(0, CAP);
  const units = t.list.when.units;
  return (
    <section className="st-attn" aria-label={t.side.yours}>
      <div className="st-label">
        <span>{t.side.yours}</span>
        <b className="st-badge">{p.items.length}</b>
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
      {p.items.length > CAP && (
        <button type="button" className="st-showall" onClick={() => setAll(v => !v)}>
          {all ? t.side.yoursLess : t.side.yoursMore(p.items.length - CAP)}
        </button>
      )}
    </section>
  );
}
