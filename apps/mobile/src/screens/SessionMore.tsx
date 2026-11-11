import { useId, useState, type ReactNode } from 'react';
import type { PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { effortLabel } from '../model/modelChoice';
import { indicators } from '../model/usage';
import type { Op } from '../state/operations';
import { isLive } from '../state/operations';
import { useMobile, type MobileStore } from '../state/store';
import { Sheet } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/icons';
import { RuntimeTag } from '../ui/kit/marks';
import { useNow } from '../useNow';
import { Checklist } from './Checklist';
import { isApple } from './device';
import { GroupWrite } from './GroupWrite';
import { available as modelSwitchable } from './SessionModel';

/** How long a transmitted interruption keeps its confirmation while the agent still reports working (as the terminal's). */
const SETTLE = 10_000;
type Interrupt = Op & { message: Extract<Op['message'], { type: 'session.interrupt' }> };

/** Why « Modèle et effort » is off for this session (Q71), or null when the phone can change it. */
export function modelOff(daemon: { models?: true } | null, s: PhoneSession): string | null {
  const M = copy.sessions.modelOff;
  if (modelSwitchable(daemon, s)) return null;
  if (s.state === 'exited') return M.ended;
  if (!daemon?.models) return M.olderPc;
  return M.outside;
}

/** The live sessions of this one's group in the list (its rig for a seat, else its project): who « Écrire au groupe » writes to. */
export function groupOf(s: PhoneSession, sessions: Iterable<PhoneSession>): { name: string; ids: string[] } {
  const same = (o: PhoneSession) => (s.rig ? o.rig?.name === s.rig.name : !o.rig && o.project === s.project);
  const ids = [...sessions].filter(o => same(o) && o.state !== 'exited').map(o => o.id);
  return { name: s.rig ? copy.sessions.rigGroup(s.rig.name) : s.project, ids };
}

/** One line of the sheet: its icon, its words and, under them, why it is off; what it shows on the right. */
function Item({ icon, label, why, right, onClick, danger = false }: {
  icon: IconName; label: string; why?: string | null | undefined; right?: ReactNode; onClick?: (() => void) | undefined; danger?: boolean;
}) {
  const off = !onClick;
  return (
    <button
      type="button" disabled={off} onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-3 border-b border-line px-3.5 py-2 text-left text-[15px] last:border-b-0 disabled:opacity-60 ${danger ? 'text-danger-fg' : 'text-fg'}`}
    >
      <Icon name={icon} className={`size-5 ${danger ? 'text-danger-fg' : 'text-muted'}`} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        {why && <small className="text-small text-muted">{why}</small>}
      </span>
      {right !== undefined && right !== null && <span className="ml-auto flex-none text-[12.5px] text-muted">{right}</span>}
    </button>
  );
}

const Menu = ({ children }: { children: ReactNode }) => <div className="flex flex-col overflow-hidden rounded-[10px] border border-line">{children}</div>;

/**
 * « Plus d'actions » (docs/mockups/ledge-mobile-refonte/m2-sessions.html §5; m2-vides.html §2, Q71): what the phone can do on a
 * session, in one sheet. Modèle et effort, Plan de travail, Interrompre, Écrire au groupe, then Fermer in red. A line that is
 * off keeps its place and says why. « Redémarrer le siège » is not in M2.
 */
export function SessionMore({ store, session, closable, closing, onClose, onModel, onCloseSession, display, lead, who }: {
  store: MobileStore; session: PhoneSession;
  /** The PC can close this session from a phone (`daemon.sessionClose`, launched by Ledge). */ closable: boolean;
  /** A close is under way: « Fermer » says so and does nothing. */ closing: boolean;
  onClose: () => void; onModel: () => void; onCloseSession: () => void;
  /** The terminal view is open: « Affichage » and its value (Lisible, Ajusté), a tap switching it (QUESTIONS.md, « M2b · Le terminal » 5). */
  display?: { value: string; onToggle: () => void } | undefined;
  /** A long press in Sessions (§8): « Ouvrir le fil », « Ouvrir le terminal » before the rest. */
  lead?: readonly { icon: IconName; label: string; onClick: () => void }[] | undefined;
  /** What the head says after the name, in place of the project and the branch (« siège dev.front · ledge-dev », §8). */
  who?: string | undefined;
}) {
  const state = useMobile(store);
  const now = useNow();
  const titleId = useId();
  const [pane, setPane] = useState<'menu' | 'plan' | 'group'>('menu');
  const [refused, setRefused] = useState(false);
  const S = copy.sessions;
  const name = session.name;
  const fresh = state.fresh;

  const i = indicators(session, now, 1);
  const model = [i.model, session.effort ? effortLabel(session.effort) : null].filter(Boolean).join(' · ');
  const off = modelOff(state.daemon, session);

  const checklist = state.daemon?.checklist ? state.checklists.get(session.id) : undefined;

  // Interrompre, as the terminal does it: only while the agent works, nothing waits on the person, and none is on its way.
  const waiting = !!session.pending || session.state === 'waiting_permission' || session.state === 'waiting_input';
  const working = session.state === 'working';
  const last = Object.values(state.ops)
    .filter((o): o is Interrupt => o.message.type === 'session.interrupt' && o.message.id === session.id)
    .sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const inFlight = last !== undefined && isLive(last.phase);
  const justSent = last?.phase === 'applied' && (!working || now - Date.parse(last.at) < SETTLE);
  const canInterrupt = working && fresh && !waiting && !inFlight && !justSent;
  const T = copy.terminal;
  const interruptWhy = inFlight || justSent ? null : !fresh ? T.why.offline : waiting ? T.why.waiting : !working ? T.why.idle : null;
  const interruptLabel = last?.phase === 'sending' ? T.sending : justSent ? T.sent : T.interrupt(name);
  const interruptProblem = last?.phase === 'rejected' && last.reason === 'read_only' ? T.readOnly
    : refused || last?.phase === 'rejected' || last?.phase === 'failed' ? T.fail : null;

  const group = groupOf(session, state.sessions.values());
  const canGroup = !!state.daemon?.broadcast && group.ids.length > 1;

  const where = who ?? [session.project, session.branch].filter(Boolean).join(' · ');
  return (
    <Sheet labelledBy={titleId} onClose={onClose}>
      <h2 id={titleId} aria-label={S.sheet.label(name)} className="flex min-w-0 items-center gap-2">
        <RuntimeTag tool={session.tool} />
        <b className="font-semibold whitespace-nowrap">{name}</b>
        {where && <span className="min-w-0 truncate text-small font-normal text-muted">{where}</span>}
      </h2>
      {pane === 'plan' && checklist ? (
        <>
          <Checklist checklist={checklist} {...(session.checklist?.current ? { current: session.checklist.current } : {})} />
          <button type="button" onClick={() => setPane('menu')} className="h-11 rounded-lg border border-input text-body">{copy.nav.back}</button>
        </>
      ) : pane === 'group' ? (
        <GroupWrite store={store} label={group.name} ids={group.ids} offline={!fresh} startOpen onCancel={() => setPane('menu')} />
      ) : (
        <>
          {lead && lead.length > 0 && <Menu>{lead.map(l => <Item key={l.label} icon={l.icon} label={l.label} onClick={l.onClick} />)}</Menu>}
          <Menu>
            <Item icon="cpu" label={copy.model.title} why={off} right={model || null} onClick={off || !fresh ? undefined : onModel} />
            {display && <Item icon="terminal" label={copy.terminal.live2.view} right={display.value} onClick={display.onToggle} />}
            {checklist && <Item icon="list" label={copy.checklist.title} right={S.sheet.planCount(checklist.done, checklist.total)} onClick={() => setPane('plan')} />}
            <Item icon="stop" label={interruptLabel} why={interruptProblem ?? interruptWhy} onClick={canInterrupt ? () => setRefused(!store.interrupt(session.id)) : undefined} />
            {canGroup && <Item icon="send" label={S.sheet.writeGroup(group.name)} onClick={fresh ? () => setPane('group') : undefined} />}
          </Menu>
          {/* Offline too: its sheet then offers to reconnect, as « Fermer » always did. */}
          {closable && session.state !== 'exited' && (
            <Menu>
              <Item
                icon="power" danger label={closing ? copy.sessionEnd.closingNamed(name) : copy.sessionEnd.close(name)}
                right={isApple() && !closing ? <span aria-hidden="true">{S.sheet.faceId}</span> : null} onClick={closing ? undefined : onCloseSession}
              />
            </Menu>
          )}
          <p className="text-meta text-muted">{S.sheet.interruptNote}</p>
        </>
      )}
    </Sheet>
  );
}
