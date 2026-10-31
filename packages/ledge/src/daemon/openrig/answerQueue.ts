import type { ServerMessage } from '@ledge/protocol';
import type { Reply } from '../server.js';

/** An answer to a remote escalation, waiting for its machine (lot 6). Types only: Task 6 implements the queue. */
export interface QueuedAnswer { rid: string; machine: string; id: string; answers: Record<string, string>; by: 'user' | 'ledge'; at: string; sentAt?: string }

export interface AnswerQueue {
  /** Answers rig.result { rid, ok: true } at once; overlays { state: 'answered', answer: { …, delivery: 'queued' } }. */
  enqueue(a: QueuedAnswer, reply: Reply): void;
  pending(machine?: string): QueuedAnswer[];
  /** When the peer opens and each time its OpenRig turns `running`: resends each answer of the machine once, in order, same `rid`. */
  flush(machine: string): void;
  /** The peer's rig.result for a queued rid: ok or already_answered → removed, overlay removed (the peer's escalation rules); openrig_down → kept; other → removed, notice. */
  settle(machine: string, result: Extract<ServerMessage, { type: 'rig.result' }>): void;
  /** Machine removed: dropped, with a notice. */
  drop(machine: string): void;
}
