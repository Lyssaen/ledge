import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { DRAFT_MAX } from '../state/drafts';

export interface ComposerFormProps {
  ids: { form: string; field: string; hint: string };
  label: string; placeholder: string; send: string; hint: ReactNode;
  value: string;
  /** Disabled field, draft shown (spec §6 read-only). */
  frozen: boolean;
  /** False: typing stays possible, sending does not (a request waits, Ledge is answering). */
  canSend: boolean;
  onChange: (text: string) => void;
  onSend: () => void;
}

/** The reply form shared by a session's conversation and the chat with Ledge (spec §9.1, §9.3; mockup conversation.js l. 58 and
 *  94-95, ledge-chat.js): Ctrl/⌘ + Enter sends, Enter goes to a new line, an IME composition never sends, blank never sends. */
export function ComposerForm(p: ComposerFormProps) {
  const go = () => { if (p.canSend && p.value.trim()) p.onSend(); };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); go(); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    go();
  };
  return (
    <form className="conversation-composer" id={p.ids.form} onSubmit={onSubmit}>
      <label htmlFor={p.ids.field}>{p.label}</label>
      <textarea id={p.ids.field} name="reply" rows={3} maxLength={DRAFT_MAX} placeholder={p.placeholder} aria-describedby={p.ids.hint}
        value={p.value} disabled={p.frozen} onChange={e => p.onChange(e.target.value)} onKeyDown={onKeyDown} />
      <div className="composer-bottom">
        <small id={p.ids.hint} aria-live="polite">{p.hint}</small>
        <button type="submit" className="primary" disabled={!p.canSend || !p.value.trim()}>{p.send}</button>
      </div>
    </form>
  );
}
