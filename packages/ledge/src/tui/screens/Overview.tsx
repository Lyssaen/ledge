import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { randomUUID } from 'node:crypto';
import { isPending, useAsks, useContextNear } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { useScreenKeys, useScreenSize, useTui } from '../context.js';
import { exchanges, helperCount, nearContext, nextWaiting, overview, step } from '../model/overview.js';
import { fit, machineLabel, paneName } from '../model/labels.js';
import { clock, oneLine } from '../model/time.js';
import { Ago } from '../ui/Ago.js';
import { C, projectColor, STATE_COLOR } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { SessionCard } from '../ui/SessionCard.js';
import { Tail } from '../ui/Tail.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Under this many columns the overview is one column: the session card opens with ↵. */
export const WIDE = 100;

type Row = { kind: 'project'; key: string; label: string; color: string; count: number }
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
  const { d, projects, t, g, selected, select, actions, go, attach } = tui;
  const { columns, rows: height } = useScreenSize();
  const wide = columns >= WIDE;
  // The left column: wide enough for a topic, never more than half the terminal.
  const left = wide ? Math.min(64, Math.max(44, Math.floor(columns * 0.42))) : columns;
  const asks = useAsks(tui.client);
  const view = useMemo(() => overview(d.sessions, projects, asks), [d.sessions, projects, asks]);
  const sel = selected?.id ?? null;
  // Sessions near their context limit (context handover spec §3.2): H hands the selected one (else the first) over.
  const threshold = useContextNear(tui.client);
  const near = useMemo(() => nearContext(d.sessions, threshold), [d.sessions, threshold]);
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

  const tree: Row[] = view.tree.flatMap(n => [
    { kind: 'project' as const, key: n.key, label: n.label, color: projectColor(n.color), count: n.count },
    ...n.branches.flatMap(b => [{ kind: 'branch' as const, key: `${n.key}|${b.branch}`, branch: b.branch, indent: 2 }, ...b.sessions.map(s => ({ kind: 'session' as const, key: s.id, s, indent: 0 }))])
  ]);
  const yoursCount = view.yours.length + view.asks.length + near.length;
  // An ask takes two rows: the question, then how to answer it.
  const yoursHeight = Math.max(1, Math.min(view.yours.length + view.asks.length * 2 + near.length, 6));
  // The status bar, the key bar, the toast, the boxes' borders and titles.
  const treeHeight = Math.max(3, height - 3 - (yoursHeight + 2) - 3);
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
            <Text color={C.faint}> <Ago iso={s.lastActivityAt} /></Text>
          </Text>
        );
      }), ...view.asks.slice(0, Math.max(0, Math.floor((yoursHeight - view.yours.length) / 2))).flatMap(a => [
        <Text key={`ask:${a.id}`} wrap="truncate"><Text color={C.yellow}>{t.overview.askLine(a.fromName, a.question)}</Text></Text>,
        <Text key={`hint:${a.id}`} wrap="truncate" color={C.faint}>  {t.overview.askHint(a.id)}</Text>
      ]), ...near.slice(0, Math.max(0, yoursHeight - view.yours.length - Math.min(view.asks.length, Math.floor((yoursHeight - view.yours.length) / 2)) * 2)).map(s => (
        <Text key={`near:${s.id}`} wrap="truncate" backgroundColor={s.id === sel ? C.sel : undefined}><Text color={C.yellow}>{s.handover?.state === 'failed' ? g.fail : '◔'} </Text><Text color={C.fg}>{s.handover?.state === 'failed' ? t.overview.reliefFailed(s.name, s.handover.reason ?? '?') : t.overview.near(s.name, Math.round(((s.context?.used ?? 0) / (s.context?.window ?? 1)) * 100))}</Text></Text>
      ))]}
    </TitledBox>
  );
  const treeBox = (
    <TitledBox title={t.overview.projects} flexGrow={1}>
      {tree.length === 0 ? <Text color={C.faint}>{t.overview.noSession}</Text> : windowed(tree, sel, treeHeight).map(r => r.kind === 'project'
        ? <Text key={r.key} wrap="truncate"><Text color={r.color}>{g.project}</Text> <Text color={C.fg} bold>{r.label}</Text> <Text color={C.faint}>{t.overview.sessions(r.count)}</Text></Text>
        : r.kind === 'branch'
          ? <Text key={r.key} wrap="truncate" color={C.faint}>{' '.repeat(r.indent)}{g.branch} {r.branch}</Text>
          : <SessionRow key={r.key} s={r.s} on={r.s.id === sel} nameW={nameW} topicW={Math.max(6, topicW - r.indent)} stateW={stateW} indent={r.indent} />)}
    </TitledBox>
  );

  const keys: Array<readonly [string, string]> = [
    ['j k', t.keys.navigate], ['↵', t.keys.open], ...(view.yours.length ? [['tab', t.keys.next] as const, ['y n', t.keys.answer] as const] : []),
    ['a', t.keys.attach], ...(near.length ? [['H', t.keys.handover] as const] : []),
    ['/', t.keys.ask], ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]
  ];
  return (
    <Frame crumb={tui.machines.map(m => `${m.label} ${m.ready ? g.machine : '○'}`).join('  ')} keys={keys}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width={left} flexShrink={0}>{yoursBox}{treeBox}</Box>
        {wide ? (
          <Box flexDirection="column" flexGrow={1}>
            {selected ? (
              <>
                <TitledBox title={`${selected.name} · ${oneLine(selected.topic ?? selected.title)}`} color={isPending(selected) ? C.red : C.line} titleColor={isPending(selected) ? C.red : C.dim}>
                  <SessionCard s={selected} note />
                </TitledBox>
                <TitledBox title={t.overview.terminal(paneName(selected))} flexGrow={1}>
                  <Tail lines={d.previews.get(selected.id) ?? []} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
                </TitledBox>
              </>
            ) : <TitledBox title={t.tabs.session} flexGrow={1}><Text color={C.faint}>{t.session.noSession}</Text></TitledBox>}
            <TitledBox title={t.overview.exchanges} height={5}>
              {(() => {
                const list = exchanges(d.sessions, 3);
                return list.length === 0 ? <Text color={C.faint}>{t.overview.noExchange}</Text> : list.map((x, i) => (
                  <Text key={i} wrap="truncate"><Text color={C.faint}>{clock(x.at)}</Text> <Text color={C.fg}>{x.from}</Text> <Text color={C.violet}>{g.arrow}</Text> <Text color={C.fg}>{x.to}</Text>  <Text color={C.dim}>{oneLine(x.summary)}</Text></Text>
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
      <Text color={C.dim}>{fit(oneLine(s.topic ?? s.title), topicW)} </Text>
      <Text color={s.offline ? C.faint : STATE_COLOR[st]}>{fit(s.offline ? t.overview.offline : t.state[st], stateW).trimEnd()}</Text>
      {n > 0 ? <Text color={C.violet}> +{n}</Text> : null}
      {s.machineName && s.machineId !== 'local' ? <Text color={C.faint}> · {machineLabel(s)}</Text> : null}
    </Text>
  );
}
