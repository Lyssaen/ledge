import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Box, Text } from 'ink';
import { randomUUID } from 'node:crypto';
import { sayToLedge, useAsks, useContextNear } from '@ledge/fleet';
import { askShown, type Escalation, type Rig, type RigSeat } from '@ledge/protocol';
import { revisitDecision } from '../brain.js';
import { LEDGE_FOCUS, useScreenKeys, useScreenSize, useTui, type Focus, type KeyHandler } from '../context.js';
import { focusOrder, nextYours, seatStateLabel, stepFocus, unmirroredAsks, type LeftRow } from '../model/left.js';
import { nearContext } from '../model/overview.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { LeftColumn } from '../ui/LeftColumn.js';
import { LedgeRail, RAIL_W, settledToday } from '../ui/LedgeRail.js';
import { LEDGE_TABS, LedgeTabs, type LedgeTab } from '../ui/LedgeTabs.js';
import { RigRoom } from '../ui/RigRoom.js';
import { SessionDetail } from '../ui/SessionDetail.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Under this many columns the home is one column, its left one: ↵ opens what is chosen. */
export const WIDE = 100;
/** From this many columns, the home has its three columns (the left one, Ledge's conversation, its rail). */
export const THREE = 140;

/** The home: the left column, and on its right what it has chosen (Ledge, a session, a rig, a seat, the kernel). For Ledge, its
 *  tabs and, from 140 columns, its rail; from 100 to 139 the rail is one line at the tabs' head, `]` opens it beside them in the
 *  left column's place (esc closes it); below 100 the left column alone, ↵ opening Ledge's conversation on the whole screen. */
