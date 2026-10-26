import type { ReactNode } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import type { ChatTurn } from '@ledge/protocol';
import type { ActionRowView } from '@ledge/ui/chat/actionRow';
import { useTui } from '../context.js';
import { cardPlan, lineOf, verbOf, whyOf, type CardPlan, type Shown } from '../model/actionCard.js';
import { clock } from '../model/time.js';
import { wrapSegs, type Line } from '../model/cells.js';
import { C } from '../theme.js';
import { Button } from './SessionCard.js';
import { TitledBox } from './TitledBox.js';

/** The first lines of a request shown cut: the rest is read in the session (o). */
const CUT_LINES = 6;

/** A row whose request « n » denies from the card: an acceptance not applied yet, shown whole or cut. */
export const deniable = (r: ActionRowView, s: Shown) => r.action === 'session.decide' && r.decision === 'accept' && (s === 'proposed' || s === 'held' || s === 'cut');
/** What ↵ applies on the row: nothing on a row settled, running, refused, stale or cut. */
export const appliable = (s: Shown) => s === 'proposed' || s === 'held' || s === 'failed';

/** The rows « y » confirms: the title and the foot of the box say how many, and how many cannot be undone. */
export interface ActionBoxProps { turn: ChatTurn; plan?: CardPlan; focused: boolean; busy: boolean; sel: number; confirming: readonly number[] | null }

/**
 * The generic card of an answer (#94, docs/mockups/ledge-action-card.html, view TUI): a coral TitledBox, a row per action, a
 * plan past one (numbered, ↑ ↓ choose the row ▸). Asking to confirm, the box turns red with a double line and lists what
 * « y » applies; ↵ never confirms.
 */
