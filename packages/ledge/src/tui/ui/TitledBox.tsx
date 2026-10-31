import { useRef, type ReactNode } from 'react';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import { cells, cut } from '../model/cells.js';
import { C } from '../theme.js';

/** A rounded box with its title in the top border, as the mockup draws them (Ink's borders take no title); `mark`, when
 *  given, follows the title in its own colour (a machine's ●); `foot` at the right of the bottom border. `double`: a
 *  double line, for a box that asks to confirm (it reads as another state even where its red and the coral are close).
 *  `heads`, when given, draws the title in pieces of their own colour and weight (the tabs of Ledge's centre). */
export function TitledBox({ title, heads, mark, color = C.line, titleColor = C.dim, titleBold, double, foot, footColor = C.faint, children, flexGrow, height, width, flexShrink, minHeight }: {
  title: string; heads?: { text: string; color: string; bold?: boolean }[]; mark?: { text: string; color: string }; color?: string; titleColor?: string; titleBold?: boolean; double?: boolean; foot?: string; footColor?: string; children?: ReactNode;
  flexGrow?: number; flexShrink?: number; height?: number | string; width?: number | string; minHeight?: number;
}) {
  const b = double ? { tl: '╔', h: '═', tr: '╗', bl: '╚', br: '╝' } : { tl: '╭', h: '─', tr: '╮', bl: '╰', br: '╯' };
  const ref = useRef<DOMElement>(null);
  const { width: w } = useBoxMetrics(ref);
  const text = (l: { text: string }[]) => l.map(s => s.text).join('');
  // A title too long is cut before its mark, which stays whole while it fits.
  const tail = mark ? [{ text: ` ${mark.text.toUpperCase()}`, color: mark.color }] : [];
  const room = Math.max(0, w - 4 - (cells(text(tail)) < w - 8 ? cells(text(tail)) : 0));
  const head: { text: string; color: string; bold?: boolean }[] = heads
    ? heads.map((h, i) => ({ ...h, text: `${i === 0 ? ' ' : ''}${h.text.toUpperCase()}` }))
    : [{ text: ` ${title.toUpperCase()}`, color: titleColor }];
  const shown = cells(text([...head, ...tail])) > w - 4
    ? [...cut(head, room), ...(cells(text(tail)) < w - 8 ? tail : []), { text: ' ', color: titleColor }]
    : [...head, ...tail, { text: ' ', color: titleColor }];
  const rest = Math.max(0, w - 3 - cells(text(shown)));
  const f = foot ? text(cut([{ text: foot }], Math.max(0, w - 6))) : '';
  return (
    <Box ref={ref} flexDirection="column" flexGrow={flexGrow} flexShrink={flexShrink} height={height} width={width} minHeight={minHeight} overflow="hidden">
      <Text wrap="truncate"><Text color={color}>{b.tl}{b.h}</Text>{w > 0 ? shown.map((s, i) => <Text key={i} color={s.color} bold={(s as { bold?: boolean }).bold ?? titleBold}>{s.text}</Text>) : null}<Text color={color}>{b.h.repeat(rest)}{b.tr}</Text></Text>
      <Box flexDirection="column" borderStyle={double ? 'double' : 'round'} borderTop={false} borderBottom={!f} borderColor={color} paddingX={1} flexGrow={1} overflow="hidden">
        {children}
      </Box>
      {f ? <Text wrap="truncate"><Text color={color}>{b.bl}{b.h.repeat(Math.max(1, w - 5 - cells(f)))} </Text><Text color={footColor}>{f}</Text><Text color={color}> {b.h}{b.br}</Text></Text> : null}
    </Box>
  );
}
