import type { RefObject } from 'react';
import { MESSAGE_MAX } from '@ledge/protocol';
import { copy } from '../../copy';
import { MessageField } from '../MessageField';
import type { Attachments } from '../useAttachments';

/** The question for Ledge: several lines allowed (Enter sends from a physical keyboard only), as the thread's field looks. */
export function Composer({ value, onChange, onSend, canSend, images, attachDisabled, fieldRef }: { value: string; onChange: (v: string) => void; onSend: () => void; canSend: boolean; images: Attachments; attachDisabled?: boolean; fieldRef?: RefObject<HTMLTextAreaElement | null> }) {
  return (
    <div className="flex flex-none flex-col gap-2 border-t border-line py-2.5">
      <MessageField
        id="chat-ask" label={copy.chat.field} sendLabel={copy.chat.send} value={value} onChange={onChange} onSend={onSend} canSend={canSend}
        oneLine={false} images={images} placeholder={copy.chat.placeholder} attachDisabled={attachDisabled} maxLength={MESSAGE_MAX}
        {...(fieldRef ? { fieldRef } : {})}
      />
      {images.error && <p role="alert" className="text-body text-attention">{images.error}</p>}
    </div>
  );
}
