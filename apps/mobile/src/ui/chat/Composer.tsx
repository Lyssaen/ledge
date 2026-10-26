import { useLayoutEffect, useRef } from 'react';
import { MESSAGE_MAX } from '@ledge/protocol';
import { AttachmentChips } from '@ledge/ui/images';
import { copy } from '../../copy';
import { AttachButton, pastedImages } from '../Attach';
import type { Attachments } from '../useAttachments';

const MIN = 44;
const MAX = 120;

/** The question field, growing from 44 to 120 px, and its send button. Enter sends, Shift+Enter breaks the line. */
export function Composer({ value, onChange, onSend, canSend, images, attachDisabled }: { value: string; onChange: (v: string) => void; onSend: () => void; canSend: boolean; images: Attachments; attachDisabled?: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = `${MIN}px`;
    el.style.height = `${Math.min(MAX, Math.max(MIN, el.scrollHeight + el.offsetHeight - el.clientHeight))}px`;
  }, [value]);
  return (
    <form className="flex flex-none flex-wrap items-end gap-2 border-t border-line py-2.5" onSubmit={(e) => { e.preventDefault(); if (canSend) onSend(); }}>
      {images.items.length > 0 && <div className="w-full"><AttachmentChips items={images.items} onRemove={images.remove} size={{ w: 72, h: 54 }} removeLabel={copy.images.remove} lang="fr" /></div>}
      <AttachButton onFiles={images.add} disabled={attachDisabled} />
      <label htmlFor="chat-ask" className="sr-only">{copy.chat.field}</label>
      <textarea
        id="chat-ask" ref={field} rows={1} maxLength={MESSAGE_MAX} value={value} placeholder={copy.chat.placeholder}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => { const files = pastedImages(e); if (files.length === 0 || attachDisabled) return; e.preventDefault(); images.add(files); }}
        onKeyDown={(e) => {
          // Only a physical keyboard sends on Enter; on a touch keyboard Enter is a new line (the button sends).
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || !globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
          e.preventDefault();
          if (canSend) onSend();
        }}
        className="max-h-[120px] min-h-11 flex-1 resize-none rounded-[22px] border border-white/15 bg-surface px-3.5 py-[11px] text-base leading-5 text-fg placeholder:text-muted"
      />
      <button type="submit" disabled={!canSend} aria-label={copy.chat.send} className="grid size-11 flex-none place-items-center rounded-full bg-danger-btn text-fg disabled:opacity-40">
        <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>
      </button>
      {images.error && <p role="alert" className="w-full text-[13px] text-attention">{images.error}</p>}
    </form>
  );
}
