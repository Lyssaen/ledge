import type { Tool } from '@ledge/protocol';
import type { ChatCopy } from './copy';

/** A short elapsed time, localized: FR "2 min", EN "2m". */
export function relativeTime(iso: string, now: number, time: ChatCopy['time']): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return time.seconds(s);
  const m = Math.round(s / 60);
  if (m < 60) return time.minutes(m);
  const h = Math.round(m / 60);
  if (h < 24) return time.hours(h);
  return new Date(iso).toLocaleDateString(time.locale, { month: 'short', day: 'numeric' });
}
export const toolName = (t: Tool): string => ({ claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' })[t];
