import type { ChatRelay, Session } from '@ledge/protocol';
import { botState } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { Avatar, TOOL_NAMES } from '../shell/Person';

export type Pill = 'yours' | 'working' | 'waiting' | 'stopped';
/** Ported from the island (`apps/overlay/src/surface/RelayCard.tsx`; the step and source labels come from its `ChatView`). The island stays unchanged.
 *  The target session's state as the card words it: your turn, working, waiting for you, or stopped. */
export function relayPill(s: Session | undefined): Pill {
  if (!s || s.state === 'exited' || s.state === 'error') return 'stopped';
  if (s.state === 'waiting_input' || s.state === 'waiting_permission') return 'waiting';
  return botState(s) === 'idle' ? 'yours' : 'working';
}

export interface RelayCardProps {
  relay: ChatRelay;
  /** The target session as the fleet lists it; absent once it left the list. */
  session?: Session;
  busy: boolean; disabled: boolean;
  onSend: () => void; onCancel: () => void;
}

/** The instruction Ledge proposes to send to a session (spec §9.3; the island's RelayCard): proposed, queued, sent, or failed with a
 *  retry. Sending is the person's click. */
export function RelayCard(p: RelayCardProps) {
  const { t, lang } = useI18n();
  const c = t.chat.relay;
  const r = p.relay;
  const s = p.session;
  const state = r.status === 'sent' ? 'sent' : r.status === 'queued' ? 'queued' : r.error !== undefined ? 'failed' : 'proposed';
  const pill = relayPill(s);
  const time = r.sentAt ? new Date(r.sentAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <section className="ledge-card" data-relay-card={state} aria-label={c.label}>
      {state === 'sent' ? (
        <p className="ledge-card-done">{s && <Avatar session={s} size={20} />}<span>{c.sentTo} <strong>{r.name}</strong>{time && ` · ${time}`}</span></p>
      ) : <>
        <dl>
          <dt>{c.session}</dt>
          <dd className="ledge-card-session">
            {s && <Avatar session={s} size={24} />}
            <span><strong>{r.name}</strong>{s && <small>{TOOL_NAMES[r.tool]} · {s.repo ?? s.project}{s.branch && <> <code>{s.branch}</code></>}</small>}</span>
            <span className="ledge-pill" data-pill={pill}>{c.pill[pill]}</span>
          </dd>
          <dt>{c.instruction}</dt>
          <dd><blockquote>{r.text}</blockquote></dd>
        </dl>
        {state === 'failed' && <p className="ledge-card-error" role="status">{c.failed(r.error!)}</p>}
        {state === 'queued' ? (
          <div className="ledge-card-foot">
            <span className="ledge-queued-dot" aria-hidden="true" />
            <span><strong>{r.name}</strong> {c.queued}</span>
            <button type="button" className="settings-button" disabled={p.busy || p.disabled} onClick={p.onCancel}>{c.cancel}</button>
          </div>
        ) : (
          <div className="ledge-card-foot">
            <button type="button" className="primary" disabled={p.busy || p.disabled} onClick={p.onSend}>{p.busy ? c.sending : state === 'failed' ? c.retry : c.send}</button>
            <span>{c.orRephrase}</span>
          </div>
        )}
      </>}
    </section>
  );
}
