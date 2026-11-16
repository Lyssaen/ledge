import { useState, type ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useMobile } from '@ledge/fleet';
import { RelayUrlSchema, type MobileState } from '@ledge/protocol';
import { copyText } from '../clipboard.js';
import { useEditing, useScreenKeys, useTui } from '../context.js';
import { sendMobile } from '../model/mobile.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { useNow } from '../ui/now.js';
import { TextInput } from '../ui/TextInput.js';
import { TitledBox } from '../ui/TitledBox.js';

/** One row the cursor can take; the device rows of the second box are appended to the same list, so `j k` runs over both boxes. */
export type MobileRow = { id: string; action?: () => void };

const LABEL = 22;
const host = (url: string): string => { try { return new URL(url).host; } catch { return url; } };

/** Réglages › Accès mobile (docs/mockups/ledge-mobile-access-tui.html): the local daemon's mobile access, its account and its devices. */
export function Mobile() {
  const tui = useTui();
  const { t } = tui;
  const m = useMobile(tui.client);
  const { stdout } = useStdout();
  const now = useNow();
  const [at, setAt] = useState(0);
  const [relay, setRelay] = useState<{ value: string; bad: boolean } | null>(null);
  useEditing(relay !== null);
  const send = (msg: Parameters<typeof sendMobile>[1]) => sendMobile(tui, msg);

  const service = m === undefined || m.link.state === 'unavailable';
  const rows: MobileRow[] = m === undefined || service ? [] : accessRows(m);
  function accessRows(s: MobileState): MobileRow[] {
    const out: MobileRow[] = [{ id: 'access', action: () => send({ type: 'mobile.set', enabled: !s.enabled, relayUrl: s.relayUrl }) }];
    // With access off the rest is out of reach: only « Accès » takes the cursor.
    if (!s.enabled) return out;
    const signin = s.signin ? undefined : () => send({ type: 'mobile.signin' });
    out.push({ id: 'relay', action: () => setRelay({ value: s.relayUrl, bad: false }) });
    out.push({ id: 'account', action: s.signin ? undefined : s.link.state !== 'signed_out' && s.account && s.signinError !== 'not_allowed' ? () => send({ type: 'mobile.signout' }) : signin });
    out.push({ id: 'status', action: s.link.state === 'offline' ? () => send({ type: 'mobile.retry' }) : undefined });
    if (s.terminalInput !== undefined) out.push({ id: 'terminal', action: () => send({ type: 'mobile.terminal', input: !s.terminalInput }) });
    return out;
  }
  const cur = Math.min(at, Math.max(0, rows.length - 1));

  const submitRelay = (value: string) => {
    const r = RelayUrlSchema.safeParse(value.trim());
    if (!r.success) { setRelay({ value, bad: true }); return; }
    if (m && send({ type: 'mobile.set', enabled: m.enabled, relayUrl: r.data })) setRelay(null);
  };

  useScreenKeys((input, key) => {
    if (relay) return true;
    if (m?.signin && key.escape) { send({ type: 'mobile.signin.cancel' }); return true; }
    if (m?.signin && input === 'c') { copyText(m.signin.userCode, s => stdout.write(s)); tui.toast({ text: t.mobile.copiedT, tone: 'ok' }); return true; }
    if (key.upArrow || input === 'k') { setAt(Math.max(0, cur - 1)); return true; }
    if (key.downArrow || input === 'j') { setAt(Math.min(rows.length - 1, cur + 1)); return true; }
    if (key.return || input === ' ') { rows[cur]?.action?.(); return true; }
    return false;
  });

  const k = t.mobile.keys;
  const keys: Array<[string, string]> = relay ? [['↵', k.save], ['esc', k.cancel]]
    : m?.signin ? [['c', k.copy], ['esc', k.cancel]]
    : rows.length ? [['j k', k.move], ['↵', k.open], ['esc', k.back]] : [['esc', k.back]];
  const sel = (id: string) => rows[cur]?.id === id;

  return (
    <Frame crumb={t.mobile.title} keys={keys}>
      <TitledBox title={t.mobile.title} flexGrow={1} paddingX={0}>
        {m === undefined ? <Line color={C.yellow}>{t.mobile.outdated}</Line>
          : m.link.state === 'unavailable' ? <><Line color={C.red}>{t.mobile.unavailable}</Line><Line color={C.red}>{m.link.error}</Line></>
          : <AccessBox m={m} now={now} sel={sel} relay={relay} setRelay={setRelay} submitRelay={submitRelay} />}
      </TitledBox>
    </Frame>
  );
}

function Line({ color, children }: { color: string; children: ReactNode }) {
  return <Text wrap="truncate"><Text> </Text><Text color={color}>{children}</Text></Text>;
}

/** A row of the box: the cursor mark, the label, then the values; the selected row takes the selection's background. */
function Row({ selected, label, children }: { selected: boolean; label: string; children: ReactNode }) {
  return (
    <Box backgroundColor={selected ? C.sel : undefined} overflow="hidden">
      <Text color={selected ? C.coral : C.faint}>{selected ? '▌' : ' '}</Text>
      <Text color={selected ? C.fg : C.dim}>{label.padEnd(LABEL)}</Text>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">{children}</Box>
    </Box>
  );
}

