import { Box, Text } from 'ink';
import { C } from '../theme.js';

/** The keys of the screen, on one line at the bottom: `key label`. */
export function KeyBar({ keys }: { keys: ReadonlyArray<readonly [string, string]> }) {
  return (
    <Box paddingX={1} columnGap={2} flexWrap="wrap" height={1} overflow="hidden">
      {keys.map(([k, label]) => (
        <Text key={k} wrap="truncate"><Text color={C.fg} backgroundColor="#2c2926"> {k} </Text><Text color={C.dim}> {label}</Text></Text>
      ))}
    </Box>
  );
}
