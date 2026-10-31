import type { Rig, RigSeat } from '@ledge/protocol';
import type { SeatSendResult } from '../ledgeSay.js';
import type { RigCli } from './cli.js';

export type { SeatSendResult };
export type SeatTarget = { ok: true; rig: Rig; seat: RigSeat } | { ok: false; reason: string; candidates?: string[] };

const ACTIVE = new Set<Rig['lifecycle']>(['running', 'partial']);
const DOWN = new Set<RigSeat['state']>(['stopped', 'crashed']);

/** The `@…` word at the head of the text and the rest; null when the text does not start with `@`. */
export function leadingAddress(text: string): { word: string; rest: string } | null {
  const m = /^\s*(@\S+)(?:\s+([\s\S]*))?$/.exec(text); if (!m) return null;
  const word = m[1]!.replace(/[,:;.!?]+$/, '');
  return word === '@' ? null : { word, rest: (m[2] ?? '').trim() };
}

const SEAT_DOWN: Partial<Record<RigSeat['state'], string>> = { stopped: 'arrêté', crashed: 'planté' };
const RIG_DOWN: Partial<Record<Rig['lifecycle'], string>> = { stopped: 'arrêté', launching: 'en cours de lancement', unreachable: 'injoignable' };

/** null: the word is no seat's address anywhere. */
function lookup(word: string, rigs: Rig[]): SeatTarget | null {
  const at = word.indexOf('@', 1);
  const address = at < 0 ? word : word.slice(0, at);
  const rigName = at < 0 ? null : word.slice(at + 1);
  const hits = rigs.filter(r => rigName === null || r.name === rigName)
    .flatMap(rig => rig.seats.filter(s => s.address === address).map(seat => ({ rig, seat })));
  if (hits.length === 0) return null;
  const live = hits.filter(h => ACTIVE.has(h.rig.lifecycle) && !DOWN.has(h.seat.state));
  if (live.length === 1) return { ok: true, ...live[0]! };
  if (live.length > 1) {
    const candidates = live.map(h => `${h.seat.address}@${h.rig.name}`).sort();
    return { ok: false, reason: `Plusieurs agents s'appellent ${address} : ${candidates.join(', ')}`, candidates };
  }
  const why = hits.map(h => !ACTIVE.has(h.rig.lifecycle)
    ? `${h.seat.address} : le rig ${h.rig.name} est ${RIG_DOWN[h.rig.lifecycle] ?? h.rig.lifecycle}`
    : `${h.seat.address} est ${SEAT_DOWN[h.seat.state] ?? h.seat.state} (${h.rig.name})`).sort();
  return { ok: false, reason: why.join(' ; ') };
}

/** `@build` (unique among the running rigs) or `@build@factory`. */
export function resolveSeatAddress(word: string, rigs: Rig[]): SeatTarget {
  return lookup(word, rigs) ?? { ok: false, reason: `Aucun agent ne s'appelle ${word}` };
}

/** What seat sending needs of the OpenRig bridge. */
export interface SeatSendBridge { rigs(): Rig[]; cli(): Pick<RigCli, 'send'> }

export function createSeatSend(d: { bridge: SeatSendBridge }): {
  /** `rig send <seatRef> "[Ledge] <text>"`; only this daemon's machine. */
  send(machine: string, seatRef: string, text: string): Promise<SeatSendResult>;
  /** null: the text does not aim at a seat (the text goes to Ledge). */
  fromSay(rid: string, text: string): Promise<SeatSendResult | null>;
} {
  const send = async (machine: string, seatRef: string, text: string, to?: string): Promise<SeatSendResult> => {
    if (machine !== 'local') return { ok: false, reason: `La machine ${machine} n'est pas joignable d'ici` };
    const label = to ?? d.bridge.rigs().flatMap(r => r.seats).find(s => s.ref === seatRef)?.address ?? seatRef;
    const r = await d.bridge.cli().send(seatRef, text);
    return r.ok ? { ok: true, to: label } : { ok: false, reason: `Envoi à ${label} impossible : ${r.detail ?? 'échec'}` };
  };
  return {
    send,
    async fromSay(_rid, text) {
      const head = leadingAddress(text); if (!head) return null;
      const target = lookup(head.word, d.bridge.rigs()); if (!target) return null;
      if (!target.ok) return { ok: false, reason: target.reason, to: head.word };
      if (head.rest === '') return { ok: false, reason: `Que dire à ${head.word} ? Ajoute ton message après l'adresse.` };
      return send('local', target.seat.ref, head.rest, head.word);
    }
  };
}
