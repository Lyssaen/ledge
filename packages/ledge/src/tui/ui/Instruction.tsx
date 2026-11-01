import { useMemo, useRef } from 'react';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import { useTui } from '../context.js';
import { markdownLines } from '../model/markdown.js';
import { C } from '../theme.js';
import { LineText } from './Lines.js';

/** A role's instruction, its Markdown drawn as the thread draws it (#95), folded to the box's width; what does not fit is
 *  cut at the bottom. */
export function Instruction({ text, empty }: { text: string; empty: string }) {
  const { g, tone } = useTui();
  const ref = useRef<DOMElement>(null);
  const { width, height } = useBoxMetrics(ref);
  // The lines keep their colours: drawn again at another width or tone.
  const lines = useMemo(() => (width > 0 ? markdownLines(text, { width, g, color: C.fg }) : []), [text, width, g, tone]);
  return (
    <Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden">
      {!text.trim() ? <Text color={C.faint}>{empty}</Text>
        : lines.slice(0, Math.max(1, height)).map((l, i) => <Box key={i} flexShrink={0}><LineText line={l} /></Box>)}
    </Box>
  );
}
