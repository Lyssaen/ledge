import { useState } from 'react';
import { BROADCAST_SESSIONS_MAX } from '@ledge/protocol';
import { copy } from '../copy';
import type { MobileStore } from '../state/store';
import { Button } from '../ui/Button';

/** « Écrire au groupe »: a field under a group's head, or in a session's « Plus d'actions »; the answer says who got the message and who did not. `ids`: the
 *  group's live sessions; more than one broadcast takes is refused in words, never cut. */
export function GroupWrite({ store, label, ids, offline, startOpen = false, onCancel }: {
  store: MobileStore; label: string; ids: string[]; offline: boolean;
  /** « Plus d'actions » opens it on its field (m2-sessions.html §5); `onCancel` then puts the menu back. */ startOpen?: boolean; onCancel?: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ lines: string[]; error: boolean } | null>(null);
  const send = async () => {
    if (ids.length > BROADCAST_SESSIONS_MAX) { setReport({ lines: [copy.agents.tooMany(ids.length, BROADCAST_SESSIONS_MAX)], error: true }); return; }
    setBusy(true);
    const done = await store.broadcast(ids, text.trim());
    setBusy(false);
    if (done.sent) {
      const sent = done.sent;
      setReport({ lines: [...(sent.length ? [copy.agents.sentTo(sent)] : [copy.agents.nobody]), ...(done.refused ?? []).map(r => copy.agents.refusedLine(r.name, r.reason))], error: sent.length === 0 });
      if (sent.length) { setOpen(startOpen); setText(''); }
    } else if (done.status === 'expired') setReport({ lines: [copy.agents.uncertain], error: true });
    else setReport({ lines: [copy.agents.notSent], error: true });
  };
  return (
    <div className="pb-2">
      {!open && <button type="button" disabled={offline} onClick={() => { setReport(null); setOpen(true); }} className="text-meta text-info disabled:opacity-60">{copy.agents.writeGroup}</button>}
      {open && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`group-${ids[0]}`} className="sr-only">{copy.agents.writeGroupLabel(label)}</label>
          <textarea id={`group-${ids[0]}`} rows={2} value={text} disabled={busy} placeholder={copy.agents.writeGroupPlaceholder} onChange={e => setText(e.target.value)}
            className="min-h-11 w-full resize-none rounded-[14px] border border-input bg-surface px-3.5 py-[11px] text-base leading-5 text-fg placeholder:text-muted disabled:opacity-60" />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => { setOpen(false); setText(''); onCancel?.(); }}>{copy.agents.cancel}</Button>
            <Button variant="primary" className="flex-[2]" disabled={busy || !text.trim()} onClick={() => void send()}>{copy.agents.send}</Button>
          </div>
        </div>
      )}
      {report && <div role="status" className={`mt-1 text-meta ${report.error ? 'text-attention' : 'text-muted'}`}>{report.lines.map((l, i) => <p key={i} className="[overflow-wrap:anywhere]">{l}</p>)}</div>}
    </div>
  );
}
