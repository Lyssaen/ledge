// Pull and merge requests on the phone (refonte mobile B5, docs/mobile-forge-contract.md): the daemon's own forge state and details, as a
// phone may hold them. Nothing of the PC travels but what the forge itself says.
import { createHash } from 'node:crypto';
import {
  PHONE_FORGE_BYTES, PHONE_FORGE_FOLLOWED_MAX, PHONE_FORGE_LOG_MAX, PHONE_FORGE_PRS_MAX, PHONE_FORGE_TEXT_MAX,
  type ForgeAction, type ForgeStateMessage, type PhoneForgeState, type PrDetail
} from '@ledge/protocol';
import { clip } from './project.js';

/** What a `forge` challenge is bound to: that request and that very action (its body included), so an assertion writes nothing else. */
export const forgeSubject = (prId: string, action: ForgeAction): string => {
  const keys = Object.keys(action).sort();
  return `${prId}|${createHash('sha256').update(JSON.stringify(keys.map(k => [k, (action as Record<string, unknown>)[k]]))).digest('base64url')}`;
};

/** The list without the CLIs' messages (they may hold a path or a host's own words), within the phone's bounds. */
export function phoneForgeState(m: ForgeStateMessage): PhoneForgeState {
  return {
    prs: m.prs.slice(0, PHONE_FORGE_PRS_MAX),
    forges: m.forges.slice(0, 20).map(({ message: _m, ...f }) => f),
    followed: (m.followed ?? []).slice(0, PHONE_FORGE_FOLLOWED_MAX)
  };
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

/**
 * A detail that fits the sealed frame, or null when nothing can make it fit. Long texts are shortened first (a job's log keeps its last
 * lines); then, while it is still too heavy, the patches go, then the discussions and the commits from the oldest, then the files and
 * jobs past the first ones, then the log. `cut` says something was left out or shortened; the result is checked whole at the end.
 */
export function phoneForgeDetail(d: PrDetail): { detail: PrDetail; cut: boolean } | null {
  let cut = false;
  const text = (t: string): string => {
    if (t.length <= PHONE_FORGE_TEXT_MAX) return t;
    cut = true;
    return `${clip(t, PHONE_FORGE_TEXT_MAX - 1).text}…`;
  };
  /** The end of a log is what failed: it keeps its last characters. */
  const tail = (t: string): string => {
    if (t.length <= PHONE_FORGE_LOG_MAX) return t;
    cut = true;
    const from = t.length - PHONE_FORGE_LOG_MAX + 1;
    return `…${t.slice(/[\udc00-\udfff]/.test(t[from] ?? '') ? from + 1 : from)}`;
  };
  const heavy = (v: PrDetail) => bytes(v) > PHONE_FORGE_BYTES;
  let detail: PrDetail = {
    ...d,
    description: text(d.description),
    threads: d.threads.map(t => ({ ...t, comments: t.comments.map(c => ({ ...c, body: text(c.body) })) })),
    ...(d.log ? { log: { ...d.log, text: tail(d.log.text) } } : {})
  };
  if (heavy(detail)) {
    detail = { ...detail, files: detail.files.map(({ patch: _p, ...f }) => f) };
    cut = true;
  }
  const byAt = (a: string, b: string) => b.localeCompare(a);
  if (heavy(detail)) {
    const newest = [...detail.threads].sort((a, b) => byAt(a.comments.at(-1)!.at, b.comments.at(-1)!.at));
    while (newest.length && heavy({ ...detail, threads: newest })) newest.pop();
    detail = { ...detail, threads: detail.threads.filter(t => newest.includes(t)) };
  }
  if (heavy(detail)) {
    const commits = [...detail.commits].sort((a, b) => byAt(a.at, b.at));
    while (commits.length && heavy({ ...detail, commits })) commits.pop();
    detail = { ...detail, commits: detail.commits.filter(c => commits.includes(c)) };
  }
  if (heavy(detail)) detail = { ...detail, files: detail.files.slice(0, 300), jobs: detail.jobs.slice(0, 200) };
  if (heavy(detail)) { const { log: _l, ...rest } = detail; detail = rest; }
  if (heavy(detail)) detail = { ...detail, files: [], jobs: [], reviewers: detail.reviewers.slice(0, 50), labels: detail.labels.slice(0, 50), issues: detail.issues.slice(0, 50) };
  return heavy(detail) ? null : { detail, cut };
}
