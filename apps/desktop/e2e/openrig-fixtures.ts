import type { RigGraph, RigRow, RigSeatPermission, RigSnapshot } from '@ledge/protocol';

/** OpenRig 0.7 answers as the daemon turns them into protocol types (lot 7a), taken from the sanitized survey in
 *  packages/ledge/test/fixtures/openrig-0.7/. They go to `fakeDaemon`'s `rigGraphs`, `rigSnapshots`, `rigPermissions` and `rigQueues`,
 *  keyed by rig name. A test that wants these answers must also give the daemon `openrigRig: true` in `extras.daemon`. */
const survey: RigGraph = {
  pods: [{ id: 'dev', label: 'Project' }],
  seats: [
    { logicalId: 'dev.build', pod: 'dev', role: 'implementer', runtime: 'claude-code', status: 'running', session: 'dev-build@ledge-survey', attention: false },
    { logicalId: 'dev.review', pod: 'dev', role: 'qa', runtime: 'codex', model: 'gpt-6-astra', status: 'running', session: 'dev-review@ledge-survey', attention: false }
  ],
  links: [{ from: 'dev.build', to: 'dev.review', kind: 'delegates_to' }]
};
const snapshots: RigSnapshot[] = [
  { id: '01M6XTDV03ZVK8BG4WYNVFRBPX', kind: 'auto-pre-down', status: 'complete', createdAt: '2026-11-08 14:54:01' },
  { id: '01M6XTDQFZAA76XGBJMYCHJH62', kind: 'auto-periodic', status: 'complete', createdAt: '2026-11-08 14:53:57' },
  { id: '01M6XTAV9KM2HVRS841K1FQ6RV', kind: 'manual', status: 'complete', createdAt: '2026-11-08 14:52:23' }
];
const advisor: RigSeatPermission = {
  logicalId: 'advisor.lead', session: 'advisor-lead@kernel', mode: 'acceptEdits', source: 'kernel_default', posture: 'floor', selection: 'inherit',
  summary: "Next launch: --permission-mode acceptEdits, from the kernel's operational default; OpenRig adds 50 allowances."
};
const row = (id: string, state: string, from: string, to: string, summary: string, createdAt: string, updatedAt: string, extra: Partial<RigRow> = {}): RigRow =>
  ({ id, state, summary, from, to, createdAt, updatedAt, at: '2026-11-08T15:01:00.000Z', ...extra });
const queue: RigRow[] = [
  row('qitem-20261108150012-1a2b3c4d5e6f7a8b', 'pending', 'operator-human@kernel', 'dev-build@ledge-survey', 'Run the build and report', '2026-11-08T15:00:12.101Z', '2026-11-08T15:00:12.101Z',
    { needsInput: { count: 1, reason: 'permission_prompt' } }),
  row('qitem-20261108143000-0f0e0d0c0b0a0908', 'blocked', 'dev-build@ledge-survey', 'operator-agent@kernel', 'Which branch should the build use?', '2026-11-08T14:30:00.000Z', '2026-11-08T14:40:00.000Z',
    { blockedOn: 'qitem-20261108150012-1a2b3c4d5e6f7a8b', claimedAt: '2026-11-08T14:31:00.000Z' }),
  row('qitem-20261108141500-1111222233334444', 'in-progress', 'operator-human@kernel', 'dev-build@ledge-survey', 'Tidy the survey rig', '2026-11-08T14:15:00.000Z', '2026-11-08T14:20:00.000Z',
    { claimedAt: '2026-11-08T14:16:00.000Z' })
];

/** Ready-made answers for `fakeDaemon`: `{ rigGraphs, rigSnapshots, rigPermissions, rigQueues }` spread into its extras. */
export const RIG_7A = {
  rigGraphs: { 'ledge-survey': survey },
  rigSnapshots: { 'ledge-survey': snapshots },
  rigPermissions: { kernel: { policy: 'builtin:auto', seats: [advisor] } },
  rigQueues: { 'ledge-survey': queue }
};
