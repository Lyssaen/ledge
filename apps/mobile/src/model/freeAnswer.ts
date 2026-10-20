import { UNTYPABLE } from '@ledge/protocol';

/** The longest free answer the PC accepts (the daemon's `OTHER_MAX`). */
export const OTHER_MAX = 2_000;

export type FreeAnswerProblem = 'empty' | 'long' | 'untypable';

/**
 * The same checks as the PC's, so the person sees why before sending: `text` is the answer as it will be typed
 * (trimmed), `problem` what stops it. The line-break test is made on the raw text, like the PC does.
 */
export function checkFreeAnswer(raw: string): { text: string; problem: FreeAnswerProblem | null } {
  const text = raw.trim();
  if (UNTYPABLE.test(raw)) return { text, problem: 'untypable' };
  if (text === '') return { text, problem: 'empty' };
  if (text.length > OTHER_MAX) return { text, problem: 'long' };
  return { text, problem: null };
}
