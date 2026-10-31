import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { FleetAsk } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { rigColor } from '@ledge/ui/rigs/model';
import { useTui } from '../context.js';
import { cells } from '../model/cells.js';
import { fit, machineLabel } from '../model/labels.js';
import { focusKey, hasOpenRig, rowFocus, seatStateLabel, type LeftRow } from '../model/left.js';
import { helperCount } from '../model/overview.js';
import { clock, oneLine } from '../model/time.js';
import { C, projectColor, STATE_COLOR } from '../theme.js';
import { Ago } from './Ago.js';
import { TitledBox } from './TitledBox.js';

/** A name's cells in a row of the column (the mockup's `seat()`). */
const NAME_W = 10;

/** The rows of a box that fit in `height`, scrolled so that the chosen one shows. */
export function windowed<T extends { key: string }>(rows: readonly T[], selectedKey: string | null, height: number): T[] {
  if (rows.length <= height) return [...rows];
  const at = Math.max(0, rows.findIndex(r => r.key === selectedKey));
  const start = Math.min(Math.max(0, at - Math.floor(height / 2)), rows.length - height);
  return rows.slice(start, start + height);
}

/** A row of the column: the coral bar and the selection's background when chosen. */
function Row({ on, children, right }: { on: boolean; children: ReactNode; right?: ReactNode }) {
  return (
    <Box backgroundColor={on ? C.sel : undefined} justifyContent="space-between" height={1}>
      <Text wrap="truncate"><Text color={on ? C.coral : C.faint}>{on ? '▌' : ' '}</Text>{children}</Text>
      {right ? <Box flexShrink={0}><Text wrap="truncate">{right}</Text></Box> : null}
    </Box>
  );
}

/**
 * The home's left column (the mockup's `left()`): Ledge, « À toi », « Projets · sessions seules », « Rigs ». `height` is what the
 * terminal leaves it; « Projets » and « Rigs » share what the first two leave, each scrolled to the row chosen.
 */
