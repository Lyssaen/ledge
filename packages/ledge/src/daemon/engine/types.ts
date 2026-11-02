import type { Exchange, Rig, ServerMessage, TeamsEngine } from '@ledge/protocol';

/** What an engine tells the fronts of its teams: the common team shape's messages. */
export type TeamEngineMessage = Extract<ServerMessage, { type: 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' }>;

/**
 * A teams engine as every client reads it (lot D): its teams in the common shape (`Rig`, `RigSeat`, `Exchange`), whatever
 * runs them. Implemented by the Ledge engine (its live teams projected) and by an adapter over the OpenRig aggregate.
 */
export interface TeamEngine {
  readonly kind: TeamsEngine;
  /** The common shape; a Ledge team carries `engine: 'ledge'`. */
  teams(): Rig[];
  exchanges(teamId: string): Exchange[];
  /** A team of this engine runs. */
  running(): boolean;
  onMessage(fn: (m: TeamEngineMessage) => void): () => void;
  /** What brings a client that just connected up to date with the teams. */
  replay(): ServerMessage[];
}
