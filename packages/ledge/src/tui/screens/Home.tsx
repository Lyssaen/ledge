import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Box, Text } from 'ink';
import { randomUUID } from 'node:crypto';
import { sayToLedge, useAsks, useContextNear, useTasks, useTeams } from '@ledge/fleet';
import { askShown, decisionEscalationId, isDecisionEscalation, type Escalation, type Rig, type RigSeat, type Task } from '@ledge/protocol';
import { revisitDecision } from '../brain.js';
import { LEDGE_FOCUS, useEditing, useScreenKeys, useScreenSize, useTui, type Focus, type KeyHandler } from '../context.js';
import { focusOrder, nextYours, seatStateLabel, stepFocus, unmirroredAsks, type LeftRow } from '../model/left.js';
import { listedDecisions, nearContext, openDecisions } from '../model/overview.js';
import { wrap } from '../model/thread.js';
import { Field, fieldRows } from '../ui/Field.js';
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
  // The decisions seats put to the user (`ledge task give ledge`, roles spec 0.30): D answers the first one, written, read again
  // whole, then confirmed (y). Only the task.answer action answers one: an answer cannot be taken back.
  const tasks = useTasks(tui.client);
  const decisions = useMemo(() => openDecisions(tasks), [tasks]);
  // What the column lists: a decision mirrored as an escalation is already one of its items.
  const shownDecisions = useMemo(() => listedDecisions(tasks, tui.escalations), [tasks, tui.escalations]);
  const [deciding, setDeciding] = useState<{ id: string; draft: string; confirm: boolean } | null>(null);
  const decision = deciding ? decisions.find(x => x.id === deciding.id) : undefined;
  // Answered elsewhere meanwhile (the phone, Desktop, the chat): the field goes with it.
  useEffect(() => { if (deciding && !decision) setDeciding(null); }, [deciding, decision]);
  useEditing(!!deciding && !deciding.confirm);
  const answer = (x: Task, text: string) => {
    const rid = randomUUID();
    const off = tui.client.onMessage(m => {
      if (m.type !== 'action.result' || m.rid !== rid) return;
      off();
      tui.toast(m.reason === undefined ? { text: t.toast.reply(x.giverName), tone: 'ok' } : { text: t.toast.answerFailed(m.reason), tone: 'error' });
    });
    setTimeout(off, 10_000);
    tui.client.send({ type: 'action.run', rid, action: 'task.answer', args: { task: x.id, answer: text }, confirmed: true });
  };
  // The Ledge teams (roles spec §3.9) of the tree: J seats the selected session in one of its project's teams, R resumes a resting one.
  const teams = useTeams(tui.client);
  const [joining, setJoining] = useState<{ index: number } | null>(null);
  const teamRows = rows.filter((r): r is Extract<LeftRow, { kind: 'team' }> => r.kind === 'team');
  const projectOf = (at: number) => { for (let i = at; i >= 0; i--) if (rows[i]!.kind === 'project') return i; return -1; };
  const selectedAt = selected ? rows.findIndex(r => r.kind === 'session' && r.s.id === selected.id) : -1;
  const sameProject = (r: LeftRow) => selectedAt >= 0 && projectOf(rows.indexOf(r)) === projectOf(selectedAt);
  const choices = teamRows.filter(sameProject).map(r => r.team).filter(x => x.state !== 'dissolved' && x.id !== selected?.team);
  const seatTeam = selected?.team ? teams?.find(x => x.id === selected.team && x.state !== 'dissolved') : undefined;
  // Ledge's conversation is on the right for Ledge and for an escalation of « À toi »; it has the keyboard once ↵ or / opened
  // its field (`ledgeFocus` past the left column). Narrow, it then takes the whole screen.
  const yoursEsc = focus.kind === 'yours' ? rows.find((r): r is Extract<LeftRow, { kind: 'yours' }> => r.kind === 'yours' && r.item.id === focus.id)?.item.escalation : undefined;
  const ledgeish = focus.kind === 'ledge' || !!yoursEsc;
  const active = ledgeish && tui.ledgeFocus !== LEDGE_FOCUS.left;
  const { setLedgeFocus } = tui;
  useEffect(() => { if (!ledgeish) setLedgeFocus(LEDGE_FOCUS.left); }, [ledgeish, setLedgeFocus]);
  const conv = useRef<KeyHandler | null>(null);
  const [convBar, setConvBar] = useState<Array<readonly [string, string]>>([]);
  // A rig's room or the kernel's: on the right when wide; narrow, on the whole screen once ↵ or 2 opened it (esc, 1 close it).
  // Its keys (j k its seats, ↵ a w) and its key bar.
  const room = useRef<KeyHandler | null>(null);
  const [roomBar, setRoomBar] = useState<Array<readonly [string, string]>>([]);
  const roomy = focus.kind === 'rig' || focus.kind === 'kernel';
  const [roomOpen, setRoomOpen] = useState(false);
  useEffect(() => { if (!roomy || wide) setRoomOpen(false); }, [roomy, wide]);
  const roomShown = roomy && (wide || roomOpen);
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
    // The answer to a decision: its field has the keys; read again, y sends it, n or esc goes back to the field, nothing else goes through.
    if (deciding) {
      if (!deciding.confirm) { if (key.escape) setDeciding(null); return true; }
      if (input === 'y' && decision) { setDeciding(null); answer(decision, deciding.draft.trim()); return true; }
      if (input === 'n' || key.escape) { setDeciding({ ...deciding, confirm: false }); return true; }
      return true;
    }
    // J's chooser: j k move, ↵ seats the session in its role, else the team's first free one; esc leaves.
    if (joining) {
      if (key.escape) { setJoining(null); return true; }
      if (input === 'j' || key.downArrow) { setJoining({ index: (joining.index + 1) % Math.max(1, choices.length) }); return true; }
      if (input === 'k' || key.upArrow) { setJoining({ index: (joining.index + choices.length - 1) % Math.max(1, choices.length) }); return true; }
      if (key.return && selected && choices[joining.index]) {
        const team = choices[joining.index]!;
        const role = selected.role ?? team.seats.find(x => x.sessionId === null)?.role;
        setJoining(null);
        if (!role) { tui.toast({ text: t.overview.noTeamHere, tone: 'info' }); return true; }
        tui.client.send({ type: 'team.join', team: team.id, session: selected.id, role });
        tui.toast({ text: t.toast.joined(selected.name, team.name), tone: 'ok' });
      }
      return true;
    }
    // D answers the selected lead's question (its `task-` row), else the oldest decision.
    if (!active && input === 'D') {
      const mine = yoursEsc && isDecisionEscalation(yoursEsc) ? decisions.find(x => decisionEscalationId(x.id) === yoursEsc.id) : undefined;
      const target = mine ?? decisions[0];
      if (target) setDeciding({ id: target.id, draft: '', confirm: false });
      return true;
    }
    // The rail opened over the left column: esc closes it before anything else.
    if (railOpen && key.escape) { setRailOpen(false); return true; }
    // + on Ledge's Rigs tab launches a rig.
    if (input === '+' && tab === 'rigs') { go('launch', { launch: 'rig' }); return true; }
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
    // 2, narrow: the App chooses the rig, its room opens on the whole screen (a question selected takes its digits first).
    if (input === '2' && !wide && selected?.pending?.kind !== 'question') setRoomOpen(true);
    if (active) return false;
    if (roomShown && room.current?.(input, key)) return true;
    if (roomShown && !wide) {
      // The room on the whole screen: esc back to the left column; j k past its seats stay in it.
      if (key.escape) { setRoomOpen(false); return true; }
      if (input === 'j' || input === 'k' || key.upArrow || key.downArrow) return true;
    }
    if (input === 'J' && selected) { if (choices.length) setJoining({ index: 0 }); else tui.toast({ text: t.overview.noTeamHere, tone: 'info' }); return true; }
    // R, off Ledge (where it sums up the day): resume a resting team, the selected seat's, else its project's first, else the first.
    if (input === 'R') {
      const resting = (seatTeam?.state === 'resting' ? seatTeam : undefined) ?? teamRows.find(r => r.team.state === 'resting' && sameProject(r))?.team ?? teamRows.find(r => r.team.state === 'resting')?.team;
      if (resting) { tui.client.send({ type: 'team.resume', team: resting.id }); tui.toast({ text: t.toast.resumed(resting.name), tone: 'ok' }); }
      return true;
    }
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
      if (roomy && !wide) { setRoomOpen(true); return true; }
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

  const keys: Array<readonly [string, string]> = deciding?.confirm ? [['y', t.keys.sendAnswer], ['n esc', t.keys.edit]]
    : deciding ? [['↵', t.keys.review], ['alt+↵', t.keys.newLine], ['esc', t.keys.cancel]]
    : joining ? [['j k', t.keys.navigate], ['↵', t.keys.join], ['esc', t.keys.cancel]]
    : active ? convBar : roomShown ? [...(wide || roomBar.some(([k]) => k === 'esc') ? [] : [['esc', t.keys.back] as const]), ...roomBar, ['/', t.keys.ask], ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]] : [
    ...(decisions.length ? [['D', t.keys.answerDecision] as const] : []),
    ['j k', t.keys.navigate], ['↵', ledgeish ? t.keys.write : t.keys.open], ...(showConv ? convBar : []), ...(yoursCount ? [['tab', t.keys.next] as const] : []), ...(selected?.pending ? [['y n', t.keys.answer] as const] : []),
    ...(selected ? [['a', t.keys.attach] as const] : []), ...(choices.length ? [['J', t.keys.join] as const] : []),
    ...(!ledgeish && teamRows.some(r => r.team.state === 'resting') ? [['R', t.keys.resume] as const] : []), ...(near.length ? [['H', t.keys.handover] as const] : []),
    ...(ledgeish && folded ? [[']', railOpen ? t.keys.close : t.keys.point] as const] : []), ...(ledgeish ? [['R', t.keys.summarize] as const] : []),
    ['1 2 3', t.keys.screens], ['/', t.keys.ask], ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]
  ];
  // The answer's field, or the answer read again whole, across the screen under the columns; J's chooser likewise.
  const answerLines = deciding?.confirm ? wrap(deciding.draft.trim(), Math.max(10, columns - 4)) : [];
  const decideHeight = !deciding ? 0 : deciding.confirm ? Math.min(answerLines.length, Math.max(1, height - 12)) + 2 : fieldRows(columns, height) + 2;
  const joinHeight = joining && selected ? Math.max(1, choices.length) + 2 : 0;
  const bodyHeight = height - 2 - (tui.lastToast ? 1 : 0) - decideHeight - joinHeight;
  const crumb = focus.kind === 'ledge' ? t.home.crumb : machines.map(m => `${m.label} ${m.ready ? g.machine : '○'}`).join('  ');
  return (
    <Frame crumb={crumb} keys={keys} kept={tui.kept.drafts.has('ledge')}>
      <Box flexGrow={1}>
        {(wide ? !(railShown && folded) : !active && !roomShown) ? <LeftColumn rows={rows} width={leftW} height={bodyHeight} asks={shownAsks} near={near} decisions={shownDecisions} /> : null}
        {showConv ? <LedgeTabs tab={tab} width={!wide ? columns : columns - (railShown ? RAIL_W : 0) - (railShown && folded ? 0 : leftW)} folded={folded && !railShown}
          {...(yoursEsc ? { escalation: yoursEsc } : {})} keys={conv} onBar={setConvBar} onTab={moveTab} />
          : wide || roomShown ? <Box flexDirection="column" flexGrow={1}><Content focus={focus} room={room} onRoomBar={setRoomBar} side={three} height={bodyHeight} /></Box> : null}
        {railShown ? <LedgeRail width={RAIL_W} /> : null}
      </Box>
      {joining && selected ? (
        <TitledBox title={t.overview.joinWhich(selected.name)} color={C.coral} titleColor={C.coral} height={joinHeight} flexShrink={0}>
          {choices.map((x, i) => <Text key={x.id} wrap="truncate" backgroundColor={i === joining.index ? C.sel : undefined}><Text color={C.coral}>{g.team}</Text> {x.name}</Text>)}
        </TitledBox>
      ) : null}
      {deciding && decision ? (deciding.confirm
        ? <TitledBox title={t.overview.confirmAnswer(decision.giverName)} color={C.red} titleColor={C.red} height={decideHeight} flexShrink={0}>
          {answerLines.slice(0, decideHeight - 2).map((l, i) => <Text key={i} color={C.fg} wrap="truncate">{l || ' '}</Text>)}
        </TitledBox>
        : <Field title={t.overview.decisionTitle(decision.giverName, decision.title)} value={deciding.draft} onChange={v => setDeciding(x => (x ? { ...x, draft: v } : x))}
          onSubmit={v => { if (!v.trim()) return false; setDeciding(x => (x ? { ...x, draft: v, confirm: true } : x)); }} onEscape={() => setDeciding(null)} active placeholder={t.overview.decisionHint} />) : null}
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
