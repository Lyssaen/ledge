import { useRef, type ReactNode } from 'react';
import { copy } from '../copy';
import { iconButtonClass } from './Button';
import { Icon } from './icons';

/** The ＋ button beside a field, with the hidden file input it opens (images, several at once); `children` in the ＋'s place. */
export function AttachButton({ onFiles, disabled, className, children }: { onFiles: (files: File[]) => void; disabled?: boolean; className?: string; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept="image/*" multiple hidden tabIndex={-1} aria-hidden="true"
        onChange={e => { onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <button type="button" disabled={disabled} aria-label={children ? undefined : copy.images.attach} title={copy.images.attach} onClick={() => input.current?.click()}
        className={className ?? iconButtonClass({ variant: 'outline', round: true })}>
        {children ?? <Icon name="plus" />}
      </button>
    </>
  );
}

/** The image files of a paste (a text paste has none and is left alone). */
export const pastedImages = (e: { clipboardData?: DataTransfer | null }): File[] => [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
