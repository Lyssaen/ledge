import type { Messages } from '../i18n/lang.js';

/** How long ago `iso` was, short: « 5 min », « 30 s ». */
export function ago(iso: string, now: number, t: Messages['time']): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 5) return t.now;
  if (s < 60) return t.s(s);
  const m = Math.floor(s / 60);
  if (m < 60) return t.min(m);
  const h = Math.floor(m / 60);
  return h < 24 ? t.h(h) : t.d(Math.floor(h / 24));
}

/** HH:MM in local time. */
export const clock = (iso: string): string => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** One line: newlines folded to spaces, markdown's emphasis and code marks dropped. */
export const oneLine = (s: string): string => s.replace(/\*\*|__|`/g, '').replace(/\s*\n\s*/g, ' ').trim();
