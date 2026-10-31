import type { Session } from '@ledge/protocol';
import { Refusal } from '../../adapters/types.js';

/** The seat's life belongs to OpenRig: Ledge never kills, archives, deletes or restarts it by itself. */
export const RIG_MANAGED = 'this session is a seat of an OpenRig rig: stop or restart it through its rig';

/** The refusal for a session paired to a rig seat, null for a lone one. */
export function rigManaged(s: Pick<Session, 'rig'>): Refusal | null {
  return s.rig ? new Refusal(RIG_MANAGED, 'rig_managed') : null;
}

/** Thrown by the last net (`endSession`, `closeSession`) when a path forgot to ask `rigManaged` first. */
export class RigManagedError extends Refusal {
  declare readonly code: 'rig_managed';
  constructor() { super(RIG_MANAGED, 'rig_managed'); this.name = 'RigManagedError'; }
}
