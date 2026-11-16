import { Box, Text } from 'ink';
import { useMobile } from '@ledge/fleet';
import { useTui } from '../context.js';
import { waitingPairings } from '../model/mobile.js';
import { C } from '../theme.js';

/** The line under the status bar that says a device asks to link, with the key that opens its comparison. */
export function PairingAlert() {
  const { client, t } = useTui();
  const first = waitingPairings(useMobile(client))[0];
  if (!first) return null;
  return (
    <Box paddingX={0} height={1} backgroundColor={C.sel} justifyContent="space-between" overflow="hidden">
      <Text wrap="truncate"><Text color={C.yellow}> ● </Text><Text color={C.fg}>{t.mobile.alert(first.label)}</Text></Text>
      <Box flexShrink={0}><Text color={C.fg} backgroundColor={C.key}> L </Text><Text color={C.fg}> {t.mobile.alertCompare} </Text></Box>
    </Box>
  );
}
