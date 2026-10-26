import { PROJECT_COLORS, type ProjectColor } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';

/** The terminal's background, dark or light; the setting adds `auto`, that follows it. */
export type Tone = 'dark' | 'light';
export type ThemeChoice = 'auto' | Tone;
export const THEMES: readonly ThemeChoice[] = ['auto', 'dark', 'light'];
export const toneFor = (choice: ThemeChoice, background: Tone): Tone => (choice === 'auto' ? background : choice);

/** The mockup's palettes: Ledge's coral, one colour per state, and the backgrounds: the selected row, the status bar, a key,
 *  the primary button, inline code. */
export const PALETTES = {
  dark: {
    fg: '#e6e0dc', dim: '#8f8681', faint: '#5f5854', line: '#3a3532', sel: '#2b2725',
    coral: '#f07a62', blue: '#7fb2ec', red: '#f0806e', yellow: '#e6c46a', green: '#86cf9d', violet: '#b9a2f0',
    bar: '#1f1d1b', key: '#2c2926', primary: '#3a201b', code: '#2a2624',
    /** An irreversible action's button (the action card's « Dissoudre… »). */
    danger: '#4a1f1b'
  },
  light: {
    fg: '#24201d', dim: '#6b625d', faint: '#9b928c', line: '#cfc6be', sel: '#e8e1da',
    coral: '#c44a2f', blue: '#2c64b0', red: '#c2412f', yellow: '#8a6100', green: '#23824b', violet: '#6a4bc4',
    bar: '#ece6e0', key: '#e3dcd6', primary: '#f6d9d0', code: '#ece6e0',
    danger: '#f6d6d1'
  }
} as const satisfies Record<Tone, Record<string, string>>;
export type Palette = { -readonly [K in keyof typeof PALETTES.dark]: string };

/** The colours of the tone in use, read at each render: `setTone` changes them in place. */
export const C: Palette = { ...PALETTES.dark };
const stateColors = (p: Palette): Record<BotState, string> => ({
  approval: p.red, question: p.yellow, working: p.blue, starting: p.blue, idle: p.green, done: p.faint, error: p.red, readonly: p.dim
});
export const STATE_COLOR: Record<BotState, string> = stateColors(C);

let current: Tone = 'dark';
export const tone = (): Tone => current;
export function setTone(next: Tone): void {
  current = next;
  Object.assign(C, PALETTES[next]);
  Object.assign(STATE_COLOR, stateColors(C));
}

export const projectColor = (color: ProjectColor | undefined): string => (color ? PROJECT_COLORS[color] : C.dim);
