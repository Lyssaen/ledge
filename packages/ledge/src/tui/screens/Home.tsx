import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { randomUUID } from 'node:crypto';
import { useAsks, useContextNear } from '@ledge/fleet';
import { askShown, type Escalation, type Rig, type RigSeat } from '@ledge/protocol';
import { kernelSplit } from '@ledge/ui/rigs/model';
import { LEDGE_FOCUS, useScreenKeys, useScreenSize, useTui, type Focus, type KeyHandler } from '../context.js';
import { focusOrder, nextYours, seatStateLabel, stepFocus, unmirroredAsks, type LeftRow } from '../model/left.js';
import { nearContext } from '../model/overview.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { LeftColumn } from '../ui/LeftColumn.js';
import { LedgeConversation } from '../ui/LedgeConversation.js';
import { SessionDetail } from '../ui/SessionDetail.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Under this many columns the home is one column, its left one: ↵ opens what is chosen. */
export const WIDE = 100;
/** From this many columns, the home has its three columns (the left one, Ledge's conversation, its rail). */
export const THREE = 140;

/** The home: the left column, and on its right what it has chosen (Ledge, a session, a rig, a seat, the kernel). */
export function Home() {
  const tui = useTui();
  const { d, t, g, selected, actions, go, attach, focus, setFocus, left: rows, machines } = tui;
  const { columns, rows: height } = useScreenSize();
  const wide = columns >= WIDE;
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
  const showConv = ledgeish && (wide || active);

  useScreenKeys((input, key) => {
    if (showConv && conv.current?.(input, key)) return true;
    if (active) return false;
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
      if (focus.kind === 'ledge' || (focus.kind === 'yours' && !selected)) { setFocus(focus.kind === 'yours' && !yoursEsc ? { kind: 'ledge' } : focus); setLedgeFocus(LEDGE_FOCUS.field); return true; }
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

  const keys: Array<readonly [string, string]> = active ? convBar : [
    ['j k', t.keys.navigate], ['↵', ledgeish ? t.keys.write : t.keys.open], ...(showConv ? convBar : []), ...(yoursCount ? [['tab', t.keys.next] as const] : []), ...(selected?.pending ? [['y n', t.keys.answer] as const] : []),
    ...(selected ? [['a', t.keys.attach] as const] : []), ...(near.length ? [['H', t.keys.handover] as const] : []),
    ['1 2 3', t.keys.screens], ['/', t.keys.ask], ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]
  ];
  const crumb = focus.kind === 'ledge' ? t.home.crumb : machines.map(m => `${m.label} ${m.ready ? g.machine : '○'}`).join('  ');
  return (
    <Frame crumb={crumb} keys={keys} kept={tui.kept.drafts.has('ledge')}>
      <Box flexGrow={1}>
        {wide || !active ? <LeftColumn rows={rows} width={leftW} height={height - 2 - (tui.lastToast ? 1 : 0)} asks={shownAsks} near={near} /> : null}
        {showConv ? <LedgeConversation width={wide ? columns - leftW : columns} {...(yoursEsc ? { escalation: yoursEsc } : {})} keys={conv} onBar={setConvBar} />
          : wide ? <Box flexDirection="column" flexGrow={1}><Content focus={focus} /></Box> : null}
      </Box>
    </Frame>
  );
}

/** What the right of the home shows for a focus other than Ledge's conversation. Tasks 8 and 9 fill a rig's room here. */
function Content({ focus }: { focus: Focus }) {
  const { selected, rigs, escalations } = useTui();
  // A rig or a seat gone: the focus moves on at the next render.
  const none = <Box flexGrow={1} />;
  switch (focus.kind) {
    case 'ledge': case 'yours': case 'session': return <SessionDetail s={selected} />;
    case 'rig': {
      const rig = rigs.find(r => r.machine === focus.machine && r.id === focus.rigId);
      return rig ? <RigRoom rig={rig} seats={rig.seats.filter(s => s.state !== 'stopped')} escalations={escalations} /> : none;
    }
    case 'seat': {
      if (selected) return <SessionDetail s={selected} />;
      const rig = rigs.find(r => r.machine === focus.machine && r.id === focus.rigId);
      const seat = rig?.seats.find(s => s.ref === focus.ref);
      return rig && seat ? <SeatAlone rig={rig} seat={seat} escalations={escalations} /> : none;
    }
    case 'kernel': {
      const rig = rigs.find(r => r.kernel && r.machine === focus.machine);
      return <RigRoom rig={rig} kernel seats={rig ? kernelSplit({ ...rig, seats: rig.seats.filter(s => s.state !== 'stopped') }).shown : []} escalations={escalations} />;
    }
  }
}

/** A rig's room (task 9 draws it whole): its seats and their state. The kernel's room is the same, its seats tucked away aside. */
function RigRoom({ rig, kernel, seats, escalations }: { rig: Rig | undefined; kernel?: boolean; seats: RigSeat[]; escalations: Escalation[] }) {
  const { t, g } = useTui();
  return (
    <TitledBox title={kernel ? `${g.kernel} ${t.home.kernel}` : `${g.rig} ${rig?.name ?? ''}`} flexGrow={1}>
      {seats.length === 0 ? <Text color={C.faint}>{t.home.noSeat}</Text> : seats.map(s => {
        const st = seatStateLabel(s, escalations, t.seat);
        return (
          <Text key={s.ref} wrap="truncate">
            <Text color={C.violet}>{s.address.padEnd(12)}</Text><Text color={C.fg} bold>{s.name.padEnd(12)}</Text>
            <Text color={st.color}>{g[st.glyph] as string} {st.label.padEnd(14)}</Text><Text color={C.dim}>{s.runtime}{s.model ? ` · ${s.model}` : ''}</Text>
          </Text>
        );
      })}
    </TitledBox>
  );
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
