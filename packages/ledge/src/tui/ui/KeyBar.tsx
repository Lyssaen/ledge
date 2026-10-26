import { Box, Text } from 'ink';
import { cells } from '../model/cells.js';
import { C } from '../theme.js';

type Key = readonly [string, string];
const itemCells = ([k, label]: Key) => cells(` ${k} `) + cells(` ${label}`);

/** The keys that fit in `width` cells: the last ones go first, `help` always stays (at the end). */
export function fitKeys(keys: readonly Key[], width: number, help: Key | null): Key[] {
  const list = keys.filter(k => k[0] !== help?.[0]);
  const fits = (l: readonly Key[]) => 1 + l.reduce((n, x, i) => n + itemCells(x) + (i ? 2 : 0), 0) <= width - 1;
  const tail = help ? [help] : [];
  while (list.length && !fits([...list, ...tail])) list.pop();
  return [...list, ...tail];
}

/** The keys of the screen, on one line at the bottom: `key label`. */
export function KeyBar({ keys }: { keys: readonly Key[] }) {
  return (
    <Box paddingX={1} columnGap={2} height={1} overflow="hidden">
      {keys.map(([k, label]) => (
        <Box key={k} flexShrink={0}><Text wrap="truncate"><Text color={C.fg} backgroundColor="#2c2926"> {k} </Text><Text color={C.dim}> {label}</Text></Text></Box>
      ))}
    </Box>
  );
}