export function LeftColumn({ rows, width, height, asks, near }: { rows: readonly LeftRow[]; width: number; height: number; asks: readonly FleetAsk[]; near: readonly Session[] }) {
  const { t, g, focus, rigs, escalations, machines, openrig } = useTui();
  const chosen = focusKey(focus);
  const on = (r: LeftRow) => { const f = rowFocus(r); return !!f && focusKey(f) === chosen; };
  const inner = width - 4;
  const stateW = Math.max(...Object.values(t.state).map(x => x.length), ...Object.values(t.seat).map(x => x.length)) + 1;

  const ledge = rows.find((r): r is Extract<LeftRow, { kind: 'ledge' }> => r.kind === 'ledge');
  const yours = rows.filter((r): r is Extract<LeftRow, { kind: 'yours' }> => r.kind === 'yours');
  const tree = rows.filter(r => r.kind === 'project' || r.kind === 'branch' || r.kind === 'session');
  const rigRows = rows.filter(r => r.kind === 'rig' || r.kind === 'seat' || r.kind === 'idle' || r.kind === 'kernel');
  const installed = hasOpenRig(rigs, openrig);

  const yoursCount = yours.length + asks.length + near.length;
  // An ask takes two rows: the question, then how to answer it.
  const yoursHeight = Math.max(1, Math.min(yours.length + asks.length * 2 + near.length, 6));
  // Ledge's box (4), « À toi », and two borders for each of the last two boxes.
  const room = Math.max(2, height - 4 - (yoursHeight + 2) - 4);
  // Not installed: one line, or two when it does not fit (« OpenRig n’est pas installé », then « + pour lancer un rig »).
  const notInstalled = cells(t.home.noOpenRig) <= inner ? [t.home.noOpenRig] : t.home.noOpenRig.split(' · ');
  const rigsNeed = installed ? Math.max(1, rigRows.length) : notInstalled.length;
  const treeNeed = Math.max(1, tree.length);
  const treeH = Math.max(1, Math.min(treeNeed, room - Math.min(rigsNeed, Math.floor(room / 2))));
  const rigsH = Math.max(1, room - treeH);

  const keyed = (list: LeftRow[]) => list.map((r, i) => ({ key: (() => { const f = rowFocus(r); return f ? focusKey(f) : `${r.kind}#${i}`; })(), r }));
  const machineName = (id: string) => machines.find(m => m.id === id)?.label ?? id;
  const askW = Math.max(6, inner - 2 - NAME_W - 10 - 7);
  // A row: its bar, two spaces, the state's glyph and a space, the name, the topic and a space, the state.
  const topicW = Math.max(6, inner - 5 - NAME_W - stateW);

  const sessionRow = (s: Session, sel: boolean, indent = 0) => {
    const st = botState(s);
    const n = helperCount(s);
    return (
      <Row on={sel}>
        <Text>{' '.repeat(2 + indent)}</Text>
        <Text color={s.offline ? C.faint : STATE_COLOR[st]}>{g[st]} </Text>
        <Text color={s.offline ? C.dim : C.fg} bold>{fit(s.name, NAME_W)}</Text>
        <Text color={C.dim}>{fit(oneLine(s.topic ?? s.title), Math.max(6, topicW - indent))} </Text>
        <Text color={s.offline ? C.faint : STATE_COLOR[st]}>{fit(s.offline ? t.overview.offline : t.state[st], stateW).trimEnd()}</Text>
        {n > 0 ? <Text color={C.violet}> +{n}</Text> : null}
        {s.machineName && s.machineId !== 'local' ? <Text color={C.faint}> · {machineLabel(s)}</Text> : null}
      </Row>
    );
  };

  const draw = (r: LeftRow, key: string): ReactNode => {
    switch (r.kind) {
      case 'project': return <Text key={key} wrap="truncate"> <Text color={r.color}>{g.project}</Text> <Text color={C.fg} bold>{r.label}</Text> <Text color={C.faint}>{t.overview.sessions(r.count)}</Text></Text>;
      case 'branch': return <Text key={key} wrap="truncate" color={C.faint}>   {g.branch} {r.branch}</Text>;
      case 'session': return <Box key={key}>{sessionRow(r.s, on(r))}</Box>;
      case 'rig': {
        const where = [r.place.kind === 'project' ? t.home.inProject(r.place.name) : r.place.kind === 'off' ? t.home.offProject : '', r.rig.machine !== 'local' ? t.home.onMachine(machineName(r.rig.machine)) : ''].filter(Boolean);
        return (
          <Box key={key}><Row on={on(r)}>
            <Text color={projectColor(rigColor(r.rig))}>{g.rig}</Text> <Text color={C.fg} bold>{r.rig.name}</Text>
            <Text color={C.dim}> {t.home.working(r.working, r.total)}</Text>
            {where.map(w => <Text key={w} color={C.faint}> · {w}</Text>)}
          </Row></Box>
        );
      }
      case 'seat': {
        const st = seatStateLabel(r.seat, escalations, t.seat);
        const topic = r.session ? oneLine(r.session.topic ?? r.session.title) : '';
        return (
          <Box key={key}><Row on={on(r)}>
            <Text>  </Text><Text color={st.color}>{g[st.glyph] as string} </Text>
            <Text color={C.fg} bold>{fit(r.seat.name, NAME_W)}</Text>
            <Text color={C.dim}>{fit(topic, topicW)} </Text>
            <Text color={st.color}>{st.label}</Text>
          </Row></Box>
        );
      }
      case 'idle': return <Text key={key} wrap="truncate" color={C.faint}>     {g.idle} {t.home.available(r.names.join(', '), r.names.length)}</Text>;
      case 'kernel': {
        const state = r.state === 'running' ? (r.working ? t.home.kernelState.working : t.home.kernelState.idle) : t.home.kernelState[r.state];
        return (
          <Box key={key}><Row on={on(r)}>
            <Text color={projectColor('slate')}>{g.kernel}</Text> <Text color={C.fg} bold>{t.home.kernel}</Text>
            <Text color={C.faint}> {state}{r.seats.length ? ` · ${r.seats.join(', ')}` : ''}{r.machine !== 'local' ? ` · ${t.home.onMachine(machineName(r.machine))}` : ''}</Text>
          </Row></Box>
        );
      }
      default: return null;
    }
  };

  const ledgeOn = focus.kind === 'ledge';
  const ledgeBox = ledge ? (
    <TitledBox title={t.home.ledge} color={ledgeOn ? C.coral : C.line} titleColor={ledgeOn ? C.coral : C.dim} height={4} flexShrink={0}>
      <Row on={ledgeOn} right={ledge.at ? <Text color={C.faint}>{clock(ledge.at)}</Text> : null}>
        <Text color={C.coral}>{g.logo} </Text><Text color={C.fg} bold>{t.home.ledge}</Text><Text color={C.coral}>.</Text>
      </Row>
      <Row on={ledgeOn} right={ledge.unread ? <Text color={C.fg} bold backgroundColor={C.danger}> {ledge.unread} </Text> : null}>
        <Text color={C.dim}> {oneLine(ledge.preview)}</Text>
      </Row>
    </TitledBox>
  ) : null;

  const yoursBox = (
    <TitledBox title={t.overview.yours(yoursCount)} color={yoursCount ? C.red : C.line} titleColor={yoursCount ? C.red : C.dim} height={yoursHeight + 2} flexShrink={0}>
      {yoursCount === 0 ? <Text color={C.faint}>{t.overview.nobodyWaits}</Text> : [
        ...windowed(keyed(yours), chosen, Math.min(yours.length, yoursHeight)).map(({ key, r }) => {
          const it = (r as Extract<LeftRow, { kind: 'yours' }>).item;
          const grace = it.escalation?.state === 'grace';
          const color = grace ? C.dim : it.glyph === 'question' ? C.yellow : C.red;
          // Where it waits: the rig's ▣ in its colour, or the session's project ■ in the project's.
          const project = it.session ? rows.find((x): x is Extract<LeftRow, { kind: 'project' }> => x.kind === 'project' && x.label === it.where) : undefined;
          const where = it.escalation?.rigId ? { glyph: g.rig, color: projectColor(rigColor({ name: it.where })), label: it.where }
            : it.escalation ? { glyph: g.machine, color: C.dim, label: machineName(it.where) }
            : { glyph: g.project, color: project?.color ?? C.dim, label: it.where };
          return (
            <Box key={key}><Row on={on(r)} right={<Text color={C.faint}> <Ago iso={it.at} /></Text>}>
              <Text color={color}>{g[it.glyph]} </Text><Text color={C.fg} bold>{fit(it.who, NAME_W)}</Text>
              <Text color={where.color}>{where.glyph} </Text><Text color={C.dim}>{fit(where.label, 8)}</Text>
              <Text color={color}>{fit(oneLine(grace ? t.home.grace : it.text), askW)}</Text>
            </Row></Box>
          );
        }),
        ...asks.slice(0, Math.max(0, Math.floor((yoursHeight - yours.length) / 2))).flatMap(a => [
          <Text key={`ask:${a.id}`} wrap="truncate"><Text color={C.yellow}>{t.overview.askLine(a.fromName, a.question)}</Text></Text>,
          <Text key={`hint:${a.id}`} wrap="truncate" color={C.faint}>  {t.overview.askHint(a.id)}</Text>
        ]),
        ...near.slice(0, Math.max(0, yoursHeight - yours.length - Math.min(asks.length, Math.floor((yoursHeight - yours.length) / 2)) * 2)).map(s => (
          <Text key={`near:${s.id}`} wrap="truncate"><Text color={C.yellow}>{s.handover?.state === 'failed' ? g.fail : '◔'} </Text><Text color={C.fg}>{s.handover?.state === 'failed' ? t.overview.reliefFailed(s.name, s.handover.reason ?? '?') : t.overview.near(s.name, Math.round(((s.context?.used ?? 0) / (s.context?.window ?? 1)) * 100))}</Text></Text>
        ))
      ]}
    </TitledBox>
  );

  const treeBox = (
    <TitledBox title={t.home.projects} height={treeH + 2} flexShrink={0}>
      {tree.length === 0 ? <Text color={C.faint}>{t.overview.noSession}</Text> : windowed(keyed(tree), chosen, treeH).map(({ key, r }) => draw(r, key))}
    </TitledBox>
  );
  const rigsBox = (
    <TitledBox title={t.home.rigs} flexGrow={1} minHeight={rigsH + 2}>
      {!installed ? notInstalled.map(l => <Text key={l} color={C.faint} wrap="truncate">{l}</Text>) : windowed(keyed(rigRows), chosen, rigsH).map(({ key, r }) => draw(r, key))}
    </TitledBox>
  );
  return <Box flexDirection="column" width={width} flexShrink={0}>{ledgeBox}{yoursBox}{treeBox}{rigsBox}</Box>;
}
