// What a passkey-confirmed teams operation came to, as the Équipes screens say it: shared by « Lever » and the role editor.
import type { PhoneSeatModel } from '@ledge/protocol';
import { copy } from '../copy';
import type { ChatAction } from '../state/chat';

/** `warn`: the operation was done, but not all of it (a note to read, not a failure). */
export interface OutcomeNote { text: string; quiet: boolean; warn?: true }

/**
 * A passkey that was cancelled or expired is a quiet note; a refusal says why when the tab has words for it (`copy.teams.reason`,
 * `reasons` overriding it for a screen that says it its own way), otherwise `fallback` says only that nothing was done.
 * A composition saved whose added seats did not start is applied with a warning naming `unstarted` (the roles whose seat holds no session).
 */
export function outcomeNote(r: ChatAction, fallback: string, reasons: Partial<Record<string, string>> = {}, unstarted: readonly string[] = []): OutcomeNote {
  switch (r.status) {
    case 'applied': return r.warn ? { text: copy.teams.team.composedUnstarted(unstarted), quiet: false, warn: true } : { text: fallback, quiet: false };
    case 'cancelled': return { text: copy.confirm.cancelled, quiet: true };
    case 'expired': return { text: copy.confirm.expired, quiet: true };
    case 'rejected':
      if (r.reason === 'assertion_expired') return { text: copy.confirm.expired, quiet: true };
      return { text: reasons[r.reason] ?? copy.teams.reason[r.reason] ?? fallback, quiet: false };
    default: return { text: fallback, quiet: false };
  }
}

/**
 * What a saved composition did to one seat's model, in a line. `canSwitch`: the session holding the seat can be switched from the phone
 * (false for a free seat). No entry for the role: nothing needed applying when the holder can switch (it already runs that pick), else the change waits for the seat's next start.
 */
export function seatModelNote(models: readonly PhoneSeatModel[] | undefined, role: string, sessionName: string, canSwitch: boolean): string {
  const o = copy.model.seat.outcome;
  const entry = models?.find(m => m.role === role);
  if (!entry) return canSwitch ? o.saved : o.next;
  if (entry.status === 'applied') return o.applied(sessionName);
  if (entry.status === 'scheduled') return o.scheduled(sessionName);
  if (entry.reason === undefined || entry.reason === 'not_launched') return o.next;
  return o.notApplied(sessionName, copy.model.failed[entry.reason]);
}
