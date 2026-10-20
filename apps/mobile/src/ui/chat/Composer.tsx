import { useLayoutEffect, useRef } from 'react';
import { copy } from '../../copy';

const MIN = 44;
const MAX = 120;

/** The question field, growing from 44 to 120 px, and its send button. Enter sends, Shift+Enter breaks the line. */
export function Composer({ value, onChange, onSend, canSend }: { value: string; onChange: (v: string) => void; onSend: () => void; canSend: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = `${MIN}px`;
    el.style.height = `${Math.min(MAX, Math.max(MIN, el.scrollHeight))}px`;
  }, [value]);
  return (
    <form className="flex flex-none items-end gap-2 border-t border-line py-2.5" onSubmit={(e) => { e.preventDefault(); if (canSend) onSend(); }}>
      <label htmlFor="chat-ask" className="sr-only">{copy.chat.field}</label>
      <textarea
        id="chat-ask" ref={field} rows={1} value={value} placeholder={copy.chat.placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (canSend) onSend();
        }}
        className="max-h-[120px] min-h-11 flex-1 resize-none rounded-[22px] border border-white/15 bg-surface px-3.5 py-[11px] text-base leading-5 text-fg placeholder:text-muted"
      />
      <button type="submit" disabled={!canSend} aria-label={copy.chat.send} className="grid size-11 flex-none place-items-center rounded-full bg-danger-btn text-fg disabled:opacity-40">
        <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>
      </button>
    </form>
  );
}
