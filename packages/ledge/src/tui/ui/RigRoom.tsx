import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Box, Text } from 'ink';
import { useColorPreview, useContextNear } from '@ledge/fleet';
import type { Exchange, Rig, Session } from '@ledge/protocol';
import { hhmm, seatName } from '@ledge/ui/chat/ledge/threadModel';
import { kernelSplit, rigColor, rigKey, rigPlace, shortCwd, workingCount } from '@ledge/ui/rigs/model';
import { HUMAN_ADDRESS, openrigBase } from '../../daemon/openrig/facts.js';
import { useRigExchanges } from '../brain.js';
import { LEDGE_FOCUS, useTui, type KeyHandler } from '../context.js';
import type { Line } from '../model/cells.js';
import { queueOf, seatAddress, seatRows, type QueueItem, type SeatRow } from '../model/rigRoom.js';
import { C, projectColor } from '../theme.js';
import { BAR, barCells } from './LedgeRail.js';
import { Lines } from './Lines.js';
import { Tail } from './Tail.js';
import { TitledBox } from './TitledBox.js';

type Keys = Array<readonly [string, string]>;
export type RoomTarget = { kind: 'rig'; machine: string; rigId: string } | { kind: 'kernel'; machine: string };

/** `s` in `w` cells, cut with a space left before the next column. */
const col = (s: string, w: number) => (s.length >= w ? `${s.slice(0, Math.max(0, w - 2))}… ` : s.padEnd(w));
const QUEUE_W = 44;

/**
 * A rig's room (the mockup's « La pièce d'un rig »): its plate (place, seats at work, branch, spec, since when, machine), its seat
 * table, its exchanges (`rig send`) beside OpenRig's queue (under it below 140 columns), and the chosen seat's terminal in colour.
 * The kernel's room (`target.kind === 'kernel'`) is the same, its plate saying OpenRig's daemon, advisor and the human's terminal
 * tucked away, Ledge's orders to the operator and the queue of every rig. Its keys go through `keys`, its key bar through `onBar`:
 * j k the seats (past the ends, the home's left column), ↵ the seat's session, a attaches it, w writes to it through Ledge.
 */
