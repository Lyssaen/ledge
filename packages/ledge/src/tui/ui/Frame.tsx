import type { ReactNode } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { isPending } from '@ledge/fleet';
import { useTui } from '../context.js';
import { C } from '../theme.js';
import { KeyBar } from './KeyBar.js';
import { listed } from '../model/overview.js';

/** One screen: the status bar, the screen's body, the last toast and the screen's keys, the whole terminal high. */
export function Frame({ crumb, keys, children }: { crumb: ReactNode; keys: ReadonlyArray<readonly [string, string]>; children: ReactNode }) {
  const { d, machines, t, g, lastToast } = useTui();
  const { rows, columns } = useWindowSize();
  const live = listed(d.sessions);
  const waiting = live.filter(isPending).length;
  const status = d.status === 'open' ? null : d.status === 'connecting' ? t.bar.connecting : t.bar.unreachable;
  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Box paddingX={1} justifyContent="space-between" height={1} backgroundColor="#1f1d1b">
        <Text wrap="truncate">
          <Text color={C.coral}>{g.logo} ledge</Text>
          <Text color={C.dim}>  {t.bar.sessions(live.length)} · {t.bar.machines(Math.max(1, machines.length))}</Text>
          {waiting > 0 ? <Text color={C.red}> · {t.bar.waiting(waiting)}</Text> : null}
          {status ? <Text color={C.yellow}>  {status}</Text> : null}
        </Text>
        <Text wrap="truncate" color={C.dim}>{crumb}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">{children}</Box>
      {lastToast ? <Box paddingX={1} height={1}><Text wrap="truncate" color={lastToast.tone === 'error' ? C.red : lastToast.tone === 'ok' ? C.green : C.yellow}>{lastToast.text}</Text></Box> : null}
      <KeyBar keys={keys} />
    </Box>
  );
}