export function Home() {
  const tui = useTui();
  const { d, t, g, selected, actions, go, attach, focus, setFocus, left: rows, machines } = tui;
  const { columns, rows: height } = useScreenSize();
  const wide = columns >= WIDE;
  const three = columns >= THREE;
  const folded = wide && !three;
  // The mockup's 46 columns, and one for the selection's bar (the mockup draws it in the box's padding).
  const leftW = wide ? (columns >= THREE ? 47 : 44) : columns;
  const asks = useAsks(tui.client);
  // An ask mirrored as an escalation is already an item of « À toi »: its own row would list and count it twice.
  const shownAsks = useMemo(() => unmirroredAsks(asks.filter(askShown), tui.escalations), [asks, tui.escalations]);
  const order = useMemo(() => focusOrder(rows), [rows]);
  // Sessions near their context limit (context handover spec §3.2): H hands the selected one (else the first) over.
  const threshold = useContextNear(tui.client);
  const near = useMemo(() => nearContext(d.sessions, threshold), [d.sessions, threshold]);
  const yoursCount = rows.filter(r => r.kind === 'yours').length;
  // Ledge's conversation is on the right for Ledge and for an escalation of « À toi »; it has the keyboard once ↵ or / opened
  // its field (`ledgeFocus` past the left column). Narrow, it then takes the whole screen.
  const yoursEsc = focus.kind === 'yours' ? rows.find((r): r is Extract<LeftRow, { kind: 'yours' }> => r.kind === 'yours' && r.item.id === focus.id)?.item.escalation : undefined;
  const ledgeish = focus.kind === 'ledge' || !!yoursEsc;
  const active = ledgeish && tui.ledgeFocus !== LEDGE_FOCUS.left;
  const { setLedgeFocus } = tui;
  useEffect(() => { if (!ledgeish) setLedgeFocus(LEDGE_FOCUS.left); }, [ledgeish, setLedgeFocus]);
  const conv = useRef<KeyHandler | null>(null);
  const [convBar, setConvBar] = useState<Array<readonly [string, string]>>([]);
  // A rig's room or the kernel's, on the right when wide: its keys (j k its seats, ↵ a w) and its key bar.
  const room = useRef<KeyHandler | null>(null);
  const [roomBar, setRoomBar] = useState<Array<readonly [string, string]>>([]);
  const roomShown = wide && (focus.kind === 'rig' || focus.kind === 'kernel');
  const showConv = ledgeish && (wide || active);
  // Ledge's tabs (an escalation of « À toi » is talked over in the conversation), and the rail opened over the left column.
  const [tabState, setTab] = useState<LedgeTab>('conversation');
  const tab: LedgeTab = focus.kind === 'ledge' ? tabState : 'conversation';
  const [railOpen, setRailOpen] = useState(false);
  const railShown = showConv && (three || (folded && railOpen));
  useEffect(() => { if (!folded || !ledgeish) setRailOpen(false); }, [folded, ledgeish]);
  const moveTab = (dir: 1 | -1) => setTab(x => LEDGE_TABS[(LEDGE_TABS.indexOf(x) + dir + LEDGE_TABS.length) % LEDGE_TABS.length]!);
  const settled = settledToday(tui.brain.decisions);
  const local = machines.find(m => m.id === 'local');
  const say = (text: string) => tui.toast({ text, tone: 'info' });

  useScreenKeys((input, key) => {
    // The rail opened over the left column: esc closes it before anything else.
    if (railOpen && key.escape) { setRailOpen(false); return true; }
    if (showConv && conv.current?.(input, key)) return true;
    if (ledgeish) {
      if (input === ']' && folded) { setRailOpen(o => !o); return true; }
      // R: Ledge sums up the day, in its conversation.
      if (input === 'R') {
        if (!local?.ready) say(t.ask.offline);
        else { sayToLedge(tui.client, t.rail.summaryAsk); setTab('conversation'); }
        return true;
      }
      // u, the thread naming no decision of Ledge's: the latest one the rail lists.
      if (input === 'u' && railShown && settled.length) {
        revisitDecision(tui.client, settled[settled.length - 1]!.id, { refused: m => say(t.conv.revisitRefused(m)), offline: () => say(t.ask.offline) });
        return true;
      }
      // m: the mandate, on the whole screen when narrow.
      if (input === 'm' && focus.kind === 'ledge') { setTab('mandat'); if (!wide) setLedgeFocus(LEDGE_FOCUS.convo); return true; }
    }
    if (active) return false;
    if (roomShown && room.current?.(input, key)) return true;
    if (input === 'H') {
      const s = (selected && selected.source === 'launcher' && selected.state !== 'exited' && selected.tool !== 'omp' && (!selected.handover || selected.handover.state === 'failed') ? selected : undefined) ?? near.find(x => x.handover?.state !== 'failed') ?? near[0];
      if (!s) return true;
      const rid = randomUUID();
      const off = tui.client.onMessage(m => { if (m.type === 'session.handover.result' && m.rid === rid) { off(); tui.toast(m.ok ? { text: t.toast.handover(s.name), tone: 'ok' } : { text: t.toast.handoverRefused(m.reason ?? '?'), tone: 'info' }); } });
      setTimeout(off, 5000);
      tui.client.send({ type: 'session.handover', rid, id: s.id });
      return true;
    }
    if (input === 'j' || key.downArrow) { setFocus(stepFocus(order, focus, 1)); return true; }
    if (input === 'k' || key.upArrow) { setFocus(stepFocus(order, focus, -1)); return true; }
    if (key.tab) { setFocus(nextYours(order, focus)); return true; }
    if (key.return) {
      // Ledge's field; on an escalation of « À toi », the conversation with it.
      // Narrow, the conversation opens on the whole screen with the keyboard on it: 1-9 answer the decision, / writes.
      if (focus.kind === 'ledge' || (focus.kind === 'yours' && !selected)) { setFocus(focus.kind === 'yours' && !yoursEsc ? { kind: 'ledge' } : focus); setLedgeFocus(wide ? LEDGE_FOCUS.field : LEDGE_FOCUS.convo); return true; }
      if (selected) go('session');
      return true;
    }
    if (!selected) return false;
    if (input === 'a') { attach(selected); return true; }
    if (input === 'r' && selected.pending) { go('session'); return true; }
    // A digit answers the selected question; otherwise it switches screens (the App's keys).
    if (/^[1-9]$/.test(input) && selected.pending?.kind !== 'question') return false;
    if (input === 'y' || input === 'n' || input === 'A' || /^[1-9]$/.test(input)) return actions.key(selected, input);
    if (input === 'i' && selected.state === 'working') { actions.interrupt(selected); return true; }
    return false;
  });

  const keys: Array<readonly [string, string]> = active ? convBar : roomShown ? [...roomBar, ['/', t.keys.ask], ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]] : [
    ['j k', t.keys.navigate], ['↵', ledgeish ? t.keys.write : t.keys.open], ...(showConv ? convBar : []), ...(yoursCount ? [['tab', t.keys.next] as const] : []), ...(selected?.pending ? [['y n', t.keys.answer] as const] : []),
    ...(selected ? [['a', t.keys.attach] as const] : []), ...(near.length ? [['H', t.keys.handover] as const] : []),
    ...(ledgeish && folded ? [[']', railOpen ? t.keys.close : t.keys.point] as const] : []), ...(ledgeish ? [['R', t.keys.summarize] as const] : []),
    ['1 2 3', t.keys.screens], ['/', t.keys.ask], ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]
  ];
  const crumb = focus.kind === 'ledge' ? t.home.crumb : machines.map(m => `${m.label} ${m.ready ? g.machine : '○'}`).join('  ');
  return (
    <Frame crumb={crumb} keys={keys} kept={tui.kept.drafts.has('ledge')}>
      <Box flexGrow={1}>
        {(wide ? !(railShown && folded) : !active) ? <LeftColumn rows={rows} width={leftW} height={height - 2 - (tui.lastToast ? 1 : 0)} asks={shownAsks} near={near} /> : null}
        {showConv ? <LedgeTabs tab={tab} width={!wide ? columns : columns - (railShown ? RAIL_W : 0) - (railShown && folded ? 0 : leftW)} folded={folded && !railShown}
          {...(yoursEsc ? { escalation: yoursEsc } : {})} keys={conv} onBar={setConvBar} onTab={moveTab} />
          : wide ? <Box flexDirection="column" flexGrow={1}><Content focus={focus} room={room} onRoomBar={setRoomBar} side={three} height={height - 2 - (tui.lastToast ? 1 : 0)} /></Box> : null}
        {railShown ? <LedgeRail width={RAIL_W} /> : null}
      </Box>
    </Frame>
  );
}

