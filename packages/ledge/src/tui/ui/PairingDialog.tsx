import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { replaceable, useMobile } from '@ledge/fleet';
import type { MobilePairing } from '@ledge/protocol';
import { useScreenSize, useTui } from '../context.js';
import { cells } from '../model/cells.js';
import { deviceName, seenText, sendMobile, shortDate } from '../model/mobile.js';
import { C } from '../theme.js';
import { TitledBox } from './TitledBox.js';
import { usePairingDialog } from './pairingDialog.js';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The code as the mockup spaces it: each character apart, the groups of three set off by a dot (`4 7 2 · 9 1 5 · 3 0 8`). */
export function spacedCode(code: string | null): string {
  const groups = (code ?? '').split(' ').filter(Boolean);
  const parts = groups.length > 1 ? groups : (groups[0] ? (groups[0].match(/.{1,3}/g) ?? []) : []);
  return parts.map(g => [...g].join(' ')).join(' · ');
}

/** One line of the dialog, margin included and filled to its width, so what lies under the dialog does not show through (Ink draws no padding). */
function Row({ width, children, used }: { width: number; children?: ReactNode; used: number }) {
  return <Text wrap="truncate">{' '}{children}{' '.repeat(Math.max(0, width - used))}</Text>;
}

/** « Lier un appareil » drawn over the screen: the pairing's code to compare, then what the daemon says of it. Its keys come before the screen's. */
export function PairingDialog() {
  const tui = useTui();
  const { client, t, lang, g } = tui;
  const { columns } = useScreenSize();
  const c = t.mobile;
  const dialog = usePairingDialog();
  const m = useMobile(client);
  const p: MobilePairing | undefined = dialog.id === null ? undefined : m?.pairings.find(x => x.id === dialog.id);
  const shown = p && (p.state === 'confirm' || p.state === 'approved' || p.state === 'linked' || p.state === 'expired') ? p : undefined;
  const [, tick] = useState(0);
  const [keep, setKeep] = useState<string | null>(null);
  const counting = shown?.state === 'confirm';
  // The pairing y or n was sent for: a second press waits for the daemon's answer, so nothing is approved twice.
  const answered = useRef<string | null>(null);
  if (shown?.state !== 'confirm') answered.current = null;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [counting]);
  // A pairing gone from the daemon's state, or ended in a way the dialog does not show, closes it.
  const id = dialog.id;
  useEffect(() => { if (id !== null && !shown) dialog.close(); }, [id, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const old = shown?.state === 'confirm' ? replaceable(m, shown.label) : null;
  const replacing = old !== null && shown !== undefined && keep !== shown.id;

  useInput((input, key) => {
    if (!shown) return;
    if (key.escape) { dialog.close(); return; }
    if (shown.state !== 'confirm') return;
    if (input === 'y' || input === 'n') {
      if (answered.current === shown.id) return;
      const sent = sendMobile(tui, input === 'y' ? { type: 'mobile.pairing.approve', id: shown.id, ...(replacing && old ? { replaces: old.id } : {}) } : { type: 'mobile.pairing.deny', id: shown.id });
      if (sent) answered.current = shown.id;
    } else if (input === 'r' && old) setKeep(keep === shown.id ? null : shown.id);
  }, { isActive: shown !== undefined });

  if (!shown) return null;
  const w = Math.min(58, columns - 2), inner = w - 4;
  const x = Math.floor((columns - w) / 2);
  const left = Math.max(0, Math.ceil((Date.parse(shown.expiresAt) - Date.now()) / 1000));
  const line = (...segs: Array<[string, string, boolean?]>) => <Row key={segs.map(s => s[0]).join('')} width={inner + 1} used={segs.reduce((n, s) => n + cells(s[0]), 0)}>{segs.map(([s, color, bold], i) => <Text key={i} color={color} bold={bold}>{s}</Text>)}</Row>;
  const blank = (i: number) => <Row key={`b${i}`} width={inner + 1} used={0} />;
  const caps = (list: Array<[string, string, string]>, indent = 0) => (
    <Row key="caps" width={inner + 1} used={indent + list.reduce((n, [k, l]) => n + cells(` ${k} `) + cells(` ${l} `), 0)}>
      {indent ? <Text>{' '.repeat(indent)}</Text> : null}{list.map(([k, l, color]) => <Text key={k}><Text color={C.fg} backgroundColor={C.key}> {k} </Text><Text color={color}> {l} </Text></Text>)}
    </Row>
  );

  let body: ReactNode[];
  if (shown.state === 'confirm') {
    const [intro1 = '', intro2 = ''] = c.pairIntro(m?.account?.login ?? '');
    const [check1 = '', check2 = ''] = c.pairCheck(shown.label);
    const expires = c.expires(mmss(left));
    const code = spacedCode(shown.code);
    body = [
      line([intro1, C.fg]), line([intro2, C.fg]), blank(1),
      line([c.pairCode, C.dim]), line([' '.repeat(10) + code, C.yellow, true]), blank(2)
    ];
    body.push(
      line([check1, C.dim]), line([check2, C.dim]),
      line([c.pairWarn[0] ?? '', C.red]),
      line([c.pairWarn[1] ?? '', C.red], [' '.repeat(Math.max(1, inner - cells(c.pairWarn[1] ?? '') - cells(expires))), C.fg], [expires, C.faint]), blank(3)
    );
    if (old) {
      const seen = seenText(old, Date.now(), c, t.time) || t.mobile.seenAgo('');
      body.push(
        line([replacing ? '[x] ' : '[ ] ', C.fg, true], [c.replaceL(deviceName(old)), C.fg]),
        line(['    ' + c.replaceH(seen, c.linkedOn(shortDate(old.approvedAt, lang))), C.faint]), blank(4)
      );
    }
    body.push(caps([['y', c.approve, C.green], ['n', c.deny, C.red], ...(old ? [['r', c.untick, C.dim] as [string, string, string]] : []), ['esc', c.later, C.dim]], old ? 0 : 2));
  } else {
    const [a = '', b = ''] = shown.state === 'approved' ? c.approvedL(shown.label) : shown.state === 'linked' ? c.linkedL(shown.label) : c.expiredL;
    const color = shown.state === 'expired' ? C.yellow : C.green;
    body = [line([(shown.state === 'expired' ? '⊘ ' : g.ok + ' '), color], [a, color, true]), line(['  ' + b, C.fg]), blank(1), caps([['esc', c.close, C.dim]], 2)];
  }
  return (
    <Box position="absolute" marginLeft={x} marginTop={1} width={w}>
      <TitledBox title={c.pairT} color={C.yellow} titleColor={C.yellow} titleBold width={w} paddingX={0}>
        {body}
      </TitledBox>
    </Box>
  );
}
