import type { ServerMessage } from '@ledge/protocol';
import type { RigAggregate } from '../openrig/aggregate.js';
import { engineRunning } from './setting.js';
import type { TeamEngine, TeamEngineMessage } from './types.js';

const isTeamMessage = (m: ServerMessage): m is TeamEngineMessage =>
  m.type === 'rig.snapshot' || m.type === 'rig.updated' || m.type === 'rig.removed' || m.type === 'rig.exchange';

/**
 * The OpenRig aggregate as a `TeamEngine`, the OpenRig side of the daemon's one read path (`activeEngine` in server.ts): its rigs
 * as they are, every machine's. `onMessage` passes only its rig messages; `replay` is the aggregate's whole replay (statuses, rigs,
 * escalations), so a client brought up to date through it misses nothing.
 */
export function createOpenRigEngine(aggregate: RigAggregate): TeamEngine {
  return {
    kind: 'openrig',
    teams: () => aggregate.rigs(),
    // A rig id names one rig of one machine: the machine given, else the one it sits on, else the local one.
    exchanges: (id, machine) => aggregate.exchanges(machine ?? aggregate.rigs().find(r => r.id === id)?.machine ?? 'local', id) ?? [],
    running: () => engineRunning('openrig', { teams: [], rigs: aggregate.rigs() }),
    onMessage: fn => aggregate.onMessage(m => { if (isTeamMessage(m)) fn(m); }),
    replay: (): ServerMessage[] => aggregate.replay()
  };
}
