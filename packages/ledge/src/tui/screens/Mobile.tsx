import { useEffect, useState, type ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useMobile } from '@ledge/fleet';
import { DeviceNameSchema, RelayUrlSchema, type MobileState } from '@ledge/protocol';
import { copyText } from '../clipboard.js';
import { useEditing, useScreenKeys, useTui } from '../context.js';
import { deviceName, sendMobile, waitingPairings } from '../model/mobile.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { DevicesBox, type DeviceField } from '../ui/MobileDevices.js';
import { usePairingDialog } from '../ui/pairingDialog.js';
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
  // The row the user moved to, kept by id so a state change cannot slide the cursor onto another row; null until the user moves.
  const [movedId, setMovedId] = useState<string | null>(null);
  const [relay, setRelay] = useState<{ value: string; bad: boolean } | null>(null);
  const [rename, setRename] = useState<DeviceField | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const pairing = usePairingDialog();
  const renamed = rename !== null && m?.devices.some(d => d.id === rename.id) === true;
  const revokable = revoking !== null && m?.devices.some(d => d.id === revoking) === true;
  // A device that leaves the state while its field or its question is open takes them with it, unsent.
  useEffect(() => { if (rename && !renamed) setRename(null); }, [rename, renamed]);
  useEffect(() => { if (revoking && !revokable) setRevoking(null); }, [revoking, revokable]);
  useEditing(relay !== null || renamed);
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
    for (const row of deviceRows(s)) out.push(row);
    return out;
  }
  /** The devices box's rows: a blocked recovery, the pairings waiting, then the devices; each one's action is what ↵ does there. */
  function deviceRows(s: MobileState): MobileRow[] {
    const out: MobileRow[] = [];
    if (s.recovery?.blocked) out.push({ id: 'blocked', action: () => send({ type: 'mobile.recovery.unblock' }) });
    for (const p of waitingPairings(s)) out.push({ id: `pair:${p.id}`, action: () => pairing.open(p.id) });
    for (const d of s.devices) {
      out.push({ id: `dev:${d.id}`, action: d.recovered?.pending ? () => send({ type: 'mobile.device.ack', id: d.id, what: 'recovered' }) : d.refused ? () => send({ type: 'mobile.device.ack', id: d.id, what: 'refused' }) : undefined });
    }
    return out;
  }
  // The cursor opens on the row the state asks about: the account when it needs a sign-in, the state when offline, else the first.
  const wanted = (() => {
    if (!m || !m.enabled) return 0;
    const i = rows.findIndex(r => r.id === (m.signin || m.signinError || m.link.state === 'signed_out' || !m.account ? 'account' : m.link.state === 'offline' ? 'status' : 'access'));
    return Math.max(0, i);
  })();
  const kept = movedId === null ? -1 : rows.findIndex(r => r.id === movedId);
  const cur = Math.min(kept >= 0 ? kept : wanted, Math.max(0, rows.length - 1));
  // The row the state asked for becomes the kept one as soon as there is a row, so the cursor does not follow later changes of state.
  const curId = rows[cur]?.id;
  useEffect(() => { if (movedId === null && curId !== undefined) setMovedId(curId); }, [movedId, curId]);
  const device = rows[cur]?.id.startsWith('dev:') ? m?.devices.find(d => `dev:${d.id}` === rows[cur]!.id) : undefined;

  const submitRename = () => {
    if (!rename) return;
    const r = DeviceNameSchema.safeParse(rename.value);
    if (r.success && send({ type: 'mobile.device.rename', id: rename.id, name: r.data })) setRename(null);
  };

  const submitRelay = (value: string) => {
    const r = RelayUrlSchema.safeParse(value.trim());
    if (!r.success) { setRelay({ value, bad: true }); return; }
    if (m && send({ type: 'mobile.set', enabled: m.enabled, relayUrl: r.data })) setRelay(null);
  };

  useScreenKeys((input, key) => {
    if (relay || renamed) return true;
    if (revokable) {
      const d = m?.devices.find(x => x.id === revoking);
      if (input === 'y' && d && send({ type: 'mobile.device.revoke', id: d.id })) { tui.toast({ text: t.mobile.revokedT(deviceName(d)), tone: 'ok' }); setRevoking(null); }
      else if (input === 'n' || key.escape) setRevoking(null);
      return true;
    }
    if (m?.signin && key.escape) { send({ type: 'mobile.signin.cancel' }); return true; }
    if (m?.signin && input === 'c') { copyText(m.signin.userCode, s => stdout.write(s)); tui.toast({ text: t.mobile.copiedT, tone: 'ok' }); return true; }
    if (key.upArrow || input === 'k') { setMovedId(rows[Math.max(0, cur - 1)]?.id ?? null); return true; }
    if (key.downArrow || input === 'j') { setMovedId(rows[Math.min(rows.length - 1, cur + 1)]?.id ?? null); return true; }
    if (key.return || input === ' ') { rows[cur]?.action?.(); return true; }
    if (input === 'r' && device) { setRename({ id: device.id, value: deviceName(device) }); return true; }
    if (input === 'x' && device) { setRevoking(device.id); return true; }
    return false;
  });

  const k = t.mobile.keys;
  const hasDevice = rows.some(r => r.id.startsWith('dev:'));
  const keys: Array<[string, string]> = relay || renamed ? [['↵', k.save], ['esc', k.cancel]]
    : revokable ? [['y', k.yes], ['n', k.no]]
    : m?.signin ? [['c', k.copy], ['esc', k.cancel]]
    : rows.length ? [['j k', k.move], ['↵', k.open], ...(hasDevice ? [['r', k.rename], ['x', k.revoke]] as Array<[string, string]> : []), ['esc', k.back]] : [['esc', k.back]];
  const sel = (id: string) => rows[cur]?.id === id;

  return (
    <Frame crumb={t.mobile.title} keys={keys} noHelp>
      <TitledBox title={t.mobile.title} flexGrow={m && !service ? undefined : 1} paddingX={0}>
        {m === undefined ? <Line color={C.yellow}>{t.mobile.outdated}</Line>
          : m.link.state === 'unavailable' ? <><Line color={C.red}>{t.mobile.unavailable}</Line><Line color={C.red}>{m.link.error}</Line></>
          : <AccessBox m={m} now={now} sel={sel} relay={relay} setRelay={setRelay} submitRelay={submitRelay} />}
      </TitledBox>
      {m && !service ? <DevicesBox m={m} now={now} sel={sel} rename={renamed ? rename : null} setRename={setRename} submitRename={submitRename} revoking={revokable ? revoking : null} /> : null}
    </Frame>
  );
}

