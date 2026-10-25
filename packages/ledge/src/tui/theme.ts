import { PROJECT_COLORS, type ProjectColor } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';

/** The mockup's palette: Ledge's coral, then one colour per state. */
export const C = {
  fg: '#e6e0dc', dim: '#8f8681', faint: '#5f5854', line: '#3a3532', sel: '#2b2725',
  coral: '#f07a62', blue: '#7fb2ec', red: '#f0806e', yellow: '#e6c46a', green: '#86cf9d', violet: '#b9a2f0'
} as const;

export const STATE_COLOR: Record<BotState, string> = {
  approval: C.red, question: C.yellow, working: C.blue, starting: C.blue, idle: C.green, done: C.faint, error: C.red, readonly: C.dim
};

export const projectColor = (color: ProjectColor | undefined): string => (color ? PROJECT_COLORS[color] : C.dim);
