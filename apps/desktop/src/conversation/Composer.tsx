import type { FormEvent, KeyboardEvent } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { DRAFT_MAX } from '../state/drafts';
import { replyBlock } from './sends';
import type { Conversations } from './useConversations';

/** The reply field (spec §9.1, mockup conversation.js l. 58 and 94-95): Ctrl/⌘ + Enter sends, Enter goes to a new line, one
 *  draft per qualified id. Free text is sent as it is, never read as a command. Frozen (disabled, draft shown) on a
 *  disconnected or hook-only session; while a request waits, the hint says why nothing can be sent. A failed reply is cleared by
 *  `setDraft` (typing again); other failures stay until the next send. */
export function Composer({ session: s, api }: { session: Session; api: Conversations }) {
  const { t } = useI18n();
  const c = t.conversation.composer;
  const draft = api.draft(s.id);
  const block = replyBlock(s);
  const sent = api.sends.sent[s.id];
  const failed = api.sends.failed[s.id];
  const hint = block ? c.blocked[block] : failed?.kind === 'reply' ? c.failed(failed.message) : sent?.kind === 'reply' ? c.sent : c.hint;
  const frozen = block === 'offline' || block === 'readonly';
  const send = () => { if (!block && draft.trim()) api.reply(s, draft); };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send();
  };
  return (
    <form className="conversation-composer" id="conversation-form" onSubmit={onSubmit}>
      <label htmlFor="conversation-reply">{c.label(s.name)}</label>
      <textarea id="conversation-reply" name="reply" rows={3} maxLength={DRAFT_MAX} placeholder={c.placeholder} aria-describedby="reply-hint"
        value={draft} disabled={frozen} onChange={e => api.setDraft(s.id, e.target.value)} onKeyDown={onKeyDown} />
      <div className="composer-bottom">
        <small id="reply-hint" aria-live="polite">{hint}</small>
        <button type="submit" className="primary" disabled={!!block || !draft.trim()}>{c.send}</button>
      </div>
    </form>
  );
}
