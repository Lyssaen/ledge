import type { Catalogue } from '../i18n/index.ts';

// The script of the « agents talk » scene: two terminals side by side, played step by step. The words come from the
// catalogue; what is language-neutral lives here: when each line shows and in which colour.

type Talk = Catalogue['talk'];

export type SceneLine<K extends string> = {
  /** The key of the line's text in the catalogue. */
  text: K;
  /** The first step at which the line shows. */
  from: number;
  /** The last step at which it shows; a line without one stays to the end. */
  until?: number;
  tone: 'plain' | 'dim' | 'ok' | 'command';
  /** A message received from another agent, drawn as a card. */
  card?: boolean;
};

/** Otto's terminal (Claude Code), on the left. */
export const leftLines: SceneLine<keyof Talk['left']>[] = [
  { text: 'testsPass', from: 0, tone: 'plain' },
  { text: 'tellNova', from: 1, tone: 'plain' },
  { text: 'send', from: 2, tone: 'command' },
  { text: 'waiting', from: 3, until: 4, tone: 'dim' },
  { text: 'delivered', from: 5, tone: 'ok' }
];

/** Nova's terminal (Codex CLI), on the right. */
export const rightLines: SceneLine<keyof Talk['right']>[] = [
  { text: 'fixing', from: 0, tone: 'plain' },
  { text: 'running', from: 0, until: 3, tone: 'dim' },
  { text: 'passed', from: 4, tone: 'ok' },
  { text: 'fixed', from: 4, tone: 'plain' },
  { text: 'message', from: 5, tone: 'plain', card: true },
  { text: 'ack', from: 6, tone: 'plain' }
];

/** One entry per step: how long it stays on screen and the caption that explains it. */
export const steps: { ms: number; caption: keyof Talk['captions'] }[] = [
  { ms: 1500, caption: 'apart' },
  { ms: 900, caption: 'apart' },
  { ms: 1300, caption: 'writes' },
  { ms: 2000, caption: 'waits' },
  { ms: 1400, caption: 'turnEnds' },
  { ms: 1800, caption: 'delivers' },
  { ms: 3400, caption: 'carriesOn' }
];

/** The step the page is built at: the end of the story, which is also what shows without JavaScript or motion. */
export const finalStep = steps.length - 1;

export const showsAt = (line: { from: number; until?: number }, step: number): boolean =>
  step >= line.from && (line.until === undefined || step <= line.until);
