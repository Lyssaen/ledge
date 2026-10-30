import { useState, type JSX } from 'react';
import type { FleetAsk } from '@ledge/fleet';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../../i18n/lang';

/** A decision a session asks of the user (`ledge ask`): « Décision · de Nova », the question, the options, a field and « Répondre ».
 *  A refusal keeps the text; the card leaves « À toi » when the daemon says the ask is answered. */
export function AskCard({ ask, onAnswer }: { ask: FleetAsk; onAnswer(text: string): Promise<{ ok: true } | { ok: false; reason: string }> }): JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'refused'; reason: string }>({ kind: 'idle' });
  const sending = state.kind === 'sending';
  const send = async () => {
    const answer = text.trim();
    if (!answer || sending) return;
    setState({ kind: 'sending' });
    let r: { ok: true } | { ok: false; reason: string };
    try { r = await onAnswer(answer); } catch (e) { r = { ok: false, reason: (e as Error).message }; }
    setState(r.ok ? { kind: 'sent' } : { kind: 'refused', reason: r.reason });
  };
  return (
    <div className="st-card st-decision" data-ask={ask.id}>
      <div className="st-card-body">
        <div className="st-l1"><b className="st-decision-kicker">{t.side.ask.kicker}</b><span className="st-where">{t.side.ask.from(ask.fromName)}</span></div>
        <p className="st-decision-q">{ask.question}</p>
        {ask.options && <p className="st-decision-options">{ask.options}</p>}
        <textarea className="st-decision-field" rows={3} value={text} placeholder={t.side.ask.placeholder} aria-label={t.side.ask.placeholder}
          disabled={state.kind === 'sent'} onChange={e => { setText(e.target.value); if (state.kind === 'refused') setState({ kind: 'idle' }); }} />
        <div className="st-l2">
          <span className="st-req" role="status">{state.kind === 'sent' ? t.side.ask.sent(ask.fromName) : state.kind === 'refused' ? t.side.ask.refused(state.reason) : ''}</span>
          <Button variant="primary" size="sm" className="st-decision-send" disabled={!text.trim() || sending || state.kind === 'sent'} onClick={() => { void send(); }}>
            {sending ? t.side.ask.sending : t.side.ask.send}
          </Button>
        </div>
      </div>
    </div>
  );
}
