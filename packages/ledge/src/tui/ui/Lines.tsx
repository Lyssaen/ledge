import { useEffect, useRef } from 'react';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import type { Line } from '../model/thread.js';

/** Lines in a box that grows: the ones that fit, `up` lines above the bottom; the box's height goes back through `onHeight`
 *  (what a page scrolls by). */
export function Lines({ lines, up = 0, onHeight }: { lines: readonly Line[]; up?: number; onHeight?: (h: number) => void }) {
  const ref = useRef<DOMElement>(null);
  const { height } = useBoxMetrics(ref);
  useEffect(() => { if (height > 0) onHeight?.(height); }, [height, onHeight]);
  const h = Math.max(1, height);
  const back = Math.min(up, Math.max(0, lines.length - h));
  const shown = lines.slice(Math.max(0, lines.length - h - back), lines.length - back);
  return (
    <Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden">
      {shown.map((l, i) => <Text key={i} wrap="truncate">{l.map((x, k) => <Text key={k} color={x.color} bold={x.bold}>{x.text || (k === 0 ? ' ' : '')}</Text>)}</Text>)}
    </Box>
  );
}
