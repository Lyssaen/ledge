import { Box, Text } from 'ink';
import { ALWAYS_USER, MANDATE_CATEGORY_LABEL, MandateCategorySchema, type LedgeDecision, type Rig } from '@ledge/protocol';
import { localDay, seatName } from '@ledge/ui/chat/ledge/threadModel';
import { rigColor } from '@ledge/ui/rigs/model';
import { useTui } from '../context.js';
import { wrapSegs } from '../model/cells.js';
import { C, projectColor } from '../theme.js';
import { Button } from './SessionCard.js';
import { TitledBox } from './TitledBox.js';

/** The rail's columns: the mockup's 34, less the one the left column took for its selection's bar, so that Ledge's conversation
 *  keeps the mockup's 80 at 160 columns. */
export const RAIL_W = 33;
/** A rig's bar, in cells. */
const BAR = 12;

/** The decisions Ledge took itself today (local day), oldest first. None when its brain sent none. */
export function settledToday(decisions: readonly LedgeDecision[] | undefined, now = new Date()): LedgeDecision[] {
  const today = localDay(now.toISOString());
  return (decisions ?? []).filter(x => x.by === 'ledge' && localDay(x.at) === today).sort((a, b) => a.at.localeCompare(b.at));
}

/** A rig's bar: as many of `BAR` cells filled as it has seats at work. */
export const barCells = (working: number, total: number): number => (total > 0 ? Math.round((working / total) * BAR) : 0);

/** What the rail and its folded line show: the rigs (their seats at work), the kernel's state, what Ledge settled today. */
export function useRail(): { rigs: { rig: Rig; working: number; total: number }[]; kernel: string | null; settled: LedgeDecision[] } {
  const { left, brain, t } = useTui();
  const rigs = left.flatMap(r => (r.kind === 'rig' ? [{ rig: r.rig, working: r.working, total: r.total }] : []));
  // The local machine's kernel first (the left column sorts them so).
  const k = left.find((r): r is Extract<typeof r, { kind: 'kernel' }> => r.kind === 'kernel');
  const kernel = !k ? null : k.state === 'running' ? (k.working ? t.home.kernelState.working : t.home.kernelState.idle) : t.home.kernelState[k.state];
  return { rigs, kernel, settled: settledToday(brain.decisions) };
}

/**
 * Ledge's rail (the mockup's `rail()`), on the right of the home from 140 columns: the rigs and their bars, what Ledge settled
 * today (hidden without), its mandate's categories, and « Résumer la journée ». « À toi » is never here: it is the left column's.
 */
export function LedgeRail({ width }: { width: number }) {
  const { t, g, lang, escalations } = useTui();
  const { rigs, kernel, settled } = useRail();
  const inner = width - 4;
  const label = (c: (typeof ALWAYS_USER)[number]) => MANDATE_CATEGORY_LABEL[c][lang].toLowerCase();
  const alone = MandateCategorySchema.options.filter(c => !ALWAYS_USER.includes(c)).map(label).join(', ');
  const always = ALWAYS_USER.map(label).join(', ');
  // Who asked, when the escalation is still known: « build merge, pas de rebase ».
  const who = (x: LedgeDecision) => { const e = escalations.find(e => e.id === x.escalationId); return e ? seatName(e.from) : null; };
  const nameW = Math.max(0, ...rigs.map(r => r.rig.name.length), kernel ? t.rail.kernel.length : 0) + 2;
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <TitledBox title={t.rail.rigs(rigs.length)} flexShrink={0}>
        {rigs.length === 0 ? <Text color={C.faint}>{t.rail.noRig}</Text> : rigs.map(({ rig, working, total }) => {
          const n = barCells(working, total);
          return (
            <Text key={`${rig.machine}/${rig.id}`} wrap="truncate">
              <Text color={projectColor(rigColor(rig))}>{g.rig} </Text><Text color={C.fg} bold>{rig.name.padEnd(nameW)}</Text>
              <Text color={C.dim}>{working}/{total} </Text><Text color={C.red}>{g.full.repeat(n)}</Text><Text color={C.line}>{g.empty.repeat(BAR - n)}</Text>
            </Text>
          );
        })}
        {kernel ? <Text wrap="truncate"><Text color={projectColor('slate')}>{g.kernel} </Text><Text color={C.fg} bold>{t.rail.kernel.padEnd(nameW)}</Text><Text color={C.faint}>{kernel}</Text></Text> : null}
        <Text color={C.faint} wrap="truncate">{t.rail.room}</Text>
      </TitledBox>
      {settled.length ? (
        <TitledBox title={t.rail.settled(settled.length)} flexShrink={0}>
          {settled.slice(-3).map(x => {
            const name = who(x);
            return <Text key={x.id} wrap="truncate"><Text color={C.green}>{g.ok} </Text>{name ? <Text color={C.fg} bold>{name} </Text> : null}<Text color={C.dim}>{x.summary}</Text></Text>;
          })}
          <Text> </Text>
          <Text color={C.faint} wrap="truncate">{t.rail.revisit}</Text>
        </TitledBox>
      ) : null}
      <TitledBox title={t.rail.mandate} flexShrink={0}>
        <Text color={C.dim} wrap="truncate">{t.rail.alone}</Text>
        {wrapSegs([{ text: alone }], inner - 2).map((l, i) => <Text key={i} color={C.fg} wrap="truncate">  {l.map(s => s.text).join('')}</Text>)}
        <Text color={C.dim} wrap="truncate">{t.rail.always}</Text>
        {wrapSegs([{ text: always }], inner - 2).map((l, i) => <Text key={i} color={C.yellow} wrap="truncate">  {l.map(s => s.text).join('')}</Text>)}
        <Text color={C.faint} wrap="truncate">{t.rail.more}</Text>
      </TitledBox>
      <Box paddingX={1}><Button label={t.rail.summary} k="R" /></Box>
    </Box>
  );
}

/** The rail folded into one line, at the head of Ledge's centre from 100 to 139 columns: « ] détail », kept at its right end
 *  whatever is cut before it, opens it whole. */
export function RailLine() {
  const { t, g } = useTui();
  const { rigs, kernel, settled } = useRail();
  return (
    <Box height={1} flexShrink={0} justifyContent="space-between">
      <Text wrap="truncate">
        {' '}
        {rigs.map(({ rig, working, total }) => (
          <Text key={`${rig.machine}/${rig.id}`}><Text color={projectColor(rigColor(rig))}>{g.rig} </Text><Text color={C.fg}>{rig.name} </Text><Text color={C.dim}>{working}/{total}  </Text></Text>
        ))}
        {kernel ? <Text><Text color={projectColor('slate')}>{g.kernel} </Text><Text color={C.fg}>{t.rail.kernel} </Text><Text color={C.faint}>{kernel}  </Text></Text> : null}
        {settled.length ? <Text><Text color={C.green}>{g.ok} </Text><Text color={C.dim}>{t.rail.folded(settled.length)}</Text></Text> : null}
      </Text>
      <Box flexShrink={0}><Text><Text color={C.fg}>  ]</Text><Text color={C.faint}> {t.rail.detail}</Text></Text></Box>
    </Box>
  );
}
