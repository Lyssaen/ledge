import type { BrainStatus, Escalation, LedgeThreadItem } from '@ledge/protocol';
import type { BrainInbox } from './inbox.js';
import type { LedgeThread } from '../ledgeThread.js';
import type { Responder } from '../ledgeSay.js';
import { log } from '../../log.js';

type UserItem = Extract<LedgeThreadItem, { kind: 'user' }>;
/** The thread bubble that tells the brain is stopped; the UI renders its « Démarrer » button on exactly this text. */
export const BRAIN_STOPPED_TEXT = 'Ledge est arrêté · Démarrer';
/** Announced once, when the user accepts the first activation offer. */
export const BRAIN_FIRST_TEXT = 'Je pense en continu désormais : je lis les escalades des rigs, je tranche ce que mon mandat permet après une minute, et je te passe le reste.';

/**
 * Ledge's thread answered by the brain (spec §5.1): the message is typed into the brain session and the answer comes back through
 * `ledge brain say`, so the promise settles at once. Without a brain the one-shot runner (`fallback`) serves, as before.
 * Only while no brain session exists yet (starting) does a message wait here; once a session exists the inbox's mailbox queues it.
 */
export function brainResponder(d: {
  inbox: Pick<BrainInbox, 'push'>; thread: Pick<LedgeThread, 'append'>; fallback: Responder;
  status: () => BrainStatus;
  /** Whether a brain session exists (starting or on). */
  hasSession: () => boolean;
  onStatus: (fn: (s: BrainStatus) => void) => () => void;
}): Responder {
  type Waiting = { item: UserItem; about?: Escalation; done: () => void };
  let waiting: Waiting[] = [];
  let announced = false;

  const stopped = (): void => {
    if (announced) return;
    announced = true;
    d.thread.append({ kind: 'ledge', text: BRAIN_STOPPED_TEXT });
  };
  /** The fallback answers; the stopped bubble first when the user wants a brain (enabled) that is not there. */
  const serve = async (item: UserItem, about?: Escalation): Promise<void> => {
    if (d.status().enabled === true) stopped();
    await d.fallback(item, about);
  };
  const send = async (item: UserItem, about?: Escalation): Promise<void> => {
    if (!d.inbox.push({ kind: 'user', item, about })) await serve(item, about);
  };

  d.onStatus(s => {
    if (s.state === 'on') announced = false;
    if (waiting.length === 0) return;
    if (d.hasSession()) {
      const batch = waiting; waiting = [];
      for (const w of batch) void send(w.item, w.about).catch(e => log(`brain responder: ${(e as Error).message}`)).finally(w.done);
    } else if (s.state !== 'starting') {
      const batch = waiting; waiting = [];
      for (const w of batch) void serve(w.item, w.about).catch(e => log(`brain responder: ${(e as Error).message}`)).finally(w.done);
    }
  });

  return async (item, about) => {
    const s = d.status();
    if (s.enabled !== true) return d.fallback(item, about);
    if (d.hasSession()) return send(item, about);
    if (s.state === 'starting') return new Promise<void>(done => { waiting.push({ item, about, done }); });
    return serve(item, about);
  };
}