export function RigRoom({ target, side, height, keys, onBar }: { target: RoomTarget; side: boolean; height: number; keys: MutableRefObject<KeyHandler | null>; onBar(b: Keys): void }) {
  const tui = useTui();
  const { t, g, d, rigs, escalations, openrig, machines, projects, client } = tui;
  const kernel = target.kind === 'kernel';
  const rig = kernel ? rigs.find(r => r.kernel && r.machine === target.machine) : rigs.find(r => r.machine === target.machine && r.id === target.rigId);
  const status = openrig.find(s => s.machine === target.machine);
  const near = useContextNear(client);
  // The kernel's seats shown (advisor and the human's terminal tucked away); a rig's all of them, in the graph's order.
  const split = useMemo(() => (rig && kernel ? kernelSplit({ ...rig, seats: rig.seats.filter(s => s.state !== 'stopped') }) : null), [rig, kernel]);
  const rows = useMemo(() => (rig ? seatRows(split ? { ...rig, seats: split.shown } : rig, d.byId, escalations, t.seat) : []), [rig, split, d.byId, escalations, t]);
  const [chosen, setChosen] = useState(0);
  const key = kernel ? `kernel|${target.machine}` : `rig|${target.machine}|${target.rigId}`;
  useEffect(() => setChosen(0), [key]);
  const on = Math.min(chosen, Math.max(0, rows.length - 1));
  const row = rows[on];
  // The exchanges: this rig's; for the kernel, its own and every rig's (its queue is all of them).
  const named = useMemo(() => (kernel ? rigs : rig ? [rig] : []).map(r => ({ machine: r.machine, rigId: r.id })), [kernel, rigs, rig]);
  const exchanges = useRigExchanges(client, named);
  const own = rig ? exchanges.get(rigKey(rig)) : undefined;
  const queue = useMemo<QueueItem[]>(() => (kernel
    ? rigs.flatMap(r => queueOf(r, exchanges.get(rigKey(r)) ?? [], escalations, { long: true })).sort((a, b) => b.at.localeCompare(a.at))
    : rig ? queueOf(rig, own ?? [], escalations) : []), [kernel, rigs, rig, exchanges, own, escalations]);
  const live = !!rig && rig.lifecycle !== 'unreachable' && status?.state !== 'unreachable';
  const machineLabel = (id: string) => machines.find(m => m.id === id)?.label ?? id;
  const where = kernel ? t.room.kernelWhere : rig?.name ?? '';

  const openSeat = (r: SeatRow) => {
    if (!r.session || !rig) return;
    const listed = tui.left.some(x => x.kind === 'seat' && x.rig.machine === rig.machine && x.rig.id === rig.id && x.seat.ref === r.seat.ref && x.session);
    tui.setFocus(listed ? { kind: 'seat', machine: rig.machine, rigId: rig.id, ref: r.seat.ref } : { kind: 'session', id: r.session.id });
    tui.go('session');
  };
  const attachSeat = (r: SeatRow) => {
    if (!rig) return;
    const argv = tui.fleet.seatTerminal(rig.machine, r.seat.ref);
    if (!argv) { tui.toast({ text: t.room.noTerminalCommand(r.seat.name), tone: 'info' }); return; }
    tui.runInTerminal(argv);
  };
  const writeTo = (r: SeatRow) => {
    if (!rig) return;
    const address = seatAddress(rig, r.seat, rigs);
    const kept = tui.kept.drafts.get('ledge');
    tui.kept.drafts.set('ledge', kept ? `${address} ${kept.replace(/^@\S+\s*/, '')}` : `${address} `);
    tui.setFocus({ kind: 'ledge' });
    tui.setLedgeFocus(LEDGE_FOCUS.field);
  };

  keys.current = (input, k) => {
    if (input === 'j' || k.downArrow) { if (on < rows.length - 1) { setChosen(on + 1); return true; } return false; }
    if (input === 'k' || k.upArrow) { if (on > 0) { setChosen(on - 1); return true; } return false; }
    if (!row) return false;
    if (k.return) { if (live) openSeat(row); return true; }
    if (input === 'a') { if (live) attachSeat(row); return true; }
    if (input === 'w' && !kernel) { if (live) writeTo(row); return true; }
    return false;
  };
  useEffect(() => () => { keys.current = null; }, [keys]);
  const bar: Keys = [['j k', t.keys.seats], ...(live && row ? [...(row.session ? [['↵', t.keys.openSeat] as const] : []), ['a', t.keys.attachSeat] as const, ...(kernel ? [] : [['w', t.keys.write] as const])] : []), ['1', t.keys.ledge]];
  const barKey = bar.map(b => b.join(' ')).join('|');
  useEffect(() => onBar(bar), [barKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The plate: a rig's place, seats at work, branch, spec, since when, machine; the kernel's OpenRig daemon.
  const plate = (() => {
    if (kernel) {
      const state = status?.state ?? (rig ? 'running' : 'absent');
      const endpoint = target.machine === 'local' ? openrigBase(tui.env).replace(/^https?:\/\//, '') : null;
      return (
        <Text wrap="truncate">
          <Text color={state === 'running' ? C.green : state === 'error' ? C.red : C.dim}>{state === 'running' ? g.working : g.idle} </Text>
          <Text color={C.fg}>{t.room.daemon[state]}</Text>
          <Text color={C.dim}>{[endpoint, status?.version ? t.room.version(status.version) : null, rig ? shortCwd(rig.cwd) : null].filter(Boolean).map(x => ` · ${x}`).join('')}</Text>
          {status?.human ? <><Text color={C.dim}> · </Text><Text color={status.human === 'registered' ? C.coral : C.yellow}>{status.human === 'registered' ? t.room.human(HUMAN_ADDRESS) : t.room.noHuman}</Text></> : null}
        </Text>
      );
    }
    if (!rig) return null;
    const seats = rig.seats.filter(s => s.state !== 'stopped');
    const working = workingCount(rig), n = barCells(working, seats.length);
    const tail = [rig.spec ? `spec ${rig.spec}` : null, t.room.seats(seats.length), rig.launch ? t.room.since(hhmm(rig.launch.startedAt)) : null, machineLabel(rig.machine),
      rig.launch?.lead ? t.room.lead(seatName(rig.launch.lead)) : null].filter(Boolean);
    return (
      <Text wrap="truncate">
        {live ? <><Text color={C.blue}>{g.working} </Text><Text color={C.fg}>{t.home.working(working, seats.length)} </Text>
          <Text color={C.red}>{g.full.repeat(n)}</Text><Text color={C.line}>{g.empty.repeat(BAR - n)}</Text></>
          : <><Text color={C.dim}>{g.idle} </Text><Text color={C.dim}>{t.room.unreachable}</Text></>}
        {rig.branch ? <Text color={C.dim}>  {g.branch} {rig.branch}</Text> : null}
        <Text color={C.faint}>{tail.map(x => ` · ${x}`).join('')}</Text>
      </Text>
    );
  })();
  const placeOf = (r: Rig) => {
    const p = rigPlace(r, projects);
    return [t.room.rig, p.kind === 'project' ? t.home.inProject(p.name) : p.kind === 'off' ? t.home.offProject : '', r.machine !== 'local' ? t.home.onMachine(machineLabel(r.machine)) : ''].filter(Boolean).join(' · ');
  };
  const title = kernel ? `${g.kernel} ${t.room.kernel}` : `${g.rig} ${rig?.name ?? ''} · ${rig ? placeOf(rig) : ''}`;
  const ctxColor = (ctx: number | undefined) => (ctx !== undefined && ctx >= near * 100 ? C.yellow : C.dim);
  const h = t.room.head;
  const table = kernel
    ? <Text color={C.faint} wrap="truncate">  {col(h.seat, 12)}{col(h.name, 12)}{col(h.state, 15)}{col(h.agent, 23)}{h.role}</Text>
    : <Text color={C.faint} wrap="truncate">  {col(h.seat, 11)}{col(h.name, 12)}{col(h.state, 15)}{col(h.agent, 25)}{col(h.context, 10)}{h.on}</Text>;
  const hidden = split?.hidden ?? [];
  const plateH = 5 + Math.max(1, rows.length) + (hidden.length ? 1 : 0);
  const rest = Math.max(0, height - plateH);
  const midH = side ? Math.max(6, Math.min(15, Math.floor(rest / 2))) : Math.max(4, Math.floor(rest / 3));

  const exchangeBox = (
    <TitledBox title={kernel ? t.room.orders : t.room.exchanges(where)} {...(kernel ? {} : { mark: { text: `· ${t.room.rigSend}`, color: C.faint } })}
      flexGrow={1} {...(side ? {} : { height: midH })}>
      {own === undefined || own === null ? <Text color={C.faint}>{rig ? t.room.loading : t.overview.noExchange}</Text>
        : own.length === 0 ? <Text color={C.faint}>{t.overview.noExchange}</Text>
        : <Lines lines={own.slice(-200).map(x => exchangeLine(x, g, t.room.you))} />}
    </TitledBox>
  );
  const queueBox = (
    <TitledBox title={t.room.queue(kernel ? t.room.all : where)} mark={{ text: `· ${queue.length}`, color: C.faint }} {...(side ? { width: QUEUE_W } : { height: midH })} flexShrink={0}>
      {queue.length === 0 ? <Text color={C.faint}>{t.room.emptyQueue}</Text> : queue.flatMap(q => {
        const [glyph, gc] = q.glyph === 'approval' ? [g.approval, C.yellow] : q.glyph === 'ok' ? [g.ok, C.green] : [g.task, C.green];
        const sc = q.state === 'à toi' ? C.red : q.state === 'fait' ? C.green : C.blue;
        return kernel
          ? [<Text key={q.id} wrap="truncate"><Text color={C.faint}>{q.id} </Text><Text color={gc}>{glyph} </Text><Text color={C.fg}>{col(q.to, 19)}</Text><Text color={sc}>{t.room.queueState[q.state]}</Text></Text>]
          : [<Text key={q.id} wrap="truncate"><Text color={C.faint}>{q.id} </Text><Text color={gc}>{glyph} </Text><Text color={C.fg} bold>{q.to}</Text><Text color={sc}> {t.room.queueState[q.state]}</Text></Text>,
            <Text key={`${q.id}-t`} color={C.dim} wrap="truncate">{'        '}{q.title}</Text>];
      })}
    </TitledBox>
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <TitledBox title={title} color={kernel || !rig ? C.dim : projectColor(rigColor(rig))} titleColor={C.fg} titleBold
        mark={{ text: `· ${kernel ? t.room.kernelMark : t.room.mark}`, color: C.faint }} flexShrink={0}>
        {plate ?? <Text> </Text>}
        <Text> </Text>
        {table}
        {rows.length === 0 ? <Text color={C.faint}>  {t.home.noSeat}</Text> : rows.map((r, i) => {
          const sel = i === on;
          return (
            <Box key={r.seat.ref} backgroundColor={sel ? C.sel : undefined} height={1}>
              <Text wrap="truncate">
                <Text color={sel ? C.coral : C.faint}>{sel ? '▌' : ' '}</Text><Text> </Text>
                <Text color={C.violet}>{col(r.seat.address, kernel ? 12 : 11)}</Text><Text color={C.fg} bold>{col(r.seat.name, 12)}</Text>
                <Text color={live ? r.state.color : C.dim}>{col(`${g[r.state.glyph] as string} ${r.state.label}`, 15)}</Text>
                <Text color={C.dim}>{col(r.agent, kernel ? 23 : 25)}</Text>
                {kernel ? <Text color={C.dim}>{t.room.roles[r.seat.name] ?? r.topic}</Text>
                  : <><Text color={ctxColor(r.ctx)}>{col(r.ctx === undefined ? '' : t.overview.context(r.ctx), 10)}</Text><Text color={C.dim}>{r.topic}</Text></>}
              </Text>
            </Box>
          );
        })}
        {hidden.length ? (
          <Text wrap="truncate">
            <Text color={C.faint}>  {t.room.tucked(hidden.length)}  </Text>
            {hidden.map((s, i) => <Text key={s.ref}><Text color={C.dim}>{s.name}</Text><Text color={C.faint}> {s.name.startsWith('advisor') ? t.room.advisor : t.room.humanSeat}{i < hidden.length - 1 ? ' · ' : ''}</Text></Text>)}
          </Text>
        ) : null}
      </TitledBox>
      {side
        ? <Box flexDirection="row" height={midH} flexShrink={0}>{exchangeBox}{queueBox}</Box>
        : <>{exchangeBox}{queueBox}</>}
      <SeatTerminal title={t.room.terminal(row?.seat.name ?? '—', where)} session={row?.session} />
    </Box>
  );
}

/** The chosen seat's terminal: its paired session's preview, in colour when the daemon sends it. */
function SeatTerminal({ title, session }: { title: string; session: Session | undefined }) {
  const { client, d, t } = useTui();
  const colored = useColorPreview(client, session?.id ?? null);
  return (
    <TitledBox title={`${title}${colored ? ` ${t.overview.inColor}` : ''}`} flexGrow={1}>
      {session
        ? <Tail lines={colored ?? d.previews.get(session.id) ?? []} ansi={colored !== undefined} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
        : <Text color={C.faint}>{t.room.noTerminal}</Text>}
    </TitledBox>
  );
}

/** An exchange, one line: « 16:22  orch-lead → build  ▤ texte »; Ledge and « toi » in coral. */
function exchangeLine(x: Exchange, g: ReturnType<typeof useTui>['g'], you: string): Line {
  const toLedge = x.to === 'ledge' || x.to === HUMAN_ADDRESS;
  const [mark, color] = toLedge ? [g.approval, C.yellow] : x.kind === 'task' || x.kind === 'handoff' ? [g.task, C.green] : [g.message, C.violet];
  const name = (ref: string) => (ref === HUMAN_ADDRESS ? 'ledge' : seatName(ref));
  const from = name(x.from), to = name(x.to);
  const who = (n: string) => (n === 'ledge' || n === you ? C.coral : C.fg);
  return [{ text: `${hhmm(x.at)}  `, color: C.faint }, { text: from, color: who(from) }, { text: ` ${g.arrow} `, color }, { text: to.padEnd(Math.max(0, 22 - from.length)), color: who(to) },
    { text: ` ${mark} `, color }, { text: x.text.replace(/\s*\n\s*/g, ' '), color: C.dim }];
}
