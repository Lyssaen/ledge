import { useMemo } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { randomUUID } from 'node:crypto';
import { useState } from 'react';
import { isPending, useContextNear, useTasks, useTeams } from '@ledge/fleet';
import { LEDGE_GIVER, taskClosed, type Session, type Team } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { useScreenKeys, useTui } from '../context.js';
import { closedLedgeTasks, exchanges, helperCount, nearContext, nextWaiting, overview, step } from '../model/overview.js';
import { fit, machineLabel, paneName } from '../model/labels.js';
import { ago, clock, oneLine } from '../model/time.js';
import { C, projectColor, STATE_COLOR } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { SessionCard } from '../ui/SessionCard.js';
import { Tail } from '../ui/Tail.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Under this many columns the overview is one column: the session card opens with ↵. */
export const WIDE = 100;

type Row = { kind: 'project'; key: string; label: string; color: string; count: number }
  | { kind: 'common'; key: string }
  | { kind: 'team'; key: string; team: Team; done: number; given: number }
  | { kind: 'branch'; key: string; branch: string; indent: number } | { kind: 'session'; key: string; s: Session; indent: number };

/** The rows of the tree box that fit in `height`, scrolled so that the selected session shows. */
export function windowed<T extends { key: string }>(rows: readonly T[], selectedKey: string | null, height: number): T[] {
  if (rows.length <= height) return [...rows];
  const at = Math.max(0, rows.findIndex(r => r.key === selectedKey));
  const start = Math.min(Math.max(0, at - Math.floor(height / 2)), rows.length - height);
  return rows.slice(start, start + height);
}

