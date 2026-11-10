// Pull and merge requests on the phone (refonte mobile B5, docs/mobile-forge-contract.md): the daemon's own forge state and details, as a
// phone may hold them. Nothing of the PC travels but what the forge itself says.
import { createHash } from 'node:crypto';
import {
  PHONE_FORGE_BYTES, PHONE_FORGE_FOLLOWED_MAX, PHONE_FORGE_PRS_MAX, PHONE_FORGE_TEXT_MAX,
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
 * A detail that fits the sealed frame: long descriptions and comments are shortened, then, while it is still too heavy, the patches go,
 * then the discussions and the commits from the oldest. `cut` says something was left out or shortened.
 */
export function phoneForgeDetail(d: PrDetail): { detail: PrDetail; cut: boolean } {
  let cut = false;
  const text = (t: string): string => {
    if (t.length <= PHONE_FORGE_TEXT_MAX) return t;
    cut = true;
    return `${clip(t, PHONE_FORGE_TEXT_MAX - 1).text}…`;
  };
  let detail: PrDetail = {
    ...d,
    description: text(d.description),
    threads: d.threads.map(t => ({ ...t, comments: t.comments.map(c => ({ ...c, body: text(c.body) })) }))
  };
  if (bytes(detail) > PHONE_FORGE_BYTES) {
    detail = { ...detail, files: detail.files.map(({ patch: _p, ...f }) => f) };
    cut = true;
  }
  const byAt = (a: string, b: string) => b.localeCompare(a);
  if (bytes(detail) > PHONE_FORGE_BYTES) {
    const newest = [...detail.threads].sort((a, b) => byAt(a.comments.at(-1)!.at, b.comments.at(-1)!.at));
    while (newest.length && bytes({ ...detail, threads: newest }) > PHONE_FORGE_BYTES) newest.pop();
    detail = { ...detail, threads: detail.threads.filter(t => newest.includes(t)) };
  }
  if (bytes(detail) > PHONE_FORGE_BYTES) {
    const commits = [...detail.commits].sort((a, b) => byAt(a.at, b.at));
    while (commits.length && bytes({ ...detail, commits }) > PHONE_FORGE_BYTES) commits.pop();
    detail = { ...detail, commits: detail.commits.filter(c => commits.includes(c)) };
  }
  if (bytes(detail) > PHONE_FORGE_BYTES) detail = { ...detail, files: detail.files.slice(0, 300) };
  return { detail, cut };
}
