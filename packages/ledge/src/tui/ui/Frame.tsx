import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import { isPending, useMobile, useTasks } from '@ledge/fleet';
import { useScreenSize, useTui } from '../context.js';
import { cells } from '../model/cells.js';
import { C } from '../theme.js';
import { fitKeys, KeyBar } from './KeyBar.js';
import { UsageLine } from './UsageLine.js';
import { listed, openDecisions } from '../model/overview.js';
import { waitingPairings } from '../model/mobile.js';
import { PairingAlert } from './PairingAlert.js';
import { PairingDialog } from './PairingDialog.js';

/** The smallest terminal the screens are drawn in; below, the frame says so (the screen keeps its state). */
export const MIN = { columns: 60, rows: 16 } as const;

/** One screen: the status bar, the screen's body, the last toast and the screen's keys, the whole terminal high. The crumb
 *  shortens to `crumbShort` when it does not fit, then goes; `kept` says a draft waits in the screen. */
export function Frame({ crumb, crumbShort, keys, kept, noHelp, children }: {
  crumb: string; crumbShort?: string; keys: ReadonlyArray<readonly [string, string]>; kept?: boolean; /** The bar leaves « ? aide » out (the key still works), so a screen's own keys all fit at 72 columns. */ noHelp?: boolean; children: ReactNode;
}) {
  const { d, machines, t, g, lastToast, editing, client, screen } = useTui();
  const linking = waitingPairings(useMobile(client)).length;
  const { rows, columns } = useScreenSize();
  const live = listed(d.sessions);
  const pending = live.filter(isPending);
  // Who waits: the sessions' requests and the decisions they put to the user.
  const waiting = pending.length + openDecisions(useTasks(client)).length;
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
    + (waiting > 0 ? cells(` · ${t.bar.waiting(waiting)}`) : 0) + (linking > 0 ? cells(` · ${g.phone} ${linking}`) : 0) + (status ? cells(`  ${status}`) : 0);
  const room = columns - left - 2;
  const shown = cells(crumb) <= room ? crumb : crumbShort && cells(crumbShort) <= room ? crumbShort : '';
  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Box paddingX={1} justifyContent="space-between" height={1} backgroundColor={C.bar}>
        <Text wrap="truncate">
          <Text color={C.coral}>{g.logo} ledge</Text>
          <Text color={C.dim}>  {t.bar.sessions(live.length)} · {t.bar.machines(Math.max(1, machines.length))}</Text>
          {waiting > 0 ? <Text color={C.red}> · {t.bar.waiting(waiting)}</Text> : null}
          {linking > 0 ? <Text color={C.yellow} bold> · {g.phone} {linking}</Text> : null}
          {status ? <Text color={C.yellow}>  {status}</Text> : null}
        </Text>
        {shown ? <Text wrap="truncate" color={C.dim}>{shown}</Text> : null}
      </Box>
      {screen === 'mobile' ? null : <PairingAlert />}
      <Box flexGrow={1} flexDirection="column" overflow="hidden">{children}<PairingDialog /></Box>
      {lastToast ? <Box paddingX={1} height={1}><Text wrap="truncate" color={lastToast.tone === 'error' ? C.red : lastToast.tone === 'ok' ? C.green : lastToast.tone === 'quiet' ? C.dim : C.yellow}>{lastToast.text}</Text></Box> : null}
      <UsageLine columns={columns} />
      <KeyBar keys={fitKeys(linking > 0 && screen !== 'mobile' && !keys.some(k => k[0] === 'L') ? [...keys.slice(0, 2), ['L', t.mobile.keys.pair], ...keys.slice(2)] : keys, columns, editing || noHelp ? null : ['?', t.keys.help])} />
    </Box>
  );
}
