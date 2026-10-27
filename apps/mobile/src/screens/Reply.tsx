import { useRef } from 'react';
import { UNTYPABLE } from '@ledge/protocol';
import { AttachmentChips } from '@ledge/ui/images';
import { copy } from '../copy';
import { MESSAGE_MAX, QUICK_REPLIES, type Composer } from '../model/thread';
import type { Op } from '../state/operations';
import { useBusy } from '../useBusy';
import { AttachButton, pastedImages } from '../ui/Attach';
import { Notice } from '../ui/Notice';
import type { Attachments } from '../ui/useAttachments';
import { buttonClass, chipClass, iconButtonClass } from '../ui/Button';
import { Icon } from '../ui/icons';

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
    : o.reason === 'read_only' ? C.readOnly : o.reason === 'attachment_missing' ? C.imageGone : o.reason === 'attachments_not_accepted' ? copy.images.dialog : C.lost;
  return { title: C.failTitle, body };
}

/**
 * The composer of a thread (boards Continue and Sent): an instruction for an agent that is free, with quick ones. A
 * text the PC would refuse (too long, or not typable on one line) is said so here and never sent.
 */
export function Reply({ name, composer, draft, onDraft, onSend, fresh, taken, checking, error, onReconnect, images, dialog }: {
  name: string; composer: Composer; draft: string; onDraft: (t: string) => void; onSend: () => void; fresh: boolean;
  /** The images waiting under the field. */ images: Attachments;
  /** A dialog waits: the images would be refused, they go after the answer. */ dialog: boolean;
  taken: boolean; checking: boolean; error: { title: string; body: string } | null; onReconnect?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useBusy();
  const status = taken ? { tone: 'ok' as const, label: C.status.taken } : checking ? { tone: 'muted' as const, label: copy.decide.checking } : composer.status;
  const problem = replyProblem(draft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const withImages = images.items.length > 0;
  // Text or images; an image still uploading, or refused, holds the send back.
  const canSend = composer.enabled && (!!draft.trim() || withImages) && problem === null && images.ready && !(withImages && dialog);
  return (
    <footer className="flex-none border-t border-line bg-bg px-3.5 pt-2 pb-3 [@media(max-height:650px)]:pb-2">
      <div className={`flex items-center gap-1.5 px-0.5 pb-2 text-[11px] ${TONE[status.tone]}`}><i className="inline-block size-1.5 flex-none rounded-full bg-current" />{status.label}</div>
      {error && (
        <div className="mb-2.5">
          <Notice title={error.title} tone="warning" role="alert">
            <p>{error.body}</p>
            {!fresh && onReconnect && (
              <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className={buttonClass({ block: true, className: 'mt-2' })}>
                {busy ? copy.link.reconnecting : C.reconnect}
              </button>
            )}
          </Notice>
        </div>
      )}
      {composer.enabled && (
        <div role="group" aria-label={C.quickLabel} className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none]">
          {QUICK_REPLIES.map(q => (
            <button key={q} type="button" onClick={() => { onDraft(q); ref.current?.focus(); }} className={`${chipClass()} whitespace-nowrap`}>{q}</button>
          ))}
        </div>
      )}
      {withImages && <div className="pb-2"><AttachmentChips items={images.items} onRemove={images.remove} size={{ w: 72, h: 54 }} removeLabel={copy.images.remove} lang="fr" /></div>}
      <div className="flex items-end gap-2">
        <AttachButton onFiles={images.add} disabled={!composer.enabled} />
        <label htmlFor="draft" className="sr-only">{C.label(name)}</label>
        <textarea id="draft" ref={ref} rows={1} value={draft} disabled={!composer.enabled} placeholder={composer.placeholder} onChange={e => onDraft(e.target.value)}
          enterKeyHint="send" onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) onSend(); } }}
          onPaste={e => { const files = pastedImages(e); if (files.length === 0 || !composer.enabled) return; e.preventDefault(); images.add(files); }}
          aria-invalid={problem !== null} aria-describedby={problem ? 'draft-problem' : undefined}
          className="max-h-[120px] min-h-12 w-full min-w-0 resize-none rounded-control border border-line bg-surface p-3 text-base leading-[22px] text-fg placeholder:text-muted disabled:opacity-60" />
        <button type="button" disabled={!canSend} onClick={onSend} aria-label={C.send(name)} className={iconButtonClass({ variant: 'primary', large: true })}>
          <Icon name="plane" />
        </button>
      </div>
      {withImages && dialog && <p role="status" className="px-0.5 pt-1.5 text-[11px] text-attention">{copy.images.dialog}</p>}
      {images.error && <p role="alert" className="px-0.5 pt-1.5 text-[11px] text-attention">{images.error}</p>}
      {problem && <p id="draft-problem" role="status" className="px-0.5 pt-1.5 text-[11px] text-attention">{problem === 'long' ? C.tooLong(MESSAGE_MAX) : C.untypable}</p>}
    </footer>
  );
}
