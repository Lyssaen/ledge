import type { ReactNode } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { isPending } from '@ledge/fleet';
import { useTui } from '../context.js';
import { cells } from '../model/cells.js';
import { C } from '../theme.js';
import { fitKeys, KeyBar } from './KeyBar.js';
import { listed } from '../model/overview.js';

/** The smallest terminal the screens are drawn in; below, the frame says so (the screen keeps its state). */
export const MIN = { columns: 60, rows: 16 } as const;

/** One screen: the status bar, the screen's body, the last toast and the screen's keys, the whole terminal high. The crumb
 *  shortens to `crumbShort` when it does not fit, then goes; `kept` says a draft waits in the screen. */
export function Frame({ crumb, crumbShort, keys, kept, children }: {
  crumb: string; crumbShort?: string; keys: ReadonlyArray<readonly [string, string]>; kept?: boolean; children: ReactNode;
}) {
  const { d, machines, t, g, lastToast, editing } = useTui();
  const { rows, columns } = useWindowSize();
  const live = listed(d.sessions);
  const pending = live.filter(isPending);
  const waiting = pending.length;
  const status = d.status === 'open' ? null : d.status === 'connecting' ? t.bar.connecting : t.bar.unreachable;

  if (columns < MIN.columns || rows < MIN.rows) {
    const why = [...(pending[0] ? [t.small.waits(pending[0].name, pending[0].pending?.kind === 'question')] : []), ...(kept ? [t.small.kept] : [])].join(' · ');
    return (
      <Box flexDirection="column" height={rows} width={columns} alignItems="center" justifyContent="center">
        <Text color={C.coral} bold>{g.logo} ledge</Text>
        <Text color={C.fg}>{t.small.tooSmall(columns, rows)}</Text>
        <Text color={C.dim}>{t.small.atLeast(MIN.columns, MIN.rows)}</Text>
        {why ? <Box marginTop={1}><Text color={C.red}>{why}</Text></Box> : null}
      </Box>
    );
  }

  const left = cells(` ${g.logo} ledge  ${t.bar.sessions(live.length)} · ${t.bar.machines(Math.max(1, machines.length))}`)
    + (waiting > 0 ? cells(` · ${t.bar.waiting(waiting)}`) : 0) + (status ? cells(`  ${status}`) : 0);
  const room = columns - left - 2;
  const shown = cells(crumb) <= room ? crumb : crumbShort && cells(crumbShort) <= room ? crumbShort : '';
  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Box paddingX={1} justifyContent="space-between" height={1} backgroundColor={C.bar}>
        <Text wrap="truncate">
          <Text color={C.coral}>{g.logo} ledge</Text>
          <Text color={C.dim}>  {t.bar.sessions(live.length)} · {t.bar.machines(Math.max(1, machines.length))}</Text>
          {waiting > 0 ? <Text color={C.red}> · {t.bar.waiting(waiting)}</Text> : null}
          {status ? <Text color={C.yellow}>  {status}</Text> : null}
        </Text>
        {shown ? <Text wrap="truncate" color={C.dim}>{shown}</Text> : null}
      </Box>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">{children}</Box>
      {lastToast ? <Box paddingX={1} height={1}><Text wrap="truncate" color={lastToast.tone === 'error' ? C.red : lastToast.tone === 'ok' ? C.green : lastToast.tone === 'quiet' ? C.dim : C.yellow}>{lastToast.text}</Text></Box> : null}
      <KeyBar keys={fitKeys(keys, columns, editing ? null : ['?', t.keys.help])} />
    </Box>
  );
}
