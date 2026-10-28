// What a passkey-confirmed teams operation came to, as the Équipes screens say it: shared by « Lever » and the role editor.
import { copy } from '../copy';
import type { ChatAction } from '../state/chat';

export interface OutcomeNote { text: string; quiet: boolean }

/**
 * A passkey that was cancelled or expired is a quiet note; a refusal says why when the tab has words for it (`copy.teams.reason`,
 * `reasons` overriding it for a screen that says it its own way), otherwise `fallback` says only that nothing was done.
 */
export function outcomeNote(r: ChatAction, fallback: string, reasons: Partial<Record<string, string>> = {}): OutcomeNote {
  switch (r.status) {
    case 'cancelled': return { text: copy.confirm.cancelled, quiet: true };
    case 'expired': return { text: copy.confirm.expired, quiet: true };
    case 'rejected':
      if (r.reason === 'assertion_expired') return { text: copy.confirm.expired, quiet: true };
      return { text: reasons[r.reason] ?? copy.teams.reason[r.reason] ?? fallback, quiet: false };
    default: return { text: fallback, quiet: false };
  }
}
