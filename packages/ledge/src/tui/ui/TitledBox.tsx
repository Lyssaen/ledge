import { useRef, type ReactNode } from 'react';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import { cells, cut } from '../model/cells.js';
import { C } from '../theme.js';

/** A rounded box with its title in the top border, as the mockup draws them (Ink's borders take no title); `foot`, when
 *  given, at the right of the bottom border. `double`: a double line, for a box that asks to confirm (it reads as another
 *  state even where its red and the coral are close). */
export function TitledBox({ title, color = C.line, titleColor = C.dim, titleBold, double, foot, footColor = C.faint, children, flexGrow, height, width, flexShrink, minHeight }: {
  title: string; color?: string; titleColor?: string; titleBold?: boolean; double?: boolean; foot?: string; footColor?: string; children?: ReactNode;
  flexGrow?: number; flexShrink?: number; height?: number | string; width?: number | string; minHeight?: number;
}) {
  const b = double ? { tl: '╔', h: '═', tr: '╗', bl: '╚', br: '╝' } : { tl: '╭', h: '─', tr: '╮', bl: '╰', br: '╯' };
  const ref = useRef<DOMElement>(null);
  const { width: w } = useBoxMetrics(ref);
  const label = ` ${title.toUpperCase()} `;
  const text = (l: { text: string }[]) => l.map(s => s.text).join('');
  const shown = cells(label) > w - 3 ? `${text(cut([{ text: label }], Math.max(0, w - 4)))} ` : label;
  const rest = Math.max(0, w - 3 - cells(shown));
  const f = foot ? text(cut([{ text: foot }], Math.max(0, w - 6))) : '';
  return (
    <Box ref={ref} flexDirection="column" flexGrow={flexGrow} flexShrink={flexShrink} height={height} width={width} minHeight={minHeight} overflow="hidden">
      <Text wrap="truncate"><Text color={color}>{b.tl}{b.h}</Text><Text color={titleColor} bold={titleBold}>{w > 0 ? shown : ''}</Text><Text color={color}>{b.h.repeat(rest)}{b.tr}</Text></Text>
      <Box flexDirection="column" borderStyle={double ? 'double' : 'round'} borderTop={false} borderBottom={!f} borderColor={color} paddingX={1} flexGrow={1} overflow="hidden">
        {children}
      </Box>
      {f ? <Text wrap="truncate"><Text color={color}>{b.bl}{b.h.repeat(Math.max(1, w - 5 - cells(f)))} </Text><Text color={footColor}>{f}</Text><Text color={color}> {b.h}{b.br}</Text></Text> : null}
    </Box>
  );
}
