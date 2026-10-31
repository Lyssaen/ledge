import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Values fixed by docs/superpowers/specs/2026-10-30-openrig-facts.md (OpenRig 0.6.14 probe); the D-number cites the row.
export const OPENRIG_MIN = '0.6.14';
export const SUPPORTED_LINE = '0.6'; // major.minor accepted
export const DEFAULT_PORT = 7433;
export const INSTALL_COMMAND = 'npm install -g @openrig/cli@0.6.14 && rig setup';

export type Registration = 'external' | 'host-seat';
export const REGISTRATION: Registration = 'external'; // D2 (Slack decoy registration passes), D9 (plan B host-seat kept as fallback only)
export const HUMAN_ID = 'ledge';
export const HUMAN_ADDRESS: string = REGISTRATION === 'external' ? 'ledge@external' : 'human-ledge@host'; // D2 / D9
// D2: the decoy file stays absent, `human add` still succeeds. Fixed absent path under the OS temp dir; never created by Ledge.
export const HUMAN_BINDING = `slack:ledge-decoy:file:${join(tmpdir(), 'ledge-decoy-slack.env')}:primary`;
export const OPERATOR_HUMAN_SESSIONS: readonly string[] = ['operator-human@kernel']; // fallback value, not probed
export const HUMAN_GATE_TIER = 'human-gate'; // D9
// D5, D6, D8: a reply row to the seat (`rig queue create --source ledge@external`), then `approve` of the human row. The daemon
// ships no docs/: this constant is the sheet's « Chemin de réponse » line (a test reads the sheet and compares).
export type AnswerPathKind = 'reply-and-approve' | 'approve-only' | 'resolve';
export const ANSWER_PATH: AnswerPathKind = 'reply-and-approve';

// D10: names observed by the probe. `rig up` emits 'rig.imported' (not 'rig.created'). 'seat.activity_changed' carries only seatNodeId/sessionName/seq/at:
// the state is re-read from activityState.activity in /api/rigs/:rigId/nodes. Ignored: 'view.changed', 'watchdog.*'.
export const EVENTS = { queueCreated: 'queue.created', queueUpdated: 'queue.updated', queueClaimed: 'queue.claimed',
  missionControlAction: 'mission_control.action_executed', rigImported: 'rig.imported', bootstrapCompleted: 'bootstrap.completed',
  nodeLaunched: 'node.launched', nodeStartupReady: 'node.startup_ready', seatActivity: 'seat.activity_changed' } as const;
// D10: 0.6.14 source only, not observed: applied if they arrive, never the sole guarantee of the mirror (periodic `ps` resync).
export const EVENTS_UNOBSERVED = { queueHandedOff: 'queue.handed_off', sessionDetached: 'session.detached', sessionStopped: 'session.stopped',
  rigDeleted: 'rig.deleted', rigStopped: 'rig.stopped', nodeAdded: 'node.added', nodeRemoved: 'node.removed' } as const;
// D11: `rig send` emits no event; poll GET /api/queue/outbox/list?senderSession=<ref> every 5 s, keep `outbox-…` rows only.
export const OUTBOX_EVENT: string | null = null;
export const OPEN_QUEUE_STATES: readonly string[] = ['pending', 'in-progress', 'blocked']; // fallback value
// D4: field names of a /api/queue/list row.
export const QUEUE_ROW = { questions: 'humanQuestions', intent: 'humanIntent', evidence: 'evidenceRef', replyTo: 'replyTo', body: 'body' } as const;

/** Base URL of the local OpenRig daemon; a non-numeric OPENRIG_PORT falls back to the default. */
export function openrigBase(env: NodeJS.ProcessEnv): string {
  const n = Number(env.OPENRIG_PORT);
  return `http://127.0.0.1:${Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT}`;
}
