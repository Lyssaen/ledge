import { Box, Text } from 'ink';
import type { Rig } from '@ledge/protocol';
import { useTui } from '../context.js';
import { busyRemovals, chips, previewCommands, type Delegation, type Plan, type SeatRow } from '../model/rigSeats.js';
import { C } from '../theme.js';
import { TitledBox } from './TitledBox.js';

/**
 * « Sièges du rig » (docs/mockups/ledge-openrig.html, view 4, « Sièges (±) »): a role per line with its harness, its seats as
 * chips (added ones green, removed ones red and struck), its count; the delegation when seats are added; the commands it
 * runs; a seat removed while it works said in red.
 */
export function RigSeats({ rig, machine, rows, counts, at, delegation, plan, applying }: {
  rig: Rig; machine: string; rows: readonly SeatRow[]; counts: Record<string, number>; at: number; delegation: Delegation; plan: Plan; applying: boolean;
}) {
  const { t, g } = useTui();
  const s = t.rigSeats;
  const now = rows.map(r => `${r.seats.length} ${r.role}`).join(', ');
  const commands = previewCommands(rig.name, plan, delegation === 'pairs' ? s.linksPairs : s.linksAll);
  const busy = busyRemovals(rig, plan);
  return (
    <TitledBox title={s.title(rig.name, machine)} color={C.coral} titleColor={C.coral} titleBold flexGrow={1}>
      <Text wrap="truncate" color={C.dim}>{s.stays(now)}</Text>
      <Text> </Text>
      {rows.map((r, i) => {
        const on = i === at, n = counts[r.role] ?? r.seats.length;
        return (
          <Box key={r.role} flexShrink={0} backgroundColor={on ? C.sel : undefined}>
            <Text color={on ? C.coral : C.faint}>{on ? '▌' : ' '}</Text>
            <Box width={16} flexShrink={0}><Text wrap="truncate" color={C.fg} bold>{r.role}</Text></Box>
            <Box width={26} flexShrink={0}><Text wrap="truncate" color={C.dim}>{[r.first.runtime, r.first.model].filter(Boolean).join(' · ')}</Text></Box>
            <Box width={8} flexShrink={0}><Text><Text color={C.dim}>− </Text><Text color={n === r.seats.length ? C.fg : C.green} bold>{n}</Text><Text color={C.dim}> +</Text></Text></Box>
            <Box flexGrow={1} overflow="hidden">
              <Text wrap="truncate">{chips(r, plan).map(c => (
                <Text key={c.id} color={c.kind === 'added' ? C.green : c.kind === 'removed' ? C.red : C.dim} strikethrough={c.kind === 'removed'}>{c.kind === 'added' ? `+${c.id}` : c.id}{'  '}</Text>
              ))}</Text>
            </Box>
          </Box>
        );
      })}
      <Text> </Text>
      {plan.add.length ? (
        <Text wrap="truncate">
          {delegation === 'pairs' ? <Text color={C.fg} bold>{`${g.prev} ${s.pairs} ${g.next}`}</Text> : <Text color={C.dim}>{s.pairs}</Text>}{'   '}
          {delegation === 'all' ? <Text color={C.fg} bold>{`${g.prev} ${s.all} ${g.next}`}</Text> : <Text color={C.dim}>{s.all}</Text>}
        </Text>
      ) : null}
      {busy.map(id => <Text key={id} wrap="truncate" color={C.red}>{s.busy(id)}</Text>)}
      {commands.length ? <Box marginTop={1} flexDirection="column">{commands.map(c => <Text key={c} wrap="truncate" color={C.faint}>{c}</Text>)}</Box>
        : <Text color={C.faint}>{s.nothing}</Text>}
      {applying ? <Box marginTop={1}><Text color={C.blue}>{s.applying}</Text></Box> : null}
    </TitledBox>
  );
}
