import { CUES, type Cue } from './cues';

export interface SoundPlayer { play(cue: Cue, gain: number): void }

export function createSilentPlayer(): SoundPlayer { return { play() {} }; }

/**
 * Web Audio synthesis, no files (spec §7 ter). The context is created on the first cue and reused; a browser that has
 * none, or refuses it, makes the player silent without an error. 8 ms attack, exponential release, peak capped at 0.5.
 */
export function createWebAudioPlayer(): SoundPlayer {
  let ctx: AudioContext | null | undefined;
  const context = (): AudioContext | null => {
    if (ctx === undefined) {
      const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      try { ctx = AC ? new AC() : null; } catch { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx ?? null;
  };
  return {
    play(cue, gain) {
      const c = context(); if (!c) return;
      try {
        const t0 = c.currentTime;
        for (const n of CUES[cue]) {
          const o = c.createOscillator(), g = c.createGain();
          const peak = Math.min(0.5, n.gain * gain);
          o.type = n.type; o.frequency.setValueAtTime(n.freq, t0 + n.at);
          if (n.glideTo) o.frequency.exponentialRampToValueAtTime(n.glideTo, t0 + n.at + n.dur);
          g.gain.setValueAtTime(0.0001, t0 + n.at);
          g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
          o.connect(g); g.connect(c.destination);
          o.start(t0 + n.at); o.stop(t0 + n.at + n.dur + 0.02);
        }
      } catch { /* a cue that cannot play is dropped: sound is never load-bearing */ }
    }
  };
}
