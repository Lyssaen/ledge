import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { randomUUID } from 'node:crypto';
import { useAsks, useContextNear } from '@ledge/fleet';
import { askShown, type Escalation, type Rig, type RigSeat } from '@ledge/protocol';
import { kernelSplit } from '@ledge/ui/rigs/model';
import { useScreenKeys, useScreenSize, useTui, type Focus } from '../context.js';
import { focusOrder, nextYours, seatStateLabel, stepFocus, type LeftRow } from '../model/left.js';
import { nearContext } from '../model/overview.js';
import { oneLine } from '../model/time.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { LeftColumn } from '../ui/LeftColumn.js';
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
  const shownAsks = useMemo(() => asks.filter(askShown), [asks]);
  const order = useMemo(() => focusOrder(rows), [rows]);
  // Sessions near their context limit (context handover spec §3.2): H hands the selected one (else the first) over.
  const threshold = useContextNear(tui.client);
  const near = useMemo(() => nearContext(d.sessions, threshold), [d.sessions, threshold]);
  const yoursCount = rows.filter(r => r.kind === 'yours').length;

  useScreenKeys((input, key) => {
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
      // Ledge's field is Ask Ledge's until its conversation is drawn here (lot 8 task 6); an escalation is answered there too.
      if (focus.kind === 'ledge' || (focus.kind === 'yours' && !selected)) { go('ask'); return true; }
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

  const keys: Array<readonly [string, string]> = [
    ['j k', t.keys.navigate], ['↵', t.keys.open], ...(yoursCount ? [['tab', t.keys.next] as const] : []), ...(selected?.pending ? [['y n', t.keys.answer] as const] : []),
    ...(selected ? [['a', t.keys.attach] as const] : []), ...(near.length ? [['H', t.keys.handover] as const] : []),
    ['1 2 3', t.keys.screens], ['/', t.keys.ask], ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]
  ];
  const crumb = focus.kind === 'ledge' ? t.home.crumb : machines.map(m => `${m.label} ${m.ready ? g.machine : '○'}`).join('  ');
  return (
    <Frame crumb={crumb} keys={keys}>
      <Box flexGrow={1}>
        <LeftColumn rows={rows} width={leftW} height={height - 2 - (tui.lastToast ? 1 : 0)} asks={shownAsks} near={near} />
        {wide ? <Box flexDirection="column" flexGrow={1}><Content focus={focus} /></Box> : null}
      </Box>
    </Frame>
  );
}

/** What the right of the home shows for the focus. Tasks 6 to 9 fill Ledge's conversation, its rail and a rig's room here. */
function Content({ focus }: { focus: Focus }) {
  const { selected, left: rows, rigs, escalations } = useTui();
  switch (focus.kind) {
    case 'ledge': return <LedgeConversation />;
    case 'yours': {
      const row = rows.find((r): r is Extract<LeftRow, { kind: 'yours' }> => r.kind === 'yours' && r.item.id === focus.id);
      return row?.item.escalation ? <LedgeConversation escalation={row.item.escalation} /> : <SessionDetail s={selected} />;
    }
    case 'session': return <SessionDetail s={selected} />;
    case 'rig': {
      const rig = rigs.find(r => r.machine === focus.machine && r.id === focus.rigId);
      return rig ? <RigRoom rig={rig} seats={rig.seats.filter(s => s.state !== 'stopped')} escalations={escalations} /> : <LedgeConversation />;
    }
    case 'seat': {
      if (selected) return <SessionDetail s={selected} />;
      const rig = rigs.find(r => r.machine === focus.machine && r.id === focus.rigId);
      const seat = rig?.seats.find(s => s.ref === focus.ref);
      return rig && seat ? <SeatAlone rig={rig} seat={seat} escalations={escalations} /> : <LedgeConversation />;
    }
    case 'kernel': {
      const rig = rigs.find(r => r.kernel && r.machine === focus.machine);
      return <RigRoom rig={rig} kernel seats={rig ? kernelSplit({ ...rig, seats: rig.seats.filter(s => s.state !== 'stopped') }).shown : []} escalations={escalations} />;
    }
  }
}

/** Ledge's conversation: drawn by task 6; here its box, and the escalation chosen in « À toi ». */
function LedgeConversation({ escalation }: { escalation?: Escalation }) {
  const { t } = useTui();
  return (
    <TitledBox title={t.home.conversation} flexGrow={1}>
      {escalation ? (
        <>
          <Text color={C.fg} bold wrap="truncate">{oneLine(escalation.summary)}</Text>
          {escalation.advice ? <Text color={C.dim} wrap="truncate">{oneLine(escalation.advice)}</Text> : null}
        </>
      ) : null}
      <Text color={C.faint}>{t.home.conversationHint}</Text>
    </TitledBox>
  );
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
