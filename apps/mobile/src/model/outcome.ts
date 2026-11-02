// What a passkey-confirmed operation came to, as a sheet says it: « Le PC »'s update or restart.
import { copy } from '../copy';
import type { ChatAction } from '../state/chat';

export interface OutcomeNote { text: string; quiet: boolean }

/**
 * A passkey that was cancelled or expired is a quiet note; a refusal says why when the phone has words for it (`copy.confirm.refused`),
 * otherwise `fallback` says only that nothing was done.
 */
export function outcomeNote(r: ChatAction, fallback: string): OutcomeNote {
  switch (r.status) {
    case 'applied': return { text: fallback, quiet: false };
    case 'cancelled': return { text: copy.confirm.cancelled, quiet: true };
    case 'expired': return { text: copy.confirm.expired, quiet: true };
    case 'rejected':
      if (r.reason === 'assertion_expired') return { text: copy.confirm.expired, quiet: true };
      return { text: copy.confirm.refused[r.reason] ?? fallback, quiet: false };
    default: return { text: fallback, quiet: false };
  }
}
