import { memo, useEffect, useRef } from 'react';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import type { Line, Seg } from '../model/cells.js';
import { spin } from '../model/thread.js';
import { took } from '../model/time.js';
import { useI18n } from '../i18n/lang.js';
import { useNow } from './now.js';

/** A piece the clock changes (a spinner, a running time): the only thing drawn again each second. */
function Live({ seg }: { seg: Seg & { live: NonNullable<Seg['live']> } }) {
  const now = useNow();
  const { t } = useI18n();
  const l = seg.live;
  return <Text color={seg.color} bold={seg.bold}>{'spin' in l ? spin(now) : took(Math.max(0, now - l.since), t.time.decimal).padStart(l.pad)}</Text>;
}

/** One line, its pieces in their colours, cut at the box's edge. */
export const LineText = memo(function LineText({ line }: { line: Line }) {
  return <Text wrap="truncate">{line.map((x, k) => x.live ? <Live key={k} seg={x as Seg & { live: NonNullable<Seg['live']> }} />
    : <Text key={k} color={x.color} bold={x.bold}>{x.text || (k === 0 ? ' ' : '')}</Text>)}{line.length === 0 ? ' ' : null}</Text>;
});

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
      {/* A row never shrinks: one too many is clipped at the bottom, never drawn over the one above. */}
      {shown.map((l, i) => <Box key={i} flexShrink={0}><LineText line={l} /></Box>)}
    </Box>
  );
}
