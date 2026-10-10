import type { Tool } from '@ledge/protocol';
import { messagesFor, type Messages } from './i18n/lang';
/** A short elapsed time, localized: FR "2 min", EN "2m". */
export function relativeTime(iso: string, now = Date.now(), t: Messages = messagesFor()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return t.time.seconds(s);
  const m = Math.round(s / 60);
  if (m < 60) return t.time.minutes(m);
  const h = Math.round(m / 60);
  if (h < 24) return t.time.hours(h);
  return new Date(iso).toLocaleDateString(t.time.locale, { month: 'short', day: 'numeric' });
}
export const toolName = (t: Tool): string => ({ claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' })[t];
