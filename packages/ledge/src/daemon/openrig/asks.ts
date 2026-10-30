import type { Ask, Escalation } from '@ledge/protocol';

const STATE = { open: 'pending', answered: 'answered', dropped: 'closed' } as const;

/** Lot 1 ask to escalation (mapping in the `Ask` doc comment). `from` = the Ledge session name, else the name the ask carried. */
export function askToEscalation(ask: Ask, ctx: { machine: string; nameOf(sessionId: string): string | undefined }): Escalation {
  const e: Escalation = { id: `ask-${ask.id}`, source: 'ask', machine: ctx.machine, from: ctx.nameOf(ask.from) ?? ask.fromName, intent: 'decision',
    summary: ask.question, questions: [], createdAt: ask.at, state: STATE[ask.state] };
  if (ask.options) e.detail = ask.options;
  if (ask.answer) e.answer = { by: 'user', answers: { text: ask.answer.text }, at: ask.answer.at };
  return e;
}
