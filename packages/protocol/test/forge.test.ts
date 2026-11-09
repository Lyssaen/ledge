import { describe, it, expect } from 'vitest';
import { ForgeActSchema, ForgeDetailSchema, PrDetailSchema, PullRequestSchema, PrJobSchema, parseClientMessage, parseServerMessage, prIdOf, FORGE_BODY_MAX } from '../src/index.js';

const AT = '2026-11-08T10:00:00.000Z';

/** The mockup's `gh-226` (docs/mockups/ledge-ide-interactive.html, PRS), as the daemon sends it. */
const gh226 = {
  id: 'github.com/Lyssaen/ledge#226', forge: 'github', host: 'github.com', repo: 'Lyssaen/ledge', number: 226, ref: '#226',
  url: 'https://github.com/Lyssaen/ledge/pull/226', title: 'Coque IDE : WorkspaceShell',
  state: 'draft', branch: 'feat/ide-shell', target: 'main', headSha: 'a41c9e2aa41c9e2aa41c9e2aa41c9e2aa41c9e2a',
  pipeline: 'run', approvals: { given: 0, required: 1 }, mergeable: false, openThreads: 1, updatedAt: AT, sessions: ['s-pim']
};
/** The mockup's `gl-41`, with its pipeline (build ok, test fail, deploy:staging skip: three columns). */
const gl41 = {
  id: 'gitlab.com/synapse/synapse#41', forge: 'gitlab', host: 'gitlab.com', repo: 'synapse/synapse', number: 41, ref: '!41',
  url: 'https://gitlab.com/synapse/synapse/-/merge_requests/41', title: 'Worker : relance sur délai S3',
  state: 'open', branch: 'fix/s3-timeout', target: 'main', headSha: '91fe2c0091fe2c0091fe2c0091fe2c0091fe2c00',
  pipeline: 'fail', approvals: { given: 1, required: 1 }, mergeable: true, openThreads: 1, updatedAt: AT, sessions: ['s-tom']
};
const gl41Detail = {
  pr: gl41, description: 'Relance les appels S3 sur délai, avec un backoff exponentiel.\n\n- MAX_RETRIES = 3.\n- Closes #38.', author: 'tom',
  reviewers: [{ name: 'Joffrey', state: 'approved' }], labels: ['worker', 'bug'], issues: ['#38'],
  jobs: [
    { id: '8810', name: 'build', column: 0, columnName: 'build', status: 'ok', durationS: 122 },
    { id: '8812', name: 'test', column: 1, columnName: 'test', status: 'fail', durationS: 91 },
    { id: '8813', name: 'deploy:staging', column: 2, columnName: 'deploy', status: 'skip' }
  ],
  log: { jobId: '8812', text: 'FAIL worker/retry.test.ts › relance après 3 délais' },
  threads: [{ id: 'abc123', resolvable: true, resolved: false, file: 'worker/retry.ts', line: 31, code: '+    if (attempt >= MAX_RETRIES) throw err;',
    comments: [{ id: '1', author: 'tom', at: AT, body: 'Le test « relance après 3 délais » attend encore 2 tentatives.' }] }],
  files: [{ path: 'worker/retry.ts', added: 18, removed: 6, patch: '@@ -28,7 +28,9 @@' }, { path: 'worker/retry.test.ts', added: 24, removed: 2 }],
  commits: [{ sha: '91fe2c0', title: 'retry : backoff exponentiel', author: 'Tom', at: AT }],
  mergeCommand: 'glab api --method PUT projects/synapse%2Fsynapse/merge_requests/41/merge', mergeBlockers: ['pipeline']
};

