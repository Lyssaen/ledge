import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Box, Text } from 'ink';
import { MANDATE_CATEGORY_LABEL, type Escalation } from '@ledge/protocol';
import { rigColor } from '@ledge/ui/rigs/model';
import { LEDGE_FOCUS, useTui, type KeyHandler } from '../context.js';
import type { Line } from '../model/cells.js';
import { markdownLines } from '../model/markdown.js';
import { C, projectColor } from '../theme.js';
import { LedgeConversation } from './LedgeConversation.js';
import { Lines } from './Lines.js';
import { RailLine } from './LedgeRail.js';
import { TitledBox } from './TitledBox.js';

/** Ledge's tabs, changed with ← →. */
export type LedgeTab = 'conversation' | 'rigs' | 'mandat';
export const LEDGE_TABS: readonly LedgeTab[] = ['conversation', 'rigs', 'mandat'];
type Keys = Array<readonly [string, string]>;

export interface LedgeTabsProps {
  tab: LedgeTab; width: number;
  /** From 100 to 139 columns: the rail folded into one line at the head. */
  folded?: boolean;
  /** The escalation chosen in « À toi » (the conversation only). */
  escalation?: Escalation;
  /** The centre's keys, asked first by the home's; its key bar. */
  keys: MutableRefObject<KeyHandler | null>;
  onBar(keys: Keys): void;
  /** ← →: the next tab or the one before. */
  onTab(dir: 1 | -1): void;
}

/**
 * Ledge's centre in the home, titled « Ledge · Conversation · Rigs · Mandat », the tab shown in bold: the conversation, every
 * machine's rigs (↵ chooses one, its room), or the mandate and its rules. From 100 to 139 columns the rail is a line at its head.
 */
export function LedgeTabs({ tab, width, folded, escalation, keys, onBar, onTab }: LedgeTabsProps) {
  const { t } = useTui();
  const heads = LEDGE_TABS.flatMap((x, i) => [
    ...(i === 0 ? [{ text: `${t.home.ledge} · `, color: C.dim }] : [{ text: ' · ', color: C.dim }]),
    { text: t.ledgeTabs[x], color: x === tab ? C.fg : C.dim, bold: x === tab }
  ]);
  return (
    <Box flexDirection="column" flexGrow={1} width={width}>
      {folded ? <RailLine /> : null}
      {tab === 'conversation' ? <LedgeConversation width={width} {...(escalation ? { escalation } : {})} keys={keys} onBar={onBar} heads={heads} onTab={onTab} />
        : tab === 'rigs' ? <RigsTab heads={heads} keys={keys} onBar={onBar} onTab={onTab} />
        : <MandateTab heads={heads} width={width} keys={keys} onBar={onBar} onTab={onTab} />}
    </Box>
  );
}

type TabProps = { heads: { text: string; color: string; bold?: boolean }[]; keys: MutableRefObject<KeyHandler | null>; onBar(keys: Keys): void; onTab(dir: 1 | -1): void };

