import type { ServerMessage } from '@ledge/protocol';
import type { RigAggregate } from '../openrig/aggregate.js';
import { engineRunning } from './setting.js';
import type { TeamEngine, TeamEngineMessage } from './types.js';

const isTeamMessage = (m: ServerMessage): m is TeamEngineMessage =>
  m.type === 'rig.snapshot' || m.type === 'rig.updated' || m.type === 'rig.removed' || m.type === 'rig.exchange';

/** The OpenRig aggregate as a `TeamEngine`: its rigs as they are, every machine's; only its rig messages (statuses and escalations are its own). */
export function createOpenRigEngine(aggregate: RigAggregate): TeamEngine {
  return {
    kind: 'openrig',
    teams: () => aggregate.rigs(),
    // A rig id names one rig of one machine: the machine it sits on answers, the local one when it is not known.
    exchanges: id => aggregate.exchanges(aggregate.rigs().find(r => r.id === id)?.machine ?? 'local', id) ?? [],
    running: () => engineRunning('openrig', { teams: [], rigs: aggregate.rigs() }),
    onMessage: fn => aggregate.onMessage(m => { if (isTeamMessage(m)) fn(m); }),
    replay: () => aggregate.replay().filter(isTeamMessage)
  };
}