describe('pull and merge requests', () => {
  it('takes the mockup gh-226 and gl-41, detail included', () => {
    expect(PullRequestSchema.safeParse(gh226).success).toBe(true);
    expect(PullRequestSchema.safeParse(gl41).success).toBe(true);
    const d = PrDetailSchema.safeParse(gl41Detail);
    expect(d.success).toBe(true);
    if (d.success) expect(new Set(d.data.jobs.map(j => j.column)).size).toBe(3);
    const m = parseServerMessage({ type: 'forge.state', prs: [gh226, gl41], forges: [{ forge: 'github', host: 'github.com', status: 'ok', at: AT }] });
    expect(m.type === 'forge.state' && m.prs.map(p => p.ref)).toEqual(['#226', '!41']);
  });

  // Lot 8b contract (N2): the forge of each followed session, and when a forge in error failed first, is read again, was last read.
  it('takes the followed sessions and the times of a forge in error; a daemon without them still parses', () => {
    const m = parseServerMessage({ type: 'forge.state', prs: [gh226],
      forges: [{ forge: 'github', host: 'github.com', status: 'error', message: 'HTTP 502', at: AT, since: AT, retryAt: '2026-11-08T10:50:00.000Z', readAt: '2026-11-08T10:42:00.000Z' }],
      followed: [{ session: 's1', forge: 'github', host: 'github.com', repo: 'Lyssaen/ledge' }, { session: 's2', forge: 'gitea', host: 'x', repo: 'y' }] });
    expect(m.type === 'forge.state' && m.forges[0]).toMatchObject({ since: AT, retryAt: '2026-11-08T10:50:00.000Z', readAt: '2026-11-08T10:42:00.000Z' });
    expect(m.type === 'forge.state' && m.followed?.map(f => f.session)).toEqual(['s1']);
    const old = parseServerMessage({ type: 'forge.state', prs: [], forges: [{ forge: 'github', host: 'github.com', status: 'ok', at: AT }] });
    expect(old.type === 'forge.state' && old.followed).toBeUndefined();
    expect(PrDetailSchema.safeParse({ ...gl41Detail, mergeBlockers: ['pipeline_not_started', 'approvals'] }).success).toBe(true);
  });

  it('drops a pull request with an unknown state, pipeline or forge, keeps the others', () => {
    const m = parseServerMessage({ type: 'forge.state', prs: [{ ...gh226, state: 'archived' }, gl41, { ...gl41, pipeline: 'paused' }, { ...gl41, forge: 'gitea' }],
      forges: [{ forge: 'gitea', host: 'x', status: 'ok', at: AT }, { forge: 'gitlab', host: 'gitlab.com', status: 'missing', message: 'glab is not installed', at: AT }] });
    expect(m.type).toBe('forge.state');
    if (m.type !== 'forge.state') return;
    expect(m.prs.map(p => p.id)).toEqual([gl41.id]);
    expect(m.forges.map(f => f.forge)).toEqual(['gitlab']);
  });

  it('reads a job with an unknown status as none', () => {
    expect(PrJobSchema.parse({ id: '1', name: 'x', column: 0, columnName: 's', status: 'waiting_for_resource' }).status).toBe('none');
  });

  it('refuses an action outside the closed list', () => {
    expect(() => parseClientMessage({ type: 'forge.act', requestId: 'r1', prId: gh226.id, action: { kind: 'delete' } })).toThrow();
    expect(parseClientMessage({ type: 'forge.act', requestId: 'r1', prId: gh226.id, action: { kind: 'merge', headSha: gh226.headSha } }).type).toBe('forge.act');
  });

  it('bounds a comment to 64 KiB', () => {
    const ok = 'x'.repeat(FORGE_BODY_MAX);
    expect(ForgeActSchema.safeParse({ type: 'forge.act', requestId: 'r', prId: 'p', action: { kind: 'comment', body: ok } }).success).toBe(true);
    expect(ForgeActSchema.safeParse({ type: 'forge.act', requestId: 'r', prId: 'p', action: { kind: 'comment', body: ok + 'x' } }).success).toBe(false);
    expect(ForgeActSchema.safeParse({ type: 'forge.act', requestId: 'r', prId: 'p', action: { kind: 'reply', threadId: 't', body: ok + 'x' } }).success).toBe(false);
  });

  it('answers a detail and an action with the request id, and a refusal with its code', () => {
    expect(ForgeDetailSchema.safeParse({ type: 'forge.detail', requestId: 'r2', prId: gl41.id, log: '8812' }).success).toBe(true);
    const d = parseServerMessage({ type: 'forge.detail.reply', requestId: 'r2', ok: true, detail: gl41Detail });
    expect(d.type === 'forge.detail.reply' && d.detail?.log?.jobId).toBe('8812');
    const a = parseServerMessage({ type: 'forge.act.reply', requestId: 'r3', ok: false, code: 'not_offered', message: 'the pipeline is not green' });
    expect(a.type === 'forge.act.reply' && a.code).toBe('not_offered');
  });

  it('builds the stable id of a pull request', () => {
    expect(prIdOf('gitlab.com', 'a/b/c', 7)).toBe('gitlab.com/a/b/c#7');
  });

  it('says the daemon serves them', () => {
    const m = parseServerMessage({ type: 'snapshot', sessions: [], daemon: { version: '0.54.0', install: 'npm', systemd: true, forge: true } });
    expect(m.type === 'snapshot' && m.daemon?.forge).toBe(true);
  });
});