/** The tab's own keys while the centre has the keyboard (← → the tabs, esc back to the left column); `more` first. */
function useTabKeys({ keys, onBar, onTab }: TabProps, more: KeyHandler, bar: Keys) {
  const { ledgeFocus, setLedgeFocus, t } = useTui();
  const active = ledgeFocus !== LEDGE_FOCUS.left;
  const handler: KeyHandler = (input, key) => {
    if (!active) return false;
    if (more(input, key)) return true;
    if (key.leftArrow || key.rightArrow) { onTab(key.rightArrow ? 1 : -1); return true; }
    if (key.escape) { setLedgeFocus(LEDGE_FOCUS.left); return true; }
    return false;
  };
  keys.current = handler;
  useEffect(() => () => { if (keys.current === handler) keys.current = null; }); // eslint-disable-line react-hooks/exhaustive-deps
  const shown: Keys = active ? [...bar, ['← →', t.keys.tabs], ['esc', t.keys.back]] : [];
  const barKey = shown.map(k => k.join(' ')).join('|');
  useEffect(() => { onBar(shown); }, [barKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Every machine's rigs, one line each: name, « n/m au travail », place, machine, spec, branch. ↵ chooses the rig (its room). */
function RigsTab(p: TabProps) {
  const { t, g, left, machines, setFocus, ledgeFocus } = useTui();
  const rigs = left.flatMap(r => (r.kind === 'rig' ? [r] : []));
  const [at, setAt] = useState(0);
  const i = Math.min(at, Math.max(0, rigs.length - 1));
  const active = ledgeFocus !== LEDGE_FOCUS.left;
  useTabKeys(p, (input, key) => {
    if (input === 'j' || key.downArrow) { setAt(Math.min(rigs.length - 1, i + 1)); return true; }
    if (input === 'k' || key.upArrow) { setAt(Math.max(0, i - 1)); return true; }
    if (key.return) { const r = rigs[i]; if (r) setFocus({ kind: 'rig', machine: r.rig.machine, rigId: r.rig.id }); return true; }
    return false;
  }, [['j k', t.keys.navigate], ['↵', t.keys.open]]);
  const nameW = Math.max(0, ...rigs.map(r => r.rig.name.length)) + 2;
  const machineName = (id: string) => machines.find(m => m.id === id)?.label ?? id;
  return (
    <TitledBox title={t.home.conversation} heads={p.heads} flexGrow={1} color={active ? C.coral : C.line}>
      {rigs.length === 0 ? <Text color={C.faint}>{t.rail.noRig}</Text> : rigs.map((r, n) => {
        const on = active && n === i;
        const where = [r.place.kind === 'project' ? t.home.inProject(r.place.name) : r.place.kind === 'off' ? t.home.offProject : '', machineName(r.rig.machine)].filter(Boolean).join(' · ');
        return (
          <Box key={`${r.rig.machine}/${r.rig.id}`} height={1} backgroundColor={on ? C.sel : undefined}>
            <Text wrap="truncate">
              <Text color={on ? C.coral : C.faint}>{on ? '▌' : ' '}</Text>
              <Text color={projectColor(rigColor(r.rig))}>{g.rig} </Text><Text color={C.fg} bold>{r.rig.name.padEnd(nameW)}</Text>
              <Text color={C.dim}>{t.home.working(r.working, r.total)}  </Text><Text color={C.faint}>{where}</Text>
              {r.rig.spec ? <Text color={C.dim}>  {t.rail.spec(r.rig.spec)}</Text> : null}
              {r.rig.branch ? <Text color={C.dim}>  {g.branch} {r.rig.branch}</Text> : null}
            </Text>
          </Box>
        );
      })}
    </TitledBox>
  );
}

/** Ledge's mandate in Markdown, then its rules: the active ones, then those it proposes (« à valider »). Until Ledge's brain sends
 *  them (lot 7), a line says they come with it. j k scroll. */
function MandateTab(p: TabProps & { width: number }) {
  const { t, g, brain, lang, ledgeFocus } = useTui();
  // The first line shown: the mandate reads from its top.
  const [top, setTop] = useState(0);
  const [view, setView] = useState(10);
  const active = ledgeFocus !== LEDGE_FOCUS.left;
  const inner = Math.max(10, p.width - 4);
  const lines = useMemo((): Line[] => {
    const out: Line[] = brain.mandate ? markdownLines(brain.mandate.text, { width: inner, g, color: C.fg }) : [];
    const rules = brain.rules ?? [];
    if (rules.length) {
      if (out.length) out.push([]);
      out.push([{ text: t.rail.rules.toUpperCase(), color: C.faint }]);
      for (const r of [...rules.filter(x => x.status === 'active'), ...rules.filter(x => x.status === 'proposed')]) {
        const proposed = r.status === 'proposed';
        out.push([{ text: `${g.bullet} `, color: proposed ? C.blue : C.dim }, { text: r.text, color: proposed ? C.blue : C.fg },
          { text: ` · ${MANDATE_CATEGORY_LABEL[r.category][lang]}`, color: C.faint },
          proposed ? { text: ` · ${t.rail.toValidate}`, color: C.blue } : { text: ` · ${t.rail.applied(r.appliedCount)}`, color: C.faint }]);
      }
    }
    return out;
  }, [brain.mandate, brain.rules, inner, g, t, lang]);
  const maxTop = Math.max(0, lines.length - view);
  const from = Math.min(top, maxTop);
  useTabKeys(p, (input, key) => {
    if (input === 'k' || key.upArrow) { setTop(Math.max(0, from - 1)); return true; }
    if (input === 'j' || key.downArrow) { setTop(Math.min(maxTop, from + 1)); return true; }
    return false;
  }, [['j k', t.keys.line]]);
  return (
    <TitledBox title={t.home.conversation} heads={p.heads} flexGrow={1} color={active ? C.coral : C.line} {...(brain.mandate ? { foot: brain.mandate.path } : {})}>
      {lines.length === 0 ? <Text color={C.faint}>{t.rail.coming}</Text> : <Lines lines={lines.slice(from, from + view)} onHeight={setView} />}
    </TitledBox>
  );
}
