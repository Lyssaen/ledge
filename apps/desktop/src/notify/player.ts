import { createWebAudioPlayer, type SoundPlayer } from '@ledge/ui/sounds/player';

let player: SoundPlayer | null = null;
/** One Web Audio player for the whole app, created on the first cue (silent where Web Audio is missing). */
export const appPlayer = (): SoundPlayer => (player ??= createWebAudioPlayer());
