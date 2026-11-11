import type { Goal, PhoneOpenRigState, PhoneServerMessage, RigGraph, RigSeat } from '@ledge/protocol';

// OpenRig on the PC as the Rigs tab gets it (docs/mobile-openrig-contract.md): a daemon, a kernel, two rigs (ledge-dev running with
// five seats, synapse-review stopped), the topology of each, a queue, routing and goals to Max.

export const seat = (logicalId: string, extra: Partial<RigSeat> = {}, rig = 'ledge-dev'): RigSeat => ({
  logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running',
  activity: 'idle', stopped: false, work: 0, ...extra
});

type Rig = PhoneOpenRigState['rigs'][number];

export const ledgeDev = (extra: Partial<Rig> = {}): Rig => ({
  id: 'r1', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 5, running: 5, attention: 0, uptime: '09:14', snapshot: '10:42',
  nodes: [
    seat('pilot.lead'), seat('design.ux'), seat('dev.front', { activity: 'running', work: 1 }), seat('dev.back'),
    seat('review.qa', { runtime: 'codex' })
  ],
  ...extra
});

export const synapse = (): Rig => ({
  id: 'r2', name: 'synapse-review', status: 'stopped', lifecycleState: 'stopped', seats: 3, running: 0, attention: 0, uptime: null, snapshot: '08:00',
  nodes: [seat('lead.main', { stopped: true }, 'synapse-review'), seat('rev.one', { stopped: true }, 'synapse-review'), seat('rev.two', { stopped: true }, 'synapse-review')]
});

export const kernel = (): Rig => ({
  id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 3, running: 3, attention: 0, uptime: '09:12', snapshot: null,
  nodes: [seat('operator.agent', {}, 'kernel'), seat('advisor.lead', {}, 'kernel'), seat('queue.worker', { activity: 'running' }, 'kernel')]
});

export const openrig = (extra: Partial<PhoneOpenRigState> = {}): PhoneOpenRigState => ({
  installed: true, version: '0.7.10', daemon: { state: 'running', startedAt: '2026-11-11T09:12:00.000Z' }, kernel: { state: 'ready' },
  rigs: [kernel(), ledgeDev(), synapse()], at: '2026-11-11T10:00:00.000Z', ...extra
});

export const ledgeGraph = (): RigGraph => ({
  pods: [{ id: 'pilot', label: 'pilot' }, { id: 'design', label: 'design' }, { id: 'dev', label: 'dev' }, { id: 'review', label: 'review' }],
  seats: [
    { logicalId: 'pilot.lead', pod: 'pilot', runtime: 'claude-code', status: 'running', session: 'pilot-lead@ledge-dev', attention: false, context: 40 },
    { logicalId: 'design.ux', pod: 'design', runtime: 'claude-code', status: 'running', session: 'design-ux@ledge-dev', attention: false, context: 20 },
    { logicalId: 'dev.front', pod: 'dev', runtime: 'claude-code', status: 'running', session: 'dev-front@ledge-dev', attention: false, context: 81 },
    { logicalId: 'dev.back', pod: 'dev', runtime: 'claude-code', status: 'running', session: 'dev-back@ledge-dev', attention: false, context: 12 },
    { logicalId: 'review.qa', pod: 'review', runtime: 'codex', status: 'running', session: 'review-qa@ledge-dev', attention: false, context: 30 }
  ],
  links: [
    { from: 'pilot.lead', to: 'design.ux', kind: 'delegates_to' }, { from: 'pilot.lead', to: 'dev.front', kind: 'delegates_to' },
    { from: 'pilot.lead', to: 'dev.back', kind: 'delegates_to' }, { from: 'dev.front', to: 'review.qa', kind: 'delegates_to' },
    { from: 'dev.front', to: 'dev.back', kind: 'collaborates_with' }
  ]
});

export const kernelGraph = (): RigGraph => ({
  pods: [{ id: 'operator', label: 'operator' }, { id: 'advisor', label: 'advisor' }, { id: 'queue', label: 'queue' }],
  seats: [
    { logicalId: 'operator.agent', pod: 'operator', runtime: 'claude-code', status: 'running', session: 'operator-agent@kernel', attention: false, context: 9 },
    { logicalId: 'advisor.lead', pod: 'advisor', runtime: 'claude-code', status: 'running', session: 'advisor@kernel', attention: false, context: 6 },
    { logicalId: 'queue.worker', pod: 'queue', runtime: 'claude-code', status: 'running', session: 'queue-worker@kernel', attention: false, context: 3 }
  ],
  links: []
});

export const routing = (): Extract<PhoneServerMessage, { type: 'rigs.routing' }> => ({
  type: 'rigs.routing',
  // Oldest first, as OpenRig lists them.
  entries: [
    { qitem: 'qitem-1', at: '2026-11-10 20:22:00', seat: 'design-ux@ledge-dev', change: 'completed', rig: 'ledge-dev', summary: 'Maquettes M3' },
    { qitem: 'qitem-2', at: '2026-11-10 20:24:00', seat: 'dev-back@ledge-dev', change: 'claimed', rig: 'ledge-dev', summary: 'Coquille rig.snapshot' },
    { qitem: 'qitem-3', at: '2026-11-10 20:26:00', seat: 'pilot-lead@ledge-dev', change: 'handed off to design-ux@ledge-dev', rig: 'ledge-dev', summary: 'Maquettes M4' }
  ]
});

export const goal = (extra: Partial<Goal> = {}): Goal => ({
  goalId: 'goal-0001-abcd', qitemId: 'qitem-g1', text: 'Refonte mobile et tablette de Ledge.', folder: null, sentAt: '2026-11-11T13:41:00.000Z', to: 'operator-agent@kernel',
  state: 'proposed',
  proposal: { askId: 'ask-1', team: null, text: 'ledge-dev tourne déjà : je propose de lui confier la refonte.', answer: null, answeredAt: null },
  question: null,
  trail: [{ at: '2026-11-11T13:41:00.000Z', kind: 'sent', seat: 'you', qitemId: 'qitem-g1' }, { at: '2026-11-11T13:45:00.000Z', kind: 'taken', seat: 'operator-agent@kernel', qitemId: 'qitem-g1' }],
  current: null,
  ...extra
});