export function Overview() {
  const tui = useTui();
  const { d, projects, t, g, now, selected, select, actions, go, attach } = tui;
  const { columns, rows: height } = useWindowSize();
  const wide = columns >= WIDE;
  // The left column: wide enough for a topic, never more than half the terminal.
  const left = wide ? Math.min(64, Math.max(44, Math.floor(columns * 0.42))) : columns;
  const teams = useTeams(tui.client);
  const tasks = useTasks(tui.client);
  const view = useMemo(() => overview(d.sessions, projects, teams ?? [], tasks), [d.sessions, projects, teams, tasks]);
  const sel = selected?.id ?? null;
  const closed = closedLedgeTasks(tasks);
  // Sessions near their context limit (context handover spec §3.2): H hands the selected one (else the first) over.
  const threshold = useContextNear(tui.client);
  const near = useMemo(() => nearContext(d.sessions, threshold), [d.sessions, threshold]);
  // The selected seat's team: its tasks box (t hides it), and the teams of its project for J and R.
  const [tasksShown, setTasksShown] = useState(true);
  const [joining, setJoining] = useState<{ index: number } | null>(null);
  const node = selected ? view.tree.find(n => n.branches.some(b => b.sessions.includes(selected)) || n.teams.some(x => x.sessions.includes(selected))) : undefined;
  const seatTeam = selected?.team ? teams?.find(x => x.id === selected.team && x.state !== 'dissolved') : undefined;
  const choices = node?.teams.map(x => x.team).filter(x => x.state !== 'dissolved' && x.id !== selected?.team) ?? [];

  useScreenKeys((input, key) => {
    // J: the selected session joins one of its project's teams, in its role, else the team's first free one.
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
        return true;
      }
      return true;
    }
    if (input === 'J' && selected) { if (choices.length) setJoining({ index: 0 }); else tui.toast({ text: t.overview.noTeamHere, tone: 'info' }); return true; }
    // R: resume a resting team, the selected seat's or the first of its project.
    if (input === 'R') {
      const resting = (seatTeam?.state === 'resting' ? seatTeam : undefined) ?? node?.teams.find(x => x.team.state === 'resting')?.team ?? view.tree.flatMap(n => n.teams).find(x => x.team.state === 'resting')?.team;
      if (resting) { tui.client.send({ type: 'team.resume', team: resting.id }); tui.toast({ text: t.toast.resumed(resting.name), tone: 'ok' }); }
      return true;
    }
    if (input === 'T') { setTasksShown(v => !v); return true; }
    if (input === 'H') {
      const s = (selected && selected.source === 'launcher' && selected.state !== 'exited' && selected.tool !== 'omp' && (!selected.handover || selected.handover.state === 'failed') ? selected : undefined) ?? near.find(x => x.handover?.state !== 'failed') ?? near[0];
      if (!s) return true;
      const rid = randomUUID();
      const off = tui.client.onMessage(m => { if (m.type === 'session.handover.result' && m.rid === rid) { off(); tui.toast(m.ok ? { text: t.toast.handover(s.name), tone: 'ok' } : { text: t.toast.handoverRefused(m.reason ?? '?'), tone: 'info' }); } });
      setTimeout(off, 5000);
      tui.client.send({ type: 'session.handover', rid, id: s.id });
      return true;
    }
    // x puts away the oldest closed task Ledge gave (« À toi »).
    if (input === 'x' && closed[0]) { tui.client.send({ type: 'task.cmd', rid: randomUUID(), by: LEDGE_GIVER, op: 'seen', task: closed[0].id }); return true; }
    if (input === 'j' || key.downArrow) { select(step(view.order, sel, 1)); return true; }
    if (input === 'k' || key.upArrow) { select(step(view.order, sel, -1)); return true; }
    if (key.tab) { const next = nextWaiting(view.yours, sel); if (next) select(next); return true; }
    if (key.return) { if (selected) go('session'); return true; }
    if (!selected) return false;
    if (input === 'a') { attach(selected); return true; }
    if (input === 'r' && selected.pending) { go('session'); return true; }
    // A digit answers the selected question; otherwise it switches screens (the App's keys).
    if (/^[1-9]$/.test(input) && selected.pending?.kind !== 'question') return false;
    if (input === 'y' || input === 'n' || input === 'A' || /^[1-9]$/.test(input)) return actions.key(selected, input);
    if (input === 'i' && selected.state === 'working') { actions.interrupt(selected); return true; }
    return false;
  });

  const tree: Row[] = view.tree.flatMap(n => {
    // With teams (roles spec §3.9): ▭ the common table, then ▣ each team with its seats; without, as before.
    const teamed = n.teams.length > 0;
    const common = n.branches.length > 0;
    return [
      { kind: 'project' as const, key: n.key, label: n.label, color: projectColor(n.color), count: n.count },
      ...(teamed && common ? [{ kind: 'common' as const, key: `${n.key}|common` }] : []),
      ...n.branches.flatMap(b => [{ kind: 'branch' as const, key: `${n.key}|${b.branch}`, branch: b.branch, indent: teamed ? 4 : 2 }, ...b.sessions.map(s => ({ kind: 'session' as const, key: s.id, s, indent: teamed ? 2 : 0 }))]),
      ...n.teams.flatMap(x => [{ kind: 'team' as const, key: x.key, team: x.team, done: x.done, given: x.given }, ...x.sessions.map(s => ({ kind: 'session' as const, key: s.id, s, indent: 2 }))])
    ];
  });
  const yoursCount = view.yours.length + closed.length + near.length;
  const yoursHeight = Math.max(1, Math.min(yoursCount, 6));
  // The status bar, the key bar, the toast, the boxes' borders and titles.
  const joinHeight = joining && selected ? Math.max(1, choices.length) + 2 : 0;
  const treeHeight = Math.max(3, height - 3 - (yoursHeight + 2) - joinHeight - 3);
  // Inside the box (borders and padding: 4): a row's fixed parts, then what is left for its text.
  const inner = left - 4, nameW = 7;
  const stateW = Math.max(...Object.values(t.state).map(x => x.length)) + 1;
  const topicW = Math.max(6, inner - 6 - nameW - stateW - 3);
  const askW = Math.max(6, inner - 2 - nameW - 9 - 7);

  const yoursBox = (
    <TitledBox title={t.overview.yours(yoursCount)} color={yoursCount ? C.red : C.line} titleColor={yoursCount ? C.red : C.dim} height={yoursHeight + 2}>
      {yoursCount === 0 ? <Text color={C.faint}>{t.overview.nobodyWaits}</Text> : [...view.yours.slice(0, yoursHeight).map(s => {
        const st = botState(s);
        return (
          <Text key={s.id} wrap="truncate" backgroundColor={s.id === sel ? C.sel : undefined}>
            <Text color={STATE_COLOR[st]}>{g[st]} </Text><Text color={C.fg} bold>{fit(s.name, nameW)}</Text>
            <Text color={C.dim}>{fit(s.repo ?? s.project, 9)}</Text><Text color={STATE_COLOR[st]}>{fit(oneLine(s.pending?.text ?? ''), askW)}</Text>
            <Text color={C.faint}> {ago(s.lastActivityAt, now, t.time)}</Text>
          </Text>
        );
      }), ...closed.slice(0, Math.max(0, yoursHeight - view.yours.length)).map(x => (
        <Text key={x.id} wrap="truncate"><Text color={x.state === 'done' ? C.green : C.yellow}>{x.state === 'done' ? g.ok : g.fail} </Text><Text color={C.fg}>{t.overview.ledgeTask(x.ownerName, x.title, x.state as 'done' | 'refused' | 'dropped')}</Text></Text>
      )), ...near.slice(0, Math.max(0, yoursHeight - view.yours.length - closed.length)).map(s => (
        <Text key={`near:${s.id}`} wrap="truncate" backgroundColor={s.id === sel ? C.sel : undefined}><Text color={C.yellow}>{s.handover?.state === 'failed' ? g.fail : '◔'} </Text><Text color={C.fg}>{s.handover?.state === 'failed' ? t.overview.reliefFailed(s.name, s.handover.reason ?? '?') : t.overview.near(`${s.name}${s.role ? ` @${s.role}` : ''}`, Math.round(((s.context?.used ?? 0) / (s.context?.window ?? 1)) * 100))}</Text></Text>
      ))]}
    </TitledBox>
  );
  const treeBox = (
    <TitledBox title={t.overview.projects} flexGrow={1}>
      {tree.length === 0 ? <Text color={C.faint}>{t.overview.noSession}</Text> : windowed(tree, sel, treeHeight).map(r => r.kind === 'project'
        ? <Text key={r.key} wrap="truncate"><Text color={r.color}>{g.project}</Text> <Text color={C.fg} bold>{r.label}</Text> <Text color={C.faint}>{t.overview.sessions(r.count)}</Text></Text>
        : r.kind === 'common'
          ? <Text key={r.key} wrap="truncate" color={C.faint}>  {g.common} {t.overview.common}</Text>
        : r.kind === 'team'
          ? <Text key={r.key} wrap="truncate"><Text>  </Text><Text color={C.coral}>{g.team}</Text> <Text color={r.team.state === 'resting' ? C.dim : C.fg} bold>{r.team.name}</Text> <Text color={C.faint}>{r.team.state === 'resting' ? t.overview.resting : t.overview.teamLine(r.done, r.given)}</Text></Text>
        : r.kind === 'branch'
          ? <Text key={r.key} wrap="truncate" color={C.faint}>{' '.repeat(r.indent)}{g.branch} {r.branch}</Text>
          : <SessionRow key={r.key} s={r.s} on={r.s.id === sel} nameW={nameW} topicW={Math.max(6, topicW - r.indent - (r.s.role ? r.s.role.length + 2 : 0))} stateW={stateW} indent={r.indent} />)}
    </TitledBox>
  );

  const keys: Array<readonly [string, string]> = [
    ['j k', t.keys.navigate], ['↵', t.keys.open], ...(view.yours.length ? [['tab', t.keys.next] as const, ['y n', t.keys.answer] as const] : []),
    ['a', t.keys.attach], ...(seatTeam ? [['T', t.keys.tasks] as const] : []), ...(choices.length ? [['J', t.keys.join] as const] : []),
    ...(view.tree.some(n => n.teams.some(x => x.team.state === 'resting')) ? [['R', t.keys.resume] as const] : []),
    ...(near.length ? [['H', t.keys.handover] as const] : []),
    ['/', t.keys.ask], ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]
  ];
  const teamTasks = seatTeam ? tasks.filter(x => x.team === seatTeam.id && (!taskClosed(x) || x.updatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10))).slice(-4) : [];
  return (
    <Frame crumb={tui.machines.map(m => `${m.label} ${m.ready ? g.machine : '○'}`).join('  ')} keys={keys}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width={left} flexShrink={0}>{yoursBox}{joining && selected ? (
          <TitledBox title={t.overview.joinWhich(selected.name)} color={C.coral} titleColor={C.coral} height={joinHeight}>
            {choices.map((x, i) => <Text key={x.id} wrap="truncate" backgroundColor={i === joining.index ? C.sel : undefined}><Text color={C.coral}>{g.team}</Text> {x.name}</Text>)}
          </TitledBox>
        ) : null}{treeBox}</Box>
        {wide ? (
          <Box flexDirection="column" flexGrow={1}>
            {selected ? (
              <>
                <TitledBox title={`${selected.name} · ${oneLine(selected.topic ?? selected.title)}`} color={isPending(selected) ? C.red : C.line} titleColor={isPending(selected) ? C.red : C.dim}>
                  <SessionCard s={selected} note />
                </TitledBox>
                {seatTeam && tasksShown ? (
                  <TitledBox title={t.overview.tasks(`${g.team} ${seatTeam.name}`)} height={Math.max(3, teamTasks.length + 2)}>
                    {teamTasks.length === 0 ? <Text color={C.faint}>{t.overview.noTask}</Text> : teamTasks.map(x => (
                      <Text key={x.id} wrap="truncate"><Text color={C.faint}>{x.id}</Text> <Text color={C.fg}>{x.title}</Text> <Text color={C.dim}>{x.giverName} {g.arrow} {x.ownerName}</Text> <Text color={x.state === 'done' ? C.green : x.state === 'taken' ? C.blue : C.faint}>{t.ask.taskState[x.state]}</Text></Text>
                    ))}
                  </TitledBox>
                ) : null}
                <TitledBox title={t.overview.terminal(paneName(selected))} flexGrow={1}>
                  <Tail lines={d.previews.get(selected.id) ?? []} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
                </TitledBox>
              </>
            ) : <TitledBox title={t.tabs.session} flexGrow={1}><Text color={C.faint}>{t.session.noSession}</Text></TitledBox>}
            <TitledBox title={t.overview.exchanges} height={5}>
              {(() => {
                const list = exchanges(d.sessions, 3, tasks, t.overview.ledge);
                return list.length === 0 ? <Text color={C.faint}>{t.overview.noExchange}</Text> : list.map((x, i) => (
                  <Text key={i} wrap="truncate"><Text color={C.faint}>{clock(x.at)}</Text> <Text color={C.fg}>{x.from}</Text> <Text color={x.kind === 'task' ? C.green : C.violet}>{g.arrow}</Text> <Text color={C.fg}>{x.to}</Text>  {x.kind === 'task' ? <Text color={C.green}>{g.task} </Text> : null}<Text color={C.dim}>{oneLine(x.summary)}</Text></Text>
                ));
              })()}
            </TitledBox>
          </Box>
        ) : null}
      </Box>
    </Frame>
  );
}

