// The iPad's opening fit of the Atelier (docs/mockups/ledge-ipad-atelier.html, view 4 « L'ajustement iPad »): pure, room
// sizes and the view in, a zoom and a direction out.
import type { PhoneSession } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';

/** The floor's padding around the rooms (atelier units): room for Ledge's desk above, the legend and zoom bar below. */
export const IPAD_PAD = { top: 56, side: 12, bottom: 34 };
/** The floor: a state (12 px at 100 %) at 11 px on screen. Below it, a room no longer fits whole and scrolls. */
export const IPAD_READ = 11 / 12;

export type Orient = 'land' | 'port';
export const orientOf = (view: { width: number; height: number }): Orient => (view.width >= view.height ? 'land' : 'port');

/**
 * Readable first: each room whole across the screen's short side (its height in landscape, its width in portrait), at the
 * most that fits, never above 100 % nor under IPAD_READ; the rooms run along the long side (a row in landscape, a column in
 * portrait), to scroll with one finger.
 */
export function ipadFit(rooms: readonly { w: number; h: number }[], view: { width: number; height: number }, orient: Orient): { zoom: number; along: 'row' | 'column' } {
  if (rooms.length === 0 || view.width <= 0 || view.height <= 0) return { zoom: 1, along: orient === 'land' ? 'row' : 'column' };
  const tall = Math.max(...rooms.map(r => r.h)), wide = Math.max(...rooms.map(r => r.w));
  const zoom = orient === 'land'
    ? Math.min(1, Math.max(IPAD_READ, (view.height - 4) / (tall + IPAD_PAD.top + IPAD_PAD.bottom)))
    : Math.min(1, Math.max(IPAD_READ, (view.width - 4) / (wide + 2 * IPAD_PAD.side)));
  return { zoom, along: orient === 'land' ? 'row' : 'column' };
}

/** A session's bot, as Ledge Desktop draws it: a resting parent whose sub-agent still works keeps working. */
const FROM_STATE: Record<PhoneSession['state'], BotState> = {
  starting: 'starting', working: 'working', waiting_input: 'question', waiting_permission: 'approval', idle: 'idle', exited: 'done', error: 'error'
};
export function phoneBotState(s: Pick<PhoneSession, 'state' | 'helpers'>): BotState {
  if (s.state === 'idle' && (s.helpers ?? []).some(h => h.state !== 'exited' && h.state !== 'idle')) return 'working';
  return FROM_STATE[s.state];
}

/** What waits for the person: a request or a question. */
export const waitingOf = (s: Pick<PhoneSession, 'state'>): boolean => s.state === 'waiting_permission' || s.state === 'waiting_input';
