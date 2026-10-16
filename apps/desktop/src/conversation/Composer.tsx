import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { ComposerForm } from './ComposerForm';
import { replyBlock } from './sends';
import type { Conversations } from './useConversations';

const IDS = { form: 'conversation-form', field: 'conversation-reply', hint: 'reply-hint' };

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
  return <ComposerForm ids={IDS} label={c.label(s.name)} placeholder={c.placeholder} send={c.send} hint={hint} value={draft}
    frozen={frozen} canSend={!block} onChange={text => api.setDraft(s.id, text)} onSend={() => api.reply(s, draft)} />;
}