function SessionRow({ s, on, nameW, topicW, stateW, indent = 0 }: { s: Session; on: boolean; nameW: number; topicW: number; stateW: number; indent?: number }) {
  const { t, g } = useTui();
  const st = botState(s);
  const n = helperCount(s);
  return (
    <Text wrap="truncate" backgroundColor={on ? C.sel : undefined}>
      <Text color={on ? C.coral : C.faint}>{on ? '▌' : ' '}</Text>
      <Text>{' '.repeat(2 + indent)}</Text>
      <Text color={s.offline ? C.faint : STATE_COLOR[st]}>{g[st]} </Text>
      <Text color={s.offline ? C.dim : C.fg} bold>{fit(s.name, nameW)}</Text>
      {s.role ? <Text color={C.violet}>@{s.role} </Text> : null}
      <Text color={C.dim}>{fit(oneLine(s.topic ?? s.title), topicW)} </Text>
      <Text color={s.offline ? C.faint : STATE_COLOR[st]}>{fit(s.offline ? t.overview.offline : t.state[st], stateW).trimEnd()}</Text>
      {n > 0 ? <Text color={C.violet}> +{n}</Text> : null}
      {s.machineName && s.machineId !== 'local' ? <Text color={C.faint}> · {machineLabel(s)}</Text> : null}
    </Text>
  );
}