/** What the right of the home shows for a focus other than Ledge's conversation: a session, a rig's room, the kernel's. */
function Content({ focus, room, onRoomBar, side, height }: { focus: Focus; room: MutableRefObject<KeyHandler | null>; onRoomBar(b: Array<readonly [string, string]>): void; side: boolean; height: number }) {
  const { selected, rigs, escalations } = useTui();
  // A rig or a seat gone: the focus moves on at the next render.
  const none = <Box flexGrow={1} />;
  switch (focus.kind) {
    case 'ledge': case 'yours': case 'session': return <SessionDetail s={selected} />;
    case 'rig': case 'kernel': return <RigRoom target={focus} side={side} height={height} keys={room} onBar={onRoomBar} />;
    case 'seat': {
      if (selected) return <SessionDetail s={selected} />;
      const rig = rigs.find(r => r.machine === focus.machine && r.id === focus.rigId);
      const seat = rig?.seats.find(s => s.ref === focus.ref);
      return rig && seat ? <SeatAlone rig={rig} seat={seat} escalations={escalations} /> : none;
    }
  }
}

/** A seat with no Ledge session paired: its state, nothing more to show yet. */
function SeatAlone({ rig, seat, escalations }: { rig: Rig; seat: RigSeat; escalations: Escalation[] }) {
  const { t, g } = useTui();
  const st = seatStateLabel(seat, escalations, t.seat);
  return (
    <TitledBox title={`${seat.name} · ${rig.name}`} flexGrow={1}>
      <Text wrap="truncate"><Text color={st.color}>{g[st.glyph] as string} {st.label}</Text><Text color={C.dim}>  {seat.runtime}{seat.model ? ` · ${seat.model}` : ''} · {seat.address}</Text></Text>
      <Text color={C.faint}>{t.home.seatAlone}</Text>
    </TitledBox>
  );
}
