import { changeOf } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import type { Messages } from './i18n/lang.js';
import { oneLine } from './model/time.js';

export type NotifyMode = 'bell' | 'osc9' | 'off';
export const NOTIFY_MODES: readonly NotifyMode[] = ['bell', 'osc9', 'off'];

/** The requests that appeared since `was` (a new request, not one already on screen), as the line a notification says. */
export function asked(was: ReadonlyMap<string, Session>, now: readonly Session[], t: Messages['notify']): string[] {
  const out: string[] = [];
  for (const s of now) {
    const prev = was.get(s.id);
    if (!prev) continue; // a session seen for the first time (the start, a reconnect) is not news
    const c = changeOf(prev, s);
    if (c?.kind !== 'asked') continue;
    const text = oneLine(s.pending?.text ?? '').slice(0, 120);
    out.push(c.ask === 'approval' ? t.approval(s.name, text) : t.question(s.name, text));
  }
  return out;
}

/** What to write for one notification: BEL, or OSC 9 (a desktop notification in iTerm2, Windows Terminal, kitty, WezTerm, foot),
 *  wrapped for tmux's passthrough when the TUI runs inside tmux. */
export function notification(text: string, mode: NotifyMode, env: NodeJS.ProcessEnv): string {
  if (mode === 'off') return '';
  if (mode === 'bell') return '\u0007';
  const safe = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  const osc = `\u001b]9;${safe}\u0007`;
  return env.TMUX ? `\u001bPtmux;${osc.replaceAll('\u001b', '\u001b\u001b')}\u001b\\` : osc;
}

/** The terminal's title (OSC 0). */
export const title = (text: string): string => `\u001b]0;${text.replace(/[\u0000-\u001f\u007f]/g, ' ')}\u0007`;
