import { useLayoutEffect, useRef, type RefObject } from 'react';
import { AttachmentChips } from '@ledge/ui/images';
import { copy } from '../copy';
import { AttachButton, pastedImages } from './Attach';
import { iconButtonClass } from './Button';
import { Icon } from './icons';
import type { Attachments } from './useAttachments';

const MIN = 44;
const MAX = 120;

/** Only a physical keyboard sends with Enter in a text that may hold line breaks; on a touch keyboard Enter breaks the line. */
const physicalKeyboard = () => globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;

/**
 * The phone's one message field: the images waiting under it, ＋, the text growing from 44 to 120 px as it wraps, and
 * the send button. `oneLine`: what is sent is typed on one line at the PC (an agent's instruction), so Enter always
 * sends and never breaks the line; else (a question for Ledge) Enter sends from a physical keyboard only, Shift+Enter
 * breaks the line.
 */
export function MessageField({ id, label, sendLabel, value, onChange, onSend, canSend, oneLine, images, placeholder, disabled = false, attachDisabled, maxLength, invalid = false, describedBy, fieldRef }: {
  id: string; label: string; sendLabel: string; value: string; onChange: (v: string) => void; onSend: () => void; canSend: boolean;
  oneLine: boolean; images: Attachments; placeholder?: string | undefined; disabled?: boolean; attachDisabled?: boolean | undefined;
  maxLength?: number | undefined; invalid?: boolean; describedBy?: string | undefined; fieldRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const field = fieldRef ?? own;
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = `${MIN}px`;
    el.style.height = `${Math.min(MAX, Math.max(MIN, el.scrollHeight + el.offsetHeight - el.clientHeight))}px`;
  }, [value, field]);
  const noAttach = attachDisabled ?? disabled;
  return (
    <div className="flex flex-col gap-2">
      {images.items.length > 0 && <AttachmentChips items={images.items} onRemove={images.remove} size={{ w: 72, h: 54 }} removeLabel={copy.images.remove} lang="fr" />}
      <div className="flex items-end gap-2">
        <AttachButton onFiles={images.add} disabled={noAttach} />
        <label htmlFor={id} className="sr-only">{label}</label>
        <textarea
          id={id} ref={field} rows={1} value={value} disabled={disabled} placeholder={placeholder} maxLength={maxLength}
          enterKeyHint={oneLine ? 'send' : 'enter'} aria-invalid={invalid} aria-describedby={describedBy}
          onChange={e => onChange(e.target.value)}
          onPaste={e => { const files = pastedImages(e); if (files.length === 0 || noAttach) return; e.preventDefault(); images.add(files); }}
          onKeyDown={e => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            if (!oneLine && (e.shiftKey || !physicalKeyboard())) return;
            e.preventDefault();
            if (canSend) onSend();
          }}
          className="max-h-[120px] min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-input bg-surface px-3.5 py-[11px] text-base leading-5 text-fg placeholder:text-muted disabled:opacity-60"
        />
        <button type="button" disabled={!canSend} onClick={onSend} aria-label={sendLabel} title={sendLabel} className={iconButtonClass({ variant: 'brand', round: true })}>
          <Icon name="arrowUp" />
        </button>
      </div>
    </div>
  );
}
