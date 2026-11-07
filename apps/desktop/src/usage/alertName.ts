import type { UsageHarness, UsageWindow } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';

/** What a usage alert's window is called, in « À toi » and in the notification: the 5 hours, the week, a model, or for
 *  Cursor the month's or week's total and a pool. */
export function alertWindowName(u: Messages['usage'], harness: UsageHarness, w: UsageWindow): string {
  if (w.kind === 'five_hour') return u.alertFive;
  if (w.kind === 'month') return u.alertMonth;
  if (w.kind === 'pool') return (w.pool && u.pool[w.pool]) || u.alertModel(w.pool ?? '');
  if (w.kind === 'seven_day') return harness === 'cursor' ? u.alertWeekTotal : u.alertWeek;
  return u.alertModel(w.model ?? '');
}
