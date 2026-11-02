import { useRef, useState, type JSX } from 'react';
import { BROADCAST_SILENT, type BroadcastResult, type BroadcastTo, type Fleet } from '@ledge/fleet';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import type { Messages } from '../i18n/messages';
import { Modal } from '../shell/Modal';

/** What the sender is told: who got it, who refused it and why; the daemon's reason when nobody did. */
export function broadcastReport(r: BroadcastResult, b: Messages['broadcast']): string {
  const parts: string[] = [];
  if (r.sent.length) parts.push(b.sent(r.sent.length, r.sent.map(x => x.name).join(', ')));
  if (r.refused.length) parts.push(b.refused(r.refused.map(x => x.reason).join(' ; ')));
  if (!r.sent.length && r.reason) parts.unshift(r.reason === BROADCAST_SILENT ? b.silent : r.reason);
  return parts.join(' · ');
}

/**
 * « Écrire à tout le projet » or to the sessions picked in the sidebar (broadcast spec): one field and « Envoyer ». Each
 * machine holding them answers who got it, merged by the fleet: once anyone did, the dialog closes and the toast says so;
 * nobody, it stays with why. A resend after a silence keeps the rid, so no daemon writes it twice.
 */
export function BroadcastDialog({ to, label, fleet, onClose, onSent }: { to: BroadcastTo; label: string; fleet: Pick<Fleet, 'broadcast'>; onClose(): void; onSent(report: string): void }): JSX.Element {
  const { t } = useI18n();
  const b = t.broadcast;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The same text sent again after a silence is the same request.
  const pending = useRef<{ text: string; rid: string } | null>(null);
  const ok = text.trim() !== '' && !sending;
  const submit = async () => {
    if (!ok) return;
    const body = text.trim();
    if (pending.current?.text !== body) pending.current = { text: body, rid: `broadcast-${crypto.randomUUID()}` };
    setSending(true); setError(null);
    const r = await fleet.broadcast(to, body, pending.current.rid);
    setSending(false);
    if (r.sent.length) { onSent(broadcastReport(r, b)); return; }
    if (r.reason !== BROADCAST_SILENT) pending.current = null;
    setError(broadcastReport(r, b));
  };
  return (
    <Modal title={b.title(label)} className="broadcast-modal" onClose={onClose}>
      <form className="broadcast-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <textarea autoFocus rows={4} aria-label={b.field} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }} />
        {error && <p className="broadcast-error" role="alert">{error}</p>}
        <div className="confirm-actions">
          <Button type="button" onClick={onClose}>{b.cancel}</Button>
          <Button type="submit" variant="primary" disabled={!ok}>{b.send}</Button>
        </div>
      </form>
    </Modal>
  );
}
