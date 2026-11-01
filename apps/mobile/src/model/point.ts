import type { PhoneEscalation, PhoneLedgeDecision, PhoneRig, PhoneSession } from '@ledge/protocol';
import { rigProgress } from './rigs';

export function point(state: { escalations: Iterable<PhoneEscalation>; sessions: Iterable<PhoneSession>; rigs: Iterable<PhoneRig>; decisionsToday: readonly PhoneLedgeDecision[] }) {
  const toYou = Array.from(state.escalations).filter(e => e.state === 'pending').length + Array.from(state.sessions).filter(s => !s.rig && !s.brain && !!s.pending).length;
  return { toYou, rigs: Array.from(state.rigs, r => ({ key: r.key, name: r.name, ...rigProgress(r) })), ruled: state.decisionsToday.filter(d => d.by === 'ledge').length };
}
