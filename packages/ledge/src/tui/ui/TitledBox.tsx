import { useRef, type ReactNode } from 'react';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import { C } from '../theme.js';

/** A rounded box with its title in the top border, as the mockup draws them (Ink's borders take no title). */
export function TitledBox({ title, color = C.line, titleColor = C.dim, children, flexGrow, height, width, flexShrink }: {
  title: string; color?: string; titleColor?: string; children?: ReactNode; flexGrow?: number; flexShrink?: number; height?: number | string; width?: number | string;
}) {
  const ref = useRef<DOMElement>(null);
  const { width: w } = useBoxMetrics(ref);
  const label = ` ${title.toUpperCase()} `;
  const room = Math.max(0, w - 3);
  const shown = [...label].length > room ? `${[...label].slice(0, Math.max(0, room - 2)).join('')}… ` : label;
  const rest = Math.max(0, w - 3 - [...shown].length);
  return (
    <Box ref={ref} flexDirection="column" flexGrow={flexGrow} flexShrink={flexShrink} height={height} width={width} overflow="hidden">
      <Text wrap="truncate"><Text color={color}>╭─</Text><Text color={titleColor}>{w > 0 ? shown : ''}</Text><Text color={color}>{'─'.repeat(rest)}╮</Text></Text>
      <Box flexDirection="column" borderStyle="round" borderTop={false} borderColor={color} paddingX={1} flexGrow={1} overflow="hidden">
        {children}
      </Box>
    </Box>
  );
}