function Line({ color, children }: { color: string; children: ReactNode }) {
  return <Box paddingRight={1}><Text wrap="truncate"><Text> </Text><Text color={color}>{children}</Text></Text></Box>;
}

/** A row of the box: the cursor mark, the label, then the values; the selected row takes the selection's background. */
function Row({ selected, label, children, raw }: { selected: boolean; label: string; children: ReactNode; /** A field takes its own boxes: its content is not wrapped in one truncating line. */ raw?: boolean }) {
  return (
    <Box backgroundColor={selected ? C.sel : undefined} overflow="hidden">
      <Box flexShrink={0}><Text color={selected ? C.coral : C.faint}>{selected ? '▌' : ' '}</Text></Box>
      <Box flexShrink={0}><Text color={selected ? C.fg : C.dim}>{label.padEnd(LABEL)}</Text></Box>
      <Box flexGrow={1} flexShrink={1} overflow="hidden" paddingRight={1}>{raw ? children : <Text wrap="truncate">{children}</Text>}</Box>
    </Box>
  );
}

/** The lines hanging under a row, in the label's indent. */
const Under = ({ color, lines }: { color: string; lines: readonly string[] }) => <>{lines.map(l => <Box key={l} paddingRight={1}><Text wrap="truncate"><Text>{' '.repeat(LABEL + 1)}</Text><Text color={color}>{l}</Text></Text></Box>)}</>;

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
      <Box paddingRight={1}><Text wrap="truncate"><Text>{' '.repeat(LABEL + 1)}</Text><Text color={C.fg}>{c.flowAnd} </Text><Text color={C.yellow} bold>{m.signin.userCode}</Text></Text></Box>
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
    : <><Text color={C.faint}>○ </Text><Text color={C.fg}>{c.idle}</Text>{!m.signin && !m.signinError && !m.account && m.link.state !== 'signed_out' ? faint(`  ${c.idleH}`) : null}</>;

  return (
    <>
      <Row selected={sel('access')} label={c.access}>
        {m.enabled ? <><Text color={C.green}>● </Text><Text color={C.fg}>{c.on}</Text></> : <><Text color={C.faint}>○ </Text><Text color={C.fg}>{c.offW}</Text></>}{faint(`  ${c.accessH}`)}
      </Row>
      <Row selected={sel('relay')} label={c.relay} raw={relay !== null}>
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
