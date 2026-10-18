import type { SoundCategory } from './preferences';

export type Cue = 'approval' | 'question' | 'finished' | 'error' | 'accept' | 'deny' | 'join' | 'leave';
/** One oscillator: times in seconds from the cue start, `gain` the peak at Normal volume (0.12 ≈ −18 dBFS). */
export interface Note { freq: number; at: number; dur: number; type: 'sine' | 'triangle'; gain: number; glideTo?: number }

/** The palette (spec §7 ter): one family, asks rise or knock, results fall, the user's actions are ticks. */
export const CUES: Record<Cue, Note[]> = {
  approval: [{ freq: 220, at: 0, dur: 0.07, type: 'triangle', gain: 0.14 }, { freq: 220, at: 0.11, dur: 0.08, type: 'triangle', gain: 0.14 }],
  question: [{ freq: 659.25, at: 0, dur: 0.09, type: 'sine', gain: 0.12 }, { freq: 880, at: 0.09, dur: 0.16, type: 'sine', gain: 0.12 }],
  finished: [{ freq: 880, at: 0, dur: 0.14, type: 'sine', gain: 0.12 }, { freq: 587.33, at: 0.13, dur: 0.19, type: 'sine', gain: 0.12 }],
  error: [{ freq: 180, at: 0, dur: 0.22, type: 'triangle', gain: 0.12, glideTo: 120 }],
  accept: [{ freq: 1318.5, at: 0, dur: 0.035, type: 'sine', gain: 0.1 }],
  deny: [{ freq: 659.25, at: 0, dur: 0.045, type: 'sine', gain: 0.1 }],
  join: [{ freq: 330, at: 0, dur: 0.07, type: 'sine', gain: 0.1, glideTo: 660 }],
  leave: [{ freq: 330, at: 0, dur: 0.18, type: 'triangle', gain: 0.08, glideTo: 240 }]
};
export const CATEGORY_OF: Record<Cue, SoundCategory> = { approval: 'requests', question: 'requests', finished: 'finished', error: 'errors', accept: 'decisions', deny: 'decisions', join: 'team', leave: 'team' };
/** The user's own ticks: never rate-limited, never muted by the terminal rule (they clicked in the overlay). */
export const USER_CUES: ReadonlySet<Cue> = new Set<Cue>(['accept', 'deny']);
