/** The pull and merge requests as every front shows them (IDE lot 8, docs/mockups/ledge-ide-interactive.html): Desktop, the TUI. */
import type { ForgeStatus, PullRequest } from '@ledge/protocol';

/** A request across the fleet: its sessions qualified `machine:id`, and the machine that read it (the one to ask for its detail). */
export type FleetPullRequest = PullRequest & { machineId: string };
export type FleetForgeStatus = ForgeStatus & { machineId: string };

const OPEN = new Set<PullRequest['state']>(['draft', 'open', 'review']);
const isOpen = (p: Pick<PullRequest, 'state'>): boolean => OPEN.has(p.state);

/** The requests still open (draft, open, in review), most recently updated first. */
export const openPrs = <T extends PullRequest>(prs: readonly T[]): T[] => prs.filter(isOpen).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
/** The merged ones, most recently updated first. */
export const mergedPrs = <T extends PullRequest>(prs: readonly T[]): T[] => prs.filter(p => p.state === 'merged').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
/** The badge of the activity bar: open requests whose pipeline failed. */
export const prsFailing = (prs: readonly PullRequest[]): number => prs.filter(p => isOpen(p) && p.pipeline === 'fail').length;
/** « À toi »: an open request whose pipeline failed, or green and ready to merge. */
export const prsWaitingForYou = <T extends PullRequest>(prs: readonly T[]): T[] => openPrs(prs).filter(p => p.pipeline === 'fail' || (p.pipeline === 'ok' && p.mergeable));
/** A session's request (its id qualified): the open one first, else the latest. */
export const prOfSession = <T extends PullRequest>(prs: readonly T[], sessionId: string): T | undefined => {
  const mine = prs.filter(p => p.sessions.includes(sessionId));
  return openPrs(mine)[0] ?? [...mine].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
};
