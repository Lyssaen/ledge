// Pull and merge requests as the PC sends them to the phone (docs/mobile-forge-contract.md), close to the M5 mockup's examples.
import type { PhoneForgeState, PhoneServerMessage, PrDetail, PullRequest } from '@ledge/protocol';

const AT = '2026-11-11T14:12:00.000Z';

/** A GitHub pull request of the `ledge` repository, open and green, on dev-front's branch. */
export const pr = (extra: Partial<PullRequest> = {}): PullRequest => ({
  id: 'github.com/acme/ledge#231', forge: 'github', host: 'github.com', repo: 'acme/ledge', number: 231, ref: '#231',
  url: 'https://github.com/acme/ledge/pull/231', title: 'Lot 9 : fenêtres détachées', state: 'open',
  branch: 'feat/detached', target: 'main', headSha: 'a3f9c1e0a3f9c1e0a3f9c1e0a3f9c1e0a3f9c1e0', pipeline: 'ok',
  approvals: { given: 1 }, mergeable: true, openThreads: 0, updatedAt: AT, sessions: ['s-front'],
  ...extra
});

/** A GitLab merge request whose pipeline failed. */
export const mr = (extra: Partial<PullRequest> = {}): PullRequest => pr({
  id: 'gitlab.acme.dev/team/synapse#41', forge: 'gitlab', host: 'gitlab.acme.dev', repo: 'team/synapse', number: 41, ref: '!41',
  url: 'https://gitlab.acme.dev/team/synapse/-/merge_requests/41', title: 'Worker : relance sur délai S3', branch: 'fix/s3-timeout',
  headSha: '7d2e04b17d2e04b17d2e04b17d2e04b17d2e04b1', pipeline: 'fail', approvals: { given: 0, required: 1 }, mergeable: false,
  openThreads: 1, sessions: ['s-tom'], ...extra
});

export const forgeState = (extra: Partial<PhoneForgeState> = {}): PhoneForgeState => ({
  prs: [mr(), pr()],
  forges: [{ forge: 'github', host: 'github.com', status: 'ok', at: AT }, { forge: 'gitlab', host: 'gitlab.acme.dev', status: 'ok', at: AT }],
  followed: [{ session: 's-front', forge: 'github', host: 'github.com', repo: 'acme/ledge' }, { session: 's-tom', forge: 'gitlab', host: 'gitlab.acme.dev', repo: 'team/synapse' }],
  ...extra
});

export const stateMsg = (extra: Partial<PhoneForgeState> = {}): PhoneServerMessage => ({ type: 'forge.state', ...forgeState(extra) });

/** The detail of `p`: a two-stage pipeline, one review thread, one file, one commit. */
export const detail = (p: PullRequest = pr(), extra: Partial<PrDetail> = {}): PrDetail => ({
  pr: p, description: 'Les fenêtres détachées du lot 9.', author: 'dev-front',
  reviewers: [{ name: 'review-qa', state: 'approved' }], labels: ['ui'], issues: ['#38'],
  jobs: [
    { id: 'j1', name: 'build', column: 0, columnName: 'build', status: 'ok', durationS: 122 },
    { id: 'j2', name: 'test', column: 1, columnName: 'test', status: p.pipeline === 'fail' ? 'fail' : 'ok', durationS: 301 }
  ],
  threads: [{ id: 't1', resolvable: true, resolved: false, file: 'term/Term.tsx', line: 88, code: '+ const rows = 24;', comments: [{ id: 'c1', author: 'review-qa', at: AT, body: 'Pourquoi 24 ?' }] }],
  files: [{ path: 'term/Term.tsx', added: 48, removed: 12, patch: '@@ -1,3 +1,4 @@\n+const rows = 24;' }],
  commits: [{ sha: p.headSha, title: 'feat: detached windows', author: 'dev-front', at: AT }],
  mergeCommand: `gh pr merge ${p.number} --repo ${p.repo} --squash`, mergeBlockers: [],
  ...extra
});
