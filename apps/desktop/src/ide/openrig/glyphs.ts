import { SHELL_ICONS } from '../../shell/icons';

/** The start, restart and stop buttons' glyphs on the OpenRig page (the rail and the rig cards). */
const RESTART = ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'];
export const POWER_GLYPH: Record<'start' | 'restart' | 'stop', readonly string[]> = { start: SHELL_ICONS.play, restart: RESTART, stop: SHELL_ICONS.stop };