export function ActionBox({ turn, focused, busy, sel, confirming, plan }: ActionBoxProps) {
  const { t, g } = useTui();
  const { columns } = useWindowSize();
  const a = t.ask.action, c = a.copy;
  const p = plan ?? cardPlan(turn.actions ?? []);
  const many = p.rows.length > 1;
  const first = p.rows[0]!;
  const irreversible = (rows: readonly number[]) => rows.filter(i => p.rows[i]!.risk === 'destructive').length;
  const title = confirming ? (confirming.length === 1 ? a.confirmOne(lineOf(p.rows[confirming[0]!]!, c)) : a.confirmMany(confirming.length, irreversible(confirming)))
    : !many && first.request ? a.request(c.words.kind[first.request.kind] ?? first.request.kind, first.target ?? '')
    : many ? a.plan(p.rows.length) : c.label(1);
  const border = confirming ? C.red : focused ? C.coral : C.line;
  const at = (iso?: string) => (iso ? clock(iso) : '');

  const glyph = (s: Shown): [string, string] => ({
    proposed: [g.idle, C.dim], held: [g.held, C.faint], running: [g.running, C.blue], done: [g.ok, C.green], failed: [g.fail, C.red],
    refused: [g.fail, C.dim], stale: [g.stale, C.yellow], cut: [g.idle, C.dim], denied: [g.ok, C.dim]
  } as Record<Shown, [string, string]>)[s];
  const tail = (r: ActionRowView, s: Shown): ReactNode[] => {
    const state = s === 'done' ? [a.state.done(at(r.doneAt)), C.green] : s === 'running' ? [a.state.running, C.blue] : s === 'held' ? [a.state.held, C.faint]
      : s === 'refused' ? [a.state.refused, C.dim] : s === 'cut' ? [a.state.cut, C.yellow] : s === 'denied' ? [a.state.denied(at(r.doneAt)), C.dim] : null;
    const out: ReactNode[] = [];
    if (state) out.push(<Text key="s" color={state[1]}>{state[0]}  </Text>);
    // A denial sent has no risk: the acceptance it stood for did not happen.
    if (s !== 'denied') out.push(<Text key="r" color={r.risk === 'destructive' ? C.red : C.faint} bold={r.risk === 'destructive'}>{c.risk[r.risk].toLowerCase()}</Text>);
    return out;
  };
  // Wrapped here, at the box's width less the row's indent, as the conversation is: a line never starts with a space.
  const inner = (indent: number) => Math.max(10, columns - 6 - indent);
  const drawn = (lines: Line[], key: string) => lines.map((l, k) => <Text key={`${key}${k}`} wrap="truncate">{l.map((x, j) => <Text key={j} color={x.color}>{x.text}</Text>)}</Text>);
  const para = (text: string, color: string, indent: number, key: string) => drawn(wrapSegs([{ text, color }], inner(indent)), key);
  const quote = (text: string, color: string, indent: number, key: string) =>
    drawn(wrapSegs([{ text, color }], inner(indent + 2)).map(l => [{ text: '│ ', color: C.line }, ...l]), key);

  const rows = p.rows.map((r, i) => {
    const s = p.shown[i]!;
    if (confirming && s === 'done') return <Text key={i} color={C.faint} wrap="truncate">  {g.ok} {lineOf(r, c)}   {c.confirm.alreadyDone}</Text>;
    const selected = focused && !confirming && many && i === sel;
    const [mark, markColor] = glyph(s);
    const line = s === 'denied' ? lineOf({ ...r, vars: { ...r.vars, decision: 'deny' } }, c) : lineOf(r, c);
    const indent = many ? 6 : 2;
    const under: ReactNode[] = [];
    if (r.request) {
      under.push(<Text key="k" color={C.faint}>{c.words.kind[r.request.kind] ?? r.request.kind}</Text>);
      if (s === 'cut') {
        r.request.text.split('\n').slice(0, CUT_LINES).forEach((l, k) => under.push(...quote(l, C.fg, indent, `q${k}-`)));
        under.push(...quote(a.cutMark, C.yellow, indent, 'cut'));
        under.push(...para(c.words.cut.note(r.target ?? ''), C.dim, indent, 'n'));
      } else r.request.text.split('\n').forEach((l, k) => under.push(...quote(l, s === 'stale' || s === 'denied' ? C.faint : C.fg, indent, `q${k}-`)));
    }
    // An irreversible row's detail always shows; another's on the row chosen, and all of them in a confirmation.
    if (r.detail && (confirming || selected || r.risk === 'destructive')) under.push(...para(r.detail, C.faint, indent, 'd'));
    if (s === 'failed') under.push(...para(c.failed(whyOf(r, c)), C.red, indent, 'f'));
    if (s === 'refused') under.push(...para(c.refused(whyOf(r, c)), C.red, indent, 'f'));
    // Short: the line of keys below says to ask again.
    if (s === 'stale') under.push(...para(a.stale(r.target ?? ''), C.yellow, indent, 'f'));
    if (s === 'denied') under.push(...para(c.deniedNote(r.target ?? ''), C.dim, indent, 'f'));
    return (
      <Box key={i} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" backgroundColor={selected ? C.sel : undefined}>
          <Text wrap="truncate">
            {many ? <Text color={C.coral}>{selected ? '▸ ' : '  '}</Text> : null}
            {many ? <Text color={C.dim}>{i + 1} </Text> : null}
            <Text color={markColor}>{mark} </Text>
            <Text color={s === 'held' ? C.dim : C.fg}>{line}</Text>
          </Text>
          <Box flexShrink={0} marginLeft={1}><Text>{tail(r, s)}</Text></Box>
        </Box>
        {under.length ? <Box flexDirection="column" paddingLeft={indent}>{under}</Box> : null}
      </Box>
    );
  });

  const keys = (): ReactNode => {
    if (confirming) {
      const one = confirming.length === 1 ? p.rows[confirming[0]!]! : null;
      return (
        <Box flexDirection="column" marginTop={1}>
          {many ? <Box paddingLeft={2} flexDirection="column">{para(a.hint.inOrder, C.dim, 2, 'o')}</Box> : null}
          <Box columnGap={2}><Button label={one ? verbOf(one, c) : c.confirm.go(confirming.length)} k="y" danger /><Button label={c.confirm.cancel} k="esc" /><Text color={C.faint}>{a.hint.confirm}</Text></Box>
        </Box>
      );
    }
    const running = p.shown.indexOf('running');
    if (running >= 0 || busy) return <Box><Text color={C.blue}>{g.running} </Text><Text color={C.dim}>{many && running >= 0 ? c.progress(running + 1, p.rows.length) : c.running}</Text></Box>;
    const r = p.rows[sel] ?? first, s = p.shown[sel] ?? p.shown[0]!;
    const ignore = <Button label={c.ignore} k="esc" />;
    if (s === 'stale') return <Box columnGap={2}><Button label={c.open(r.target ?? '')} k="o" /><Text color={C.faint}>{a.hint.stale}</Text></Box>;
    if (s === 'cut') return <Box columnGap={2}><Button label={c.deny} k="n" /><Button label={c.open(r.target ?? '')} k="o" />{ignore}<Text color={C.faint}>{a.hint.cut}</Text></Box>;
    const danger = r.risk === 'destructive';
    const rowButton = appliable(s) ? <Button label={`${s === 'failed' ? c.retry : verbOf(r, c)}${danger && s !== 'failed' ? '…' : ''}`} k="↵" primary={focused && !danger} danger={danger} /> : null;
    const deny = deniable(r, s) ? <Button label={c.deny} k="n" /> : null;
    if (!many) return <Box columnGap={2}>{rowButton}{deny}{ignore}<Text color={C.faint}>{a.hint.one}</Text></Box>;
    const all = p.all.rows.length ? <Button label={`${p.all.kind === 'all' ? c.all(p.all.rows.length) : p.all.kind === 'resume' ? c.resume(p.all.k, p.all.rows.length) : c.skip(p.all.k, p.all.rows.length)}${irreversible(p.all.rows) ? '…' : ''}`} k="a" /> : null;
    return <Box columnGap={2}>{rowButton}{deny}{all}{ignore}<Text color={C.faint}>{a.hint.choose}</Text></Box>;
  };

  return (
    <TitledBox title={title} flexShrink={0} color={border} titleColor={confirming ? C.red : C.coral} titleBold={!!confirming} double={!!confirming}>
      {rows}
      {keys()}
    </TitledBox>
  );
}
