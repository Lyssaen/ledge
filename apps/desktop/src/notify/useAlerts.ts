import { useEffect, useMemo, useRef } from 'react';
import type { DaemonStatus, MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import type { Cue } from '@ledge/ui/sounds/cues';
import { decideSound } from '@ledge/ui/sounds/decide';
import type { SoundPlayer } from '@ledge/ui/sounds/player';
import { VOLUME_GAIN } from '@ledge/ui/sounds/preferences';
import { useI18n } from '../i18n/lang';
import { foregroundIsTerminal, showToast } from '../tauri/bridge';
import { baselineOf, diffSessions, settledMachines, strongestCue, toastFor, type AlertBase } from './alerts';
import { appPlayer } from './player';
import { useDnd, useSoundPrefs } from './prefs';

export interface AlertDeps { player?: SoundPlayer; toast?: (title: string, body: string) => void; terminalInFront?: () => Promise<boolean>; focused?: () => boolean; now?: () => number }
export interface Alerts { user(cue: 'accept' | 'deny'): void; test(): 'played' | 'dnd' }

const nativeToast = (title: string, body: string) => { void showToast(title, body); };
const windowFocused = () => document.hasFocus();

/**
 * Toasts and sounds from session changes (spec §10). A toast only while Desktop is behind or in the tray, never in Do
 * not disturb; a sound through the island's `decideSound` (sounds off by default on Desktop). The terminal check is async,
 * so a cue is decided once it answers; nothing on screen waits for it.
 */
export function useAlerts(input: { sessions: readonly Session[]; machines: readonly MachineState[]; status: DaemonStatus }, deps: AlertDeps = {}): Alerts {
  const { finished, sounds } = useSoundPrefs();
  const [dnd] = useDnd();
  const { t } = useI18n();
  const live = useRef({ finished, sounds, dnd, copy: t.notify, deps });
  live.current = { finished, sounds, dnd, copy: t.notify, deps };
  const base = useRef<AlertBase>(baselineOf([], []));
  const lastPlayedAt = useRef<number | null>(null);
  const connectedAt = useRef<number | null>(null);
  const prevStatus = useRef(input.status);

  const api = useMemo(() => {
    const play = (cue: Cue) => {
      const l = live.current;
      const user = cue === 'accept' || cue === 'deny';
      const check = l.deps.terminalInFront ?? foregroundIsTerminal;
      void (l.sounds.onlyWhenTerminalBehind && !user ? check() : Promise.resolve(false)).then(front => {
        const c = live.current;
        const now = (c.deps.now ?? Date.now)();
        const d = decideSound({ cue, sounds: c.sounds, finished: c.finished, dnd: c.dnd, terminalInFront: front, lastPlayedAt: lastPlayedAt.current, connectedAt: connectedAt.current, now });
        if (!d.play) return;
        if (!user) lastPlayedAt.current = now;   // a tick of yours never silences the next ask
        (c.deps.player ?? appPlayer()).play(cue, d.gain);
      });
    };
    return {
      play,
      user: (cue: 'accept' | 'deny') => play(cue),
      /** The settings' Test: the question cue at the chosen volume; nothing in Do not disturb. */
      test: (): 'played' | 'dnd' => {
        const l = live.current;
        if (l.dnd) return 'dnd';
        (l.deps.player ?? appPlayer()).play('question', VOLUME_GAIN[l.sounds.volume]);
        return 'played';
      }
    };
  }, []);

  const settled = settledMachines(input.machines).join('\n');
  useEffect(() => {
    const changes = diffSessions(base.current, input.sessions);
    base.current = baselineOf(input.sessions, settled ? settled.split('\n') : []);
    if (changes.length === 0) return;
    const l = live.current;
    const cue = strongestCue(changes);
    if (cue) api.play(cue);
    if (l.dnd || (l.deps.focused ?? windowFocused)()) return;
    const toast = toastFor(changes, input.sessions, l.finished, l.copy);
    if (toast) (l.deps.toast ?? nativeToast)(toast.title, toast.body);
  }, [input.sessions, settled, api]);

  // The local daemon lost: once per outage, on open -> unreachable only; retries and the reconnection are silent (island rule).
  useEffect(() => {
    const was = prevStatus.current; prevStatus.current = input.status;
    if (input.status === 'open') connectedAt.current = (live.current.deps.now ?? Date.now)();
    if (was === 'open' && input.status === 'unreachable') api.play('error');
  }, [input.status, api]);

  return useMemo(() => ({ user: api.user, test: api.test }), [api]);
}
