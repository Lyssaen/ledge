import type { PhoneSession } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { copy } from '../copy';
import { dotOf, GROUPINGS, helperDot, islandDot, islands, type Grouping, type Island } from '../model/sessions';
import { href } from '../router';
import { useTheme } from '../theme';
import { Icon } from '../ui/icons';
import { Dot, RuntimeTag } from '../ui/kit/marks';
import { useLongPress } from './longPress';

/** « Projets · Rigs » across the width, then the eye that hides the sub-agents (m2-sessions.html §7). */
function GroupBar({ by, onBy, helpers, onHelpers }: { by: Grouping; onBy: (g: Grouping) => void; helpers: boolean; onHelpers: () => void }) {
  const G = copy.sessions.groupBy;
  return (
    <div className="flex flex-none items-center gap-2">
      <div role="group" aria-label={G.label} className="grid flex-1 grid-cols-2 gap-[3px] rounded-[10px] border border-line p-[3px]">
        {GROUPINGS.map(g => (
          <button key={g} type="button" aria-pressed={g === by} onClick={() => onBy(g)}
            className="h-[34px] rounded-[7px] text-[13px] font-medium whitespace-nowrap text-muted aria-pressed:bg-raised aria-pressed:text-fg">
            {G[g]}
          </button>
        ))}
      </div>
      <button type="button" onClick={onHelpers} aria-label={helpers ? copy.sessions.helpersHide : copy.sessions.helpersShow} title={helpers ? copy.sessions.helpersHide : copy.sessions.helpersShow}
        className={`grid size-[42px] flex-none place-items-center rounded-control border ${helpers ? 'border-input text-fg' : 'border-ring text-fg'}`}>
        <Icon name="eye" className="size-[18px]" />
      </button>
    </div>
  );
}

const SEAT = 'inline-flex items-center gap-1.5 rounded-lg border bg-bg px-2.5 select-none [-webkit-touch-callout:none]';

/** An agent's seat: a tap opens its thread, a long press its actions (§8); its sub-agents follow it, or count on it when hidden. */
function Seat({ session: s, rig, helpers, pressed, onPress }: { session: PhoneSession; rig: boolean; helpers: boolean; pressed: boolean; onPress: (s: PhoneSession) => void }) {
  const long = useLongPress(() => onPress(s));
  const dot = dotOf(s);
  const tone = dot === 'perm' ? 'border-destructive/50' : dot === 'ask' ? 'border-attention/50' : 'border-line';
  const thread = href({ name: 'thread', sessionId: s.id });
  const label = copy.atelier.session(s.name);
  return (
    <>
      <a href={thread} aria-label={label} {...long}
        className={`${SEAT} h-10 text-[13px] font-medium ${tone} ${s.state === 'exited' ? 'opacity-60' : ''} ${pressed ? 'shadow-[0_0_0_2px_var(--color-ring)]' : ''}`}>
        {!rig && <RuntimeTag tool={s.tool} />}
        {s.name}
        <Dot state={dot} />
        {!helpers && s.helpers.length > 0 && <span aria-label={copy.sessions.kidsLabel(s.helpers.length)} className="ml-0.5 rounded-lg border border-input px-1.5 font-mono text-[11px] leading-[18px] text-muted">{copy.sessions.kids(s.helpers.length)}</span>}
      </a>
      {helpers && s.helpers.map(h => (
        // A sub-agent has no thread of its own: its seat opens its agent's (§2, Q21).
        <a key={h.id} href={thread} aria-label={copy.atelier.helperSeat(h.kind, s.name, h.task)} {...long}
          className={`${SEAT} h-8 border-dashed border-line text-[12px] text-muted`}>
          {h.kind}<Dot state={helperDot(h)} />
        </a>
      ))}
    </>
  );
}

function IslandBox({ island, rigs, helpers, pressed, onPress }: { island: Island; rigs: boolean; helpers: boolean; pressed: string | null; onPress: (s: PhoneSession) => void }) {
  const S = copy.sessions;
  const rig = island.kind === 'rig';
  const dot = islandDot(island);
  // « OpenRig » names the kernel's island once the PC sends the rigs (design-ux 6e8d4bba, point 5).
  const tag = rig ? (island.name === 'kernel' && rigs ? S.kernelTag : S.rigTag) : null;
  const count = rig ? S.seats(island.sessions.length) : copy.atelier.plaqueCounts(island.sessions.length);
  return (
    <section aria-label={rig ? S.rigGroup(island.name) : island.name}
      className={`flex flex-none flex-col gap-2.5 rounded-[10px] border bg-surface px-3 pt-2.5 pb-3 dark:bg-[oklch(0.18_0_0)] ${rig ? 'border-task/45' : 'border-line'}`}>
      <div className="flex items-center gap-2 text-[13px]">
        {rig && <Dot state="rig" />}
        <b className="font-semibold">{island.name}</b>
        {dot && <Dot state={dot} />}
        {tag ? <small className="text-[12px] text-muted">{tag}</small> : <small className="text-[12px] text-muted">{count}</small>}
        {rig && tag === S.rigTag && (rigs
          ? <a href={href({ name: 'rigs' })} className="ml-auto text-[12px] text-muted underline underline-offset-2">{count}</a>
          : <span className="ml-auto text-[12px] text-muted">{count}</span>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {island.sessions.map(s => <Seat key={s.id} session={s} rig={rig} helpers={helpers} pressed={pressed === s.id} onPress={onPress} />)}
      </div>
    </section>
  );
}

/**
 * The Atelier on a phone (docs/mockups/ledge-mobile-refonte/m2-sessions.html §7, QUESTIONS.md « M2b · L'Atelier sur téléphone »):
 * the agents in islands, by project or by rig, without the rooms' drawing; Ledge's desk at the bottom.
 */
export function SessionsAtelier({ sessions, by, onBy, helpers, onHelpers, rigs, pressed, onPress }: {
  sessions: readonly PhoneSession[]; by: Grouping; onBy: (g: Grouping) => void; helpers: boolean; onHelpers: () => void;
  /** The PC sends its rigs (`daemon.rigs`): « 5 sièges » leads to them, the kernel says « OpenRig ». */ rigs: boolean;
  pressed: string | null; onPress: (s: PhoneSession) => void;
}) {
  const theme = useTheme();
  const live = sessions.filter(s => s.state !== 'exited').length;
  // « Bureau de Ledge » opens the Ledge tab (§7).
  const desk = (
    <>
      <span className="grid size-[30px] flex-none place-items-center overflow-hidden"><ResidentMascot size={30} theme={theme} frozen /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="font-semibold">{copy.sessions.deskTitle}</b>
        <small className="text-[12px] text-muted">{copy.atelier.desk} · {copy.atelier.watching(live)}</small>
      </span>
    </>
  );
  const row = 'flex min-h-[52px] flex-none items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-1.5 text-[13.5px] dark:bg-[oklch(0.18_0_0)]';
  return (
    <>
      <GroupBar by={by} onBy={onBy} helpers={helpers} onHelpers={onHelpers} />
      {islands(sessions, by).map(i => <IslandBox key={i.id} island={i} rigs={rigs} helpers={helpers} pressed={pressed} onPress={onPress} />)}
      <a href={href({ name: 'chat' })} className={row}>{desk}<Icon name="chevron" className="size-4 text-muted" /></a>
    </>
  );
}
