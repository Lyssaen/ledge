import type { ClientMessage, DecidedBy, ServerMessage } from '@ledge/protocol';
import type { PointResult, createPointActor } from './act.js';
import type { Operator } from './index.js';

type PointAct = Extract<ClientMessage, { type: 'point.act' }>;
type ActMessage = Omit<PointAct, 'type'>;

/**
 * The operator's three client messages, as the daemon dispatches them. The PC's socket acts for the thread `desktop`; a phone's gateway
 * for `device:<id>`, so a device only ever reads, sets aside and answers in its own thread. The operator is looked up at each call: it
 * may not run (tests, a daemon started without it).
 */
export function pointHandlers(actor: Pick<ReturnType<typeof createPointActor>, 'act'>, operator: () => Pick<Operator, 'later' | 'read'> | undefined) {
  return {
    pc: {
      /** The error to send back, or undefined once the answer went. */
      async act(msg: ActMessage): Promise<ServerMessage | undefined> {
        const r: PointResult = await actor.act('desktop', msg);
        return r.ok ? undefined : { type: 'error', message: r.error, request: 'point.act', ...(r.code ? { code: r.code } : {}) };
      },
      later: (qid: string) => { operator()?.later('desktop', qid); },
      read: (eventId: number) => { operator()?.read('desktop', eventId); }
    },
    phone: {
      act: (device: string, msg: ActMessage, by: DecidedBy) => actor.act(`device:${device}`, msg, by),
      later: (device: string, qid: string) => { operator()?.later(`device:${device}`, qid); },
      read: (device: string, eventId: number) => { operator()?.read(`device:${device}`, eventId); }
    }
  };
}
