import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
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
  return <UnknownChip tip={C.chipTip(w.host, mobile.daemon.name, w.kind)} label={C.chipUnknown(w.kind)} />;
}

/** How long the sentence of « MR ? » stays (Q91). */
export const CHIP_TOAST_MS = 4000;

/**
 * « MR ? »: a tap says its sentence in a toast at the bottom, above the message field (Q91 = A, the toast of m5-mr-pr.html §5,
 * the sentence alone); it goes after `CHIP_TOAST_MS` or at the next tap anywhere.
 */
function UnknownChip({ tip, label }: { tip: string; label: string }) {
  const chip = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!at) return;
    const t = setTimeout(() => setAt(null), CHIP_TOAST_MS);
    const away = (e: PointerEvent) => { if (!chip.current?.contains(e.target as Node)) setAt(null); };
    document.addEventListener('pointerdown', away, true);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', away, true); };
  }, [at]);
  const show = () => {
    if (at) { setAt(null); return; }
    // Above the field: the foot's own top, or the field's when it sits right above the foot.
    const foot = chip.current?.closest('footer');
    const above = (foot?.previousElementSibling ?? foot)?.getBoundingClientRect();
    const height = globalThis.innerHeight ?? 0;
    setAt({ bottom: above ? Math.max(height - above.top + 8, 8) : 96 });
  };
  return (
    <>
      <button
        ref={chip} type="button" aria-label={tip} title={tip} onClick={show} data-pr-chip="unknown"
        className="flex-none rounded-md border border-dashed border-input px-[5px] font-mono text-[11px] text-muted"
      >
        {label}
      </button>
      {at && (
        <span role="status" data-chip-toast="" style={at} className="fixed inset-x-3.5 z-[7] flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[18px] whitespace-normal text-fg shadow-[0_8px_24px_#0005]">
          {tip}
        </span>
      )}
    </>
  );
}
