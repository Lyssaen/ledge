import { useRef } from 'react';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';

/** The last lines that fit in the box's height (a terminal's bottom is what matters). */
export function Tail({ lines, color, empty, emptyColor }: { lines: readonly string[]; color: string; empty: string; emptyColor: string }) {
  const ref = useRef<DOMElement>(null);
  const { height } = useBoxMetrics(ref);
  // A pane's empty bottom rows are not its end.
  let end = lines.length;
  while (end > 0 && !lines[end - 1]!.trim()) end--;
  const shown = end === 0 ? [] : lines.slice(0, end).slice(-Math.max(1, height));
  return (
    <Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden">
      {shown.length === 0 ? <Text color={emptyColor}>{empty}</Text> : shown.map((l, i) => <Text key={i} color={color} wrap="truncate">{l || ' '}</Text>)}
    </Box>
  );
}
