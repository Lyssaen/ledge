import { useEffect, useRef, useState } from 'react';
import { UNTYPABLE } from '@ledge/protocol';
import { copy } from '../copy';
import { MESSAGE_MAX, QUICK_REPLIES, type Composer } from '../model/thread';
import type { Op } from '../state/operations';
import { Notice } from '../ui/Notice';

const ICON = 'size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]';
const TONE = { ok: 'text-ok', info: 'text-info', attention: 'text-attention', muted: 'text-muted' } as const;
const C = copy.thread.composer;

/** What stops an instruction from going, checked as the PC checks it, on the text as it will be sent (trimmed). */
export function replyProblem(draft: string): 'long' | 'untypable' | null {
  const text = draft.trim();
  if (text.length > MESSAGE_MAX) return 'long';
  if (UNTYPABLE.test(text)) return 'untypable';
  return null;
}

/** Why an instruction did not go, in words; the draft always stays. */
export function replyFailure(o: Op): { title: string; body: string } {
  if (o.phase === 'uncertain' || o.reason === 'not_taken') return { title: C.uncertainTitle, body: C.uncertain };
  const body = o.reason === 'busy' ? C.busy : o.reason === 'invalid' ? C.invalid(MESSAGE_MAX) : o.reason === 'untypable' ? C.untypable
    : o.reason === 'read_only' ? C.readOnly : C.lost;
  return { title: C.failTitle, body };
}

/**
 * The composer of a thread (boards Continue and Sent): an instruction for an agent that is free, with quick ones. A
 * text the PC would refuse (too long, or not typable on one line) is said so here and never sent.
 */
export function Reply({ name, composer, draft, onDraft, onSend, fresh, taken, checking, error, onReconnect }: {
  name: string; composer: Composer; draft: string; onDraft: (t: string) => void; onSend: () => void; fresh: boolean;
  taken: boolean; checking: boolean; error: { title: string; body: string } | null; onReconnect?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 4000);
    return () => clearTimeout(t);
  }, [busy]);
  const status = taken ? { tone: 'ok' as const, label: C.status.taken } : checking ? { tone: 'muted' as const, label: copy.decide.checking } : composer.status;
  const problem = replyProblem(draft);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <footer className="flex-none border-t border-line bg-bg px-3.5 pt-2 pb-3 [@media(max-height:650px)]:pb-2">
      <div className={`flex items-center gap-1.5 px-0.5 pb-2 text-[11px] ${TONE[status.tone]}`}><i className="inline-block size-1.5 flex-none rounded-full bg-current" />{status.label}</div>
      {error && (
        <div className="mb-2.5">
          <Notice title={error.title} tone="warning" role="alert">
            <p>{error.body}</p>
            {!fresh && onReconnect && (
              <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium disabled:opacity-45">
                {busy ? copy.link.reconnecting : C.reconnect}
              </button>
            )}
          </Notice>
        </div>
      )}
      {composer.enabled && (
        <div role="group" aria-label={C.quickLabel} className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none]">
          {QUICK_REPLIES.map(q => (
            <button key={q} type="button" onClick={() => { onDraft(q); ref.current?.focus(); }} className="min-h-11 flex-none rounded-[10px] border border-line px-3 text-xs whitespace-nowrap">{q}</button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor="draft" className="sr-only">{C.label(name)}</label>
        <textarea id="draft" ref={ref} rows={1} value={draft} disabled={!composer.enabled} placeholder={composer.placeholder} onChange={e => onDraft(e.target.value)}
          aria-invalid={problem !== null} aria-describedby={problem ? 'draft-problem' : undefined}
          className="max-h-[120px] min-h-12 w-full min-w-0 resize-none rounded-control border border-line bg-surface p-3 text-base leading-[22px] text-fg placeholder:text-muted disabled:opacity-60" />
        <button type="button" disabled={!composer.enabled || !draft.trim() || problem !== null} onClick={onSend} aria-label={C.send(name)} className="inline-flex size-12 flex-none items-center justify-center rounded-control bg-fg text-[#16181a] disabled:opacity-45">
          <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
        </button>
      </div>
      {problem && <p id="draft-problem" role="status" className="px-0.5 pt-1.5 text-[11px] text-attention">{problem === 'long' ? C.tooLong(MESSAGE_MAX) : C.untypable}</p>}
    </footer>
  );
}
