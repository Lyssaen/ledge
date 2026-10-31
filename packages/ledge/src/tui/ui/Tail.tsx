import { useRef } from 'react';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import { cutAnsi, sgrOnly } from '../model/ansi.js';

/** The last lines that fit in the box's height (a terminal's bottom is what matters). `ansi`: the lines carry their own colours (SGR),
 *  kept as they are, each cut to the width and closed with a reset. */
export function Tail({ lines, color, empty, emptyColor, ansi }: { lines: readonly string[]; color: string; empty: string; emptyColor: string; ansi?: boolean }) {
  const ref = useRef<DOMElement>(null);
  const { height, width } = useBoxMetrics(ref);
  // A pane's empty bottom rows are not its end.
  let end = lines.length;
  const blank = (l: string) => !(ansi ? sgrOnly(l).replace(/\x1b\[[0-9;:]*m/g, '') : l).trim();
  while (end > 0 && blank(lines[end - 1]!)) end--;
  const shown = end === 0 ? [] : lines.slice(0, end).slice(-Math.max(1, height));
  return (
    <Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden">
      {shown.length === 0 ? <Text color={emptyColor}>{empty}</Text> : shown.map((l, i) => (ansi
        ? <Text key={i} wrap="truncate">{blank(l) ? ' ' : cutAnsi(sgrOnly(l), Math.max(1, width))}</Text>
        : <Text key={i} color={color} wrap="truncate">{l || ' '}</Text>))}
    </Box>
  );
}
