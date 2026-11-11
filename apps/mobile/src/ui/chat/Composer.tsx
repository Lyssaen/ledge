import { useLayoutEffect, useRef, type RefObject } from 'react';
import { MESSAGE_MAX } from '@ledge/protocol';
import { AttachmentChips } from '@ledge/ui/images';
import { copy, lang } from '../../copy';
import { AttachButton, pastedImages } from '../Attach';
import { physicalKeyboard } from '../MessageField';
import { Icon } from '../icons';
import type { Attachments } from '../useAttachments';

const MIN = 34;
const MAX = 120;

/**
 * The question for Ledge (m3-chat.html §1, §3): the field with its send button inside, « Arrêter » in that button's place while
 * Ledge answers (Q37), the images waiting above it, and under it while it has the focus « + Image », with « · Entrée envoie » from
 * a physical keyboard only (Q86: on a touch keyboard Enter breaks the line). The field stays usable during an answer; offline it
 * is greyed and takes nothing.
 */
export function Composer({ value, onChange, onSend, canSend, images, running, offline, onStop, fieldRef }: {
  value: string; onChange: (v: string) => void; onSend: () => void; canSend: boolean; images: Attachments;
  /** Ledge is answering: the button stops it. */ running: boolean; offline: boolean; onStop: () => void;
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const field = fieldRef ?? own;
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = `${MIN}px`;
    el.style.height = `${Math.min(MAX, Math.max(MIN, el.scrollHeight))}px`;
  }, [value, field]);
  const noAttach = running || offline;
  return (
    <div className="group flex flex-none flex-col gap-1.5 pt-1.5 pb-2">
      {images.items.length > 0 && <AttachmentChips items={images.items} onRemove={images.remove} size={{ w: 72, h: 54 }} removeLabel={copy.images.remove} lang={lang} />}
      <div className={`flex min-w-0 items-end gap-2 rounded-[10px] border border-input bg-surface py-[5px] pr-[5px] pl-3 focus-within:border-ring focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ring)_30%,transparent)] ${offline ? 'opacity-55' : ''}`}>
        <label htmlFor="chat-ask" className="sr-only">{copy.chat.field}</label>
        <textarea
          id="chat-ask" ref={field} rows={1} value={offline ? '' : value} disabled={offline} maxLength={MESSAGE_MAX} enterKeyHint="enter"
          placeholder={running ? copy.chat.answering : copy.chat.placeholder}
          onChange={e => onChange(e.target.value)}
          onPaste={e => { const files = pastedImages(e); if (files.length === 0 || noAttach) return; e.preventDefault(); images.add(files); }}
          // Enter sends from a physical keyboard only; on a touch keyboard, and with Shift, it breaks the line.
          onKeyDown={e => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey || !physicalKeyboard()) return;
            e.preventDefault();
            if (canSend) onSend();
          }}
          className="max-h-[120px] min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-[6px] text-base leading-[22px] text-fg outline-none placeholder:text-muted"
        />
        {running
          ? <button type="button" onClick={onStop} aria-label={copy.chat.stop} title={copy.chat.stop} className="grid size-9 flex-none place-items-center rounded-lg bg-raised text-fg"><Icon name="stop" className="size-4" /></button>
          : <button type="button" disabled={!canSend} onClick={onSend} aria-label={copy.chat.send} title={copy.chat.send} className="grid size-9 flex-none place-items-center rounded-lg bg-primary text-primary-fg disabled:opacity-40"><Icon name="send" className="size-[18px]" /></button>}
      </div>
      <p className="hidden items-center gap-1 text-[12px] leading-4 text-muted group-focus-within:flex">
        <AttachButton onFiles={images.add} disabled={noAttach} className="text-[12px] leading-4 text-muted disabled:opacity-50">{copy.chat.plusImage}</AttachButton>
        {physicalKeyboard() && <span>· {copy.chat.enterSends}</span>}
      </p>
      {images.error && <p role="alert" className="text-body text-attention">{images.error}</p>}
    </div>
  );
}
