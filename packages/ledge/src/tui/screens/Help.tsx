import { useState } from 'react';
import { useWindowSize } from 'ink';
import { useScreenKeys, useTui } from '../context.js';
import { cut, lineCells, pad, type Line } from '../model/cells.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { Lines } from '../ui/Lines.js';
import { TitledBox } from '../ui/TitledBox.js';

/** A group's column: its keys in the first cells, their labels after. */
const COLUMN = 36, KEY = 15, GAP = 2;

/** The groups in `n` columns, in order, each column as short as it can: the lines side by side. */
export function helpLines(groups: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]>, width: number): Line[] {
  const n = Math.max(1, Math.min(groups.length, Math.floor((width + GAP) / (COLUMN + GAP))));
  const w = Math.floor((width - GAP * (n - 1)) / n);
  const blocks = groups.map(([title, keys]) => [[{ text: title, color: C.coral, bold: true }],
    ...keys.map(([k, label]): Line => [{ text: k.padEnd(KEY), color: C.fg }, ...cut([{ text: label, color: C.dim }], w - KEY)])] as Line[]);
  // The least height that lays the groups out in n columns, an empty line between two groups.
  const columns = (h: number): Line[][] | null => {
    const out: Line[][] = [[]];
    for (const b of blocks) {
      const col = out[out.length - 1]!, add = (col.length ? 1 : 0) + b.length;
      if (col.length && col.length + add > h) { if (out.length === n) return null; out.push([...b]); }
      else col.push(...(col.length ? [[]] : []), ...b);
    }
    return out;
  };
  let h = Math.max(...blocks.map(b => b.length)), cols = columns(h);
  while (!cols) cols = columns(++h);
  const rows = Math.max(...cols.map(c => c.length));
  return Array.from({ length: rows }, (_, i) => cols!.flatMap((c, k) => {
    const l = c[i] ?? [];
    return k === cols!.length - 1 ? l : [...l, pad(w - lineCells(l) + GAP)];
  }));
}

/** Every key, screen by screen; j k PgUp PgDn when they do not all fit. */
export function Help() {
  const { t } = useTui();
  const { columns } = useWindowSize();
  const k = t.keys;
  const groups: Array<[string, Array<[string, string]>]> = [
    [t.help.global, [['1…5', t.help.screens], ['/', k.ask], ['+', k.launch], [',', k.settings], ['?', k.help], ['esc', k.back], ['q', k.quit]]],
    [t.help.overview, [['j k ↑ ↓', k.navigate], ['tab', k.next], ['↵', k.open], ['y n A', k.answer], ['1…9', k.answer], ['r', t.overview.denyWithNote], ['a', k.attach], ['i', k.interrupt]]],
    [t.help.session, [['y n A 1…9', k.answer], ['r ↵', k.write], ['j k PgUp PgDn', k.scroll], [t.keys.space, k.unfold], ['d', k.diffs], ['t', k.terminal], ['a', k.attach], ['m', k.model], ['i', k.interrupt]]],
    [t.help.ask, [['↵', k.send], ['tab', k.cycle], ['PgUp PgDn', k.scroll], ['j k G', k.scroll], ['ctrl+n', k.newChat], ['ctrl+c', k.stopAnswer]]],
    [t.help.field, [['↵', k.sendOnly], ['alt+↵ ctrl+j', k.newLine], ['↑ ↓', k.lineHistory], ['ctrl ← →', k.word], ['ctrl+w', t.help.wordBefore], ['ctrl+u', k.clear], ['esc', k.keepAndLeave]]],
    [t.help.launch, [['tab ↑ ↓', k.nextField], ['← →', k.choose], [t.keys.space, k.tick], ['ctrl+r', t.keys.redraw], ['ctrl+s', k.start], ['esc', k.cancel]]],
    [t.help.settings, [['↑ ↓', k.navigate], ['← →', k.change]]]
  ];
  const lines = helpLines(groups, Math.max(20, columns - 4));
  const [view, setView] = useState(10);
  // From the top: how many lines are above the box.
  const [top, setTop] = useState(0);
  const maxTop = Math.max(0, lines.length - view), at = Math.min(top, maxTop);
  const scroll = (to: number) => setTop(Math.min(maxTop, Math.max(0, to)));
  useScreenKeys((input, key) => {
    if (input === 'j' || key.downArrow) { scroll(at + 1); return true; }
    if (input === 'k' || key.upArrow) { scroll(at - 1); return true; }
    if (key.pageDown) { scroll(at + view - 1); return true; }
    if (key.pageUp) { scroll(at - view + 1); return true; }
    return false;
  });
  const below = lines.length - view - at;
  const foot = t.help.more(at, Math.max(0, below));
  return (
    <Frame crumb={t.help.title} keys={[['esc', k.back], ...(maxTop ? [['j k PgUp PgDn', k.scroll] as const] : [])]}>
      <TitledBox title={t.help.title} flexGrow={1} foot={foot || undefined}>
        <Lines lines={lines} up={Math.max(0, below)} onHeight={setView} />
      </TitledBox>
    </Frame>
  );
}
