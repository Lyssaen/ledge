import { useRef } from 'react';
import { copy } from '../copy';

/** The ＋ button beside a field, with the hidden file input it opens (images, several at once). */
export function AttachButton({ onFiles, disabled, className }: { onFiles: (files: File[]) => void; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept="image/*" multiple hidden tabIndex={-1} aria-hidden="true"
        onChange={e => { onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <button type="button" disabled={disabled} aria-label={copy.images.attach} title={copy.images.attach} onClick={() => input.current?.click()}
        className={className ?? 'grid size-11 flex-none place-items-center rounded-full border border-white/15 text-fg disabled:opacity-40'}>
        <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </>
  );
}

/** The image files of a paste (a text paste has none and is left alone). */
export const pastedImages = (e: { clipboardData?: DataTransfer | null }): File[] => [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
