import { CATEGORY_OF, USER_CUES, type Cue } from './cues';
import { VOLUME_GAIN, type FinishedNotify, type SoundPrefs } from './preferences';

/** One cue per 1.5 s (spec §7 ter): a burst of asks plays once, the handle shows the rest. */
export const SOUND_RATE_MS = 1500;
/** A snapshot right after connect replays every session as a join: those are not arrivals. */
export const SNAPSHOT_QUIET_MS = 1500;

export interface SoundInput { cue: Cue; sounds: SoundPrefs; finished: FinishedNotify; dnd: boolean; terminalInFront: boolean; lastPlayedAt: number | null; connectedAt: number | null; now: number }
export type SoundDecision = { play: true; gain: number } | { play: false; why: 'off' | 'dnd' | 'finished-setting' | 'category' | 'terminal' | 'snapshot' | 'rate' };

/** Pure: whether a cue plays now and how loud. The order of the cuts is the order of the settings view. */
export function decideSound(i: SoundInput): SoundDecision {
  const user = USER_CUES.has(i.cue);
  if (!i.sounds.enabled) return { play: false, why: 'off' };
  if (i.dnd) return { play: false, why: 'dnd' };
  if (i.cue === 'finished' && i.finished !== 'both' && i.finished !== 'sound') return { play: false, why: 'finished-setting' };
  if (!i.sounds.categories[CATEGORY_OF[i.cue]]) return { play: false, why: 'category' };
  if (!user && i.sounds.onlyWhenTerminalBehind && i.terminalInFront) return { play: false, why: 'terminal' };
  if (i.cue === 'join' && i.connectedAt !== null && i.now - i.connectedAt < SNAPSHOT_QUIET_MS) return { play: false, why: 'snapshot' };
  if (!user && i.lastPlayedAt !== null && i.now - i.lastPlayedAt < SOUND_RATE_MS) return { play: false, why: 'rate' };
  return { play: true, gain: VOLUME_GAIN[i.sounds.volume] };
}
