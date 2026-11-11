import { useSyncExternalStore } from 'react';
import type { PhoneSession, PullRequest } from '@ledge/protocol';
import { copy } from '../../copy';
import { atoiPrs, chipOf, PIPE_DOT } from '../../model/prs';
import { href } from '../../router';
import type { ForgeState, ForgeStore } from '../../state/forge';
import type { MobileState } from '../../state/store';
import { Icon } from '../../ui/icons';
import { Box, Line } from '../../ui/kit/Box';
import { Dot } from '../../ui/kit/marks';
import { clock } from '../Inbox';
import { forgeWords, repoName } from './parts';

/*
 * The requests where the other tabs show them (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html §9, m1-a-toi.html §9): « À toi » ›
 * MR et PR, the failed pipelines then the requests ready to merge, and the chip of a session's foot. A tap opens the request in
 * the MR/PR tab. Both need a PC that sends its requests (`daemon.forge`).
 */

const C = copy.prs;
const noSub = () => () => undefined;
const nothing = () => null;

/** The forge store's state, or null without a store (an app drawn before it, a test): the screens then show no request. */
export function useForgeState(forge: ForgeStore | null | undefined): ForgeState | null {
  return useSyncExternalStore(forge ? forge.subscribe : noSub, forge ? forge.getState : nothing, forge ? forge.getState : nothing);
}

/** A row's line: forge, repository, why it is here (with the branch's agent on a failed pipeline); offline, the time it was read. */
export function atoiSub(pr: PullRequest, why: 'fail' | 'ready', agent: string | null, readAt: string | null): string {
  const what = why === 'fail' ? C.pipeline.fail : pr.pipeline === 'none' ? C.atoi.readyNoCi : C.atoi.ready;
  if (readAt !== null) return [C.host[pr.forge], what, C.asOf(clock(readAt))].join(' · ');
  return [C.host[pr.forge], repoName(pr.repo), what, ...(why === 'fail' && agent ? [agent] : [])].join(' · ');
}

/** « À toi » › MR et PR: not shown while nothing waits there, nor before the PC sends its requests. */
export function AtoiPrs({ forge, mobile }: { forge: ForgeStore | null | undefined; mobile: MobileState }) {
  const f = useForgeState(forge);
  if (!mobile.daemon?.forge || !f?.state) return null;
  const rows = atoiPrs(f.state.prs);
  if (rows.length === 0) return null;
  const offline = !mobile.fresh;
  const agentOf = (pr: PullRequest) => { const id = pr.sessions[0]; return id ? mobile.sessions.get(id)?.name ?? null : null; };
  return (
    <>
      <h2 className="mt-1 flex items-center gap-2 text-[13px] font-semibold">
        <Icon name="pr" className="size-3.5" />{C.atoi.title}<span className="min-w-0 truncate font-normal text-muted">{C.atoi.sub}</span>
      </h2>
      <Box label={C.atoi.title}>
        {rows.map(({ pr, why }) => (
          <Line
            key={pr.id} href={href({ name: 'pr', id: pr.id })} stale={offline}
            lead={<Dot state={PIPE_DOT[pr.pipeline]} />}
            title={<><b className="font-semibold">{pr.ref}</b> {pr.title}</>}
            sub={atoiSub(pr, why, agentOf(pr), offline ? f.at : null)}
          >
            <Icon name="chevron" className="size-4 text-muted" />
          </Line>
        ))}
      </Box>
    </>
  );
}

/**
 * A session's chip in its foot (Q60): its open request with its pipeline's dot, a tap opening it; « MR ? » when its repository's
 * forge cannot be read on the PC; else nothing.
 */
export function PrChip({ forge, mobile, session }: { forge: ForgeStore | null | undefined; mobile: MobileState; session: PhoneSession }) {
  const f = useForgeState(forge);
  if (!mobile.daemon?.forge) return null;
  const chip = chipOf(f?.state ?? null, session.id);
  if (!chip) return null;
  if ('pr' in chip) {
    return (
      <a href={href({ name: 'pr', id: chip.pr.id })} data-pr-chip={chip.pr.id} className="inline-flex h-8 flex-none items-center gap-[5px] font-mono text-[11px]">
        <Dot state={PIPE_DOT[chip.pr.pipeline]} pulse={chip.pr.pipeline === 'run'} />{chip.pr.ref}
      </a>
    );
  }
  const w = forgeWords({ forge: chip.kind });
  const tip = C.chipTip(w.host, mobile.daemon.name, w.kind);
  return (
    <span role="img" aria-label={tip} title={tip} data-pr-chip="unknown" className="flex-none rounded-md border border-dashed border-input px-[5px] font-mono text-[11px] text-muted">
      {C.chipUnknown(w.kind)}
    </span>
  );
}
