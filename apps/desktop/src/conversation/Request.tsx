import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { blocked, replyBlock } from './sends';
import type { Conversations } from './useConversations';

/** The request waiting on the session, decided from the thread (spec §9.1): « Envoyé… » while in flight, the buttons back
 *  with the error after a failure. Disabled for a frozen or hook-only session. */
export function RequestBlock({ session: s, api }: { session: Session; api: Conversations }) {
  const { t } = useI18n();
  const c = t.conversation.request;
  const p = s.pending;
  if (!p) return null;
  const inFlight = api.sends.sent[s.id]?.kind === 'decision';
  const failed = api.sends.failed[s.id];
  const failure = failed?.kind === 'decision' ? failed : undefined;
  const off = !!blocked(s);
  const options = p.kind === 'question' ? p.options ?? [] : [];
  return (
    <section className={`thread-request ${s.state}`} data-request={p.kind} aria-label={c.kinds[p.kind]}>
      <strong>{c.kinds[p.kind]}{p.tool ? ` · ${p.tool}` : ''}</strong>
      <p>{p.text}</p>
      {p.body && <code>{p.body}</code>}
      {inFlight
        ? <p className="request-resolution" role="status">{c.sent}</p>
        : <>
            {failure && <p className="request-resolution" role="status">{c.failed(failure.message)}</p>}
            {p.kind !== 'question' && (
              <div className="request-actions">
                <button type="button" data-decision="deny" disabled={off} onClick={() => api.decide(s, 'deny')}>{c.deny}</button>
                <button type="button" data-decision="accept" disabled={off} onClick={() => api.decide(s, 'accept')}>{c.allow}</button>
              </div>
            )}
            {options.length > 0 && (
              <div className="request-actions">
                {options.map((o, i) => (
                  <button key={i} type="button" data-option={i + 1} title={p.optionDetails?.[i] || undefined} disabled={off} onClick={() => api.answer(s, i)}>{o}</button>
                ))}
              </div>
            )}
            {p.kind === 'question' && !replyBlock(s) && <small>{c.orReply}</small>}
          </>}
    </section>
  );
}