/** The lines hanging under a row, in the label's indent. */
const Under = ({ color, lines }: { color: string; lines: readonly string[] }) => <>{lines.map(l => <Text key={l} wrap="truncate"><Text>{' '.repeat(LABEL + 1)}</Text><Text color={color}>{l}</Text></Text>)}</>;

/** The first box: access, relay, GitHub account, link state and the terminal switch, as the daemon's state says them. */
function AccessBox({ m, now, sel, relay, setRelay, submitRelay }: {
  m: MobileState; now: number; sel(id: string): boolean;
  relay: { value: string; bad: boolean } | null; setRelay(r: { value: string; bad: boolean } | null): void; submitRelay(v: string): void;
}) {
  const c = useTui().t.mobile;
  const v = m.enabled ? C.fg : C.faint;
  const faint = (s: string) => <Text color={C.faint}>{s}</Text>;
  const ended = m.signinError && m.signinError !== 'not_allowed' ? c.signinEnded[m.signinError] : undefined;
  const signedOut = m.link.state === 'signed_out' ? c.signedOut[m.link.reason] : undefined;

  // The account row and the lines under it, in the order of the mockup: the flow, a refused account, a signed-out PC, the account, an ended sign-in, the way in.
  let account: ReactNode, accountUnder: ReactNode = null;
  if (m.signin) {
    const min = Math.max(0, Math.ceil((Date.parse(m.signin.expiresAt) - now) / 60_000));
    const where = m.signin.verificationUri.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    account = <><Text color={C.fg}>{c.flowLead} </Text><Text color={C.blue} underline>{where}</Text></>;
    accountUnder = <>
      <Text wrap="truncate"><Text>{' '.repeat(LABEL + 1)}</Text><Text color={C.fg}>{c.flowAnd} </Text><Text color={C.yellow} bold>{m.signin.userCode}</Text></Text>
      <Under color={C.faint} lines={[c.flowWait(min)]} />
    </>;
  } else if (m.signinError === 'not_allowed') {
    account = <Text color={C.fg} bold>{c.otherAccount}{faint('  ↵')}</Text>;
    accountUnder = <Under color={C.red} lines={c.notAllowed} />;
  } else if (signedOut) {
    account = <Text color={C.fg} bold>{c.reconnect}{faint('  ↵')}</Text>;
    accountUnder = <Under color={C.yellow} lines={signedOut} />;
  } else if (m.account) {
    account = <><Text color={v}>@{m.account.login}</Text>{faint(`  · ${c.signout}`)}</>;
  } else {
    account = <Text color={C.fg} bold>{ended ? c.signinAgain : c.signin}{faint('  ↵')}</Text>;
    if (ended) accountUnder = <Under color={C.yellow} lines={[ended]} />;
  }

  const offline = m.enabled && m.link.state === 'offline';
  const secs = m.link.state === 'offline' ? Math.max(0, Math.ceil((Date.parse(m.link.retryAt) - now) / 1000)) : 0;
  const status = !m.enabled ? <><Text color={C.faint}>○ </Text><Text color={C.faint}>{c.offW}</Text></>
    : m.link.state === 'online' ? <><Text color={C.green}>● </Text><Text color={C.fg}>{c.online}</Text></>
    : m.link.state === 'connecting' ? <><Text color={C.yellow}>◌ </Text><Text color={C.fg}>{c.connecting}</Text></>
    : offline ? <><Text color={C.yellow}>● </Text><Text color={C.fg}>{c.retryIn(secs)}</Text>{faint(`  ↵ ${c.retry}`)}</>
    : <><Text color={C.faint}>○ </Text><Text color={C.fg}>{c.idle}</Text>{!m.signin && !m.signinError && !m.account ? faint(`  ${c.idleH}`) : null}</>;

  return (
    <>
      <Row selected={sel('access')} label={c.access}>
        {m.enabled ? <><Text color={C.green}>● </Text><Text color={C.fg}>{c.on}</Text></> : <><Text color={C.faint}>○ </Text><Text color={C.fg}>{c.offW}</Text></>}{faint(`  ${c.accessH}`)}
      </Row>
      <Row selected={sel('relay')} label={c.relay}>
        {relay
          ? <Box flexGrow={1}><Text color={C.fg}>[ </Text><TextInput value={relay.value} onChange={x => setRelay({ value: x, bad: false })} onSubmit={submitRelay} onEscape={() => setRelay(null)} active /><Text color={C.fg}> ]</Text></Box>
          : <Text color={v}>{host(m.relayUrl)}</Text>}
      </Row>
      {relay?.bad ? <Under color={C.red} lines={[c.relayBad]} /> : null}
      {relay ? <Under color={C.faint} lines={[`↵ ${c.keys.save}   esc ${c.keys.cancel}`]} /> : null}
      <Row selected={sel('account')} label={c.account}>{account}</Row>
      {accountUnder && !offline ? accountUnder : null}
      <Row selected={sel('status')} label={c.statusL}>{status}</Row>
      {offline ? <Under color={C.yellow} lines={c.unreachable} /> : null}
      {m.terminalInput !== undefined ? <Row selected={sel('terminal')} label={c.term}><Text color={v}>{m.terminalInput ? c.on : c.no}</Text>{faint(`  ${c.termH}`)}</Row> : null}
    </>
  );
}
