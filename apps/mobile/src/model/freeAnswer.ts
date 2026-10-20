import { MESSAGE_MAX, UNTYPABLE } from '@ledge/protocol';

/** The longest free answer the PC accepts: a reply's text, `MESSAGE_MAX`. */
export const OTHER_MAX = MESSAGE_MAX;

/** A lone digit 1-9: the PC reads it as the number of an option, never as text. */
const OPTION_NUMBER = /^[1-9]$/;

export type FreeAnswerProblem = 'empty' | 'long' | 'untypable' | 'digit';

/**
 * The same checks as the PC's, so the person sees why before sending: `text` is the answer as it will be typed
 * (trimmed), `problem` what stops it. Every check is made on that trimmed text, as the PC makes it. A lone digit would
 * pick an option instead of being typed, so it is refused too: the option is chosen above, or the answer written out.
 */
export function checkFreeAnswer(raw: string): { text: string; problem: FreeAnswerProblem | null } {
  const text = raw.trim();
  if (text === '') return { text, problem: 'empty' };
  if (UNTYPABLE.test(text)) return { text, problem: 'untypable' };
  if (text.length > OTHER_MAX) return { text, problem: 'long' };
  if (OPTION_NUMBER.test(text)) return { text, problem: 'digit' };
  return { text, problem: null };
}
