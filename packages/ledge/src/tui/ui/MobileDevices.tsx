import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { MobileState } from '@ledge/protocol';
import { useTui } from '../context.js';
import { clock } from '../model/time.js';
import { deviceGlyph, deviceName, deviceWord, sameDay, seenText, shortDate, waitingPairings, whenAt } from '../model/mobile.js';
import { C } from '../theme.js';
import { TextInput } from './TextInput.js';
import { TitledBox } from './TitledBox.js';

type Device = MobileState['devices'][number];
export type DeviceField = { id: string; value: string };

const NAME = 18;
const host = (url: string): string => { try { return new URL(url).host; } catch { return url; } };

/** One line of the box: the cursor mark, then the content; the selected row takes the selection's background. */
function Line({ selected, children }: { selected?: boolean; children: ReactNode }) {
  return (
    <Box backgroundColor={selected ? C.sel : undefined} overflow="hidden">
      <Text color={selected ? C.coral : C.faint}>{selected ? '▌' : ' '}</Text>
      <Box flexGrow={1} flexShrink={1} overflow="hidden" paddingRight={1}>{children}</Box>
    </Box>
  );
}

/** A line hanging under a device in its indent; it never takes the cursor. */
const Under = ({ color, children }: { color: string; children: string }) => <Box paddingRight={1}><Text wrap="truncate"><Text>{'   '}</Text><Text color={color}>{children}</Text></Text></Box>;

/** The keys that answer a well, as the mockup draws them: ↵ the acknowledgement, x the revocation. */
function Answers({ ack, revoke }: { ack: string; revoke: string }) {
  return <Text wrap="truncate"><Text color={C.faint}>{'   ↵ '}</Text><Text color={C.fg} underline>{ack}</Text><Text color={C.faint}>{'   x '}</Text><Text color={C.fg}>{revoke}</Text></Text>;
}

/** The second box, « APPAREILS · N »: a blocked recovery, the pairings waiting, then the devices, each with what the daemon says of it. */
export function DevicesBox({ m, now, sel, rename, setRename, submitRename, revoking }: {
  m: MobileState; now: number; sel(id: string): boolean;
  rename: DeviceField | null; setRename(f: DeviceField | null): void; submitRename(): void; revoking: string | null;
}) {
  const { t, g, lang } = useTui();
  const c = t.mobile;
  const faint = (s: string) => <Text color={C.faint}>{s}</Text>;
  const title = m.devices.length ? c.devices(m.devices.length) : c.devicesNone;

  if (!m.enabled) {
    return (
      <TitledBox title={title} flexGrow={1} paddingX={0}>
        <Line><Text color={C.faint} wrap="truncate">{c.offWell}</Text></Line>
        {m.devices.map(d => <Line key={d.id}><Text color={C.faint} wrap="truncate">{deviceGlyph(d.kind, g, d.label)} {deviceName(d)}</Text></Line>)}
      </TitledBox>
    );
  }

  const blocked = m.recovery?.blocked;
  const pairings = waitingPairings(m);
  const when = (iso: string) => (sameDay(Date.parse(iso), now) ? clock(iso) : `${shortDate(iso, lang)} ${clock(iso)}`);

  const device = (d: Device) => {
    const name = deviceName(d);
    const glyph = deviceGlyph(d.kind, g, d.label);
    const selected = sel(`dev:${d.id}`);
    if (rename?.id === d.id) {
      return (
        <Line key={d.id} selected>
          <Text color={C.fg}>{glyph} </Text><Text color={C.dim}>{c.nameLabel} </Text>
          <Box flexShrink={1} overflow="hidden"><Text color={C.fg}>[ </Text><Box minWidth={22}><TextInput value={rename.value} onChange={v => setRename({ id: d.id, value: v })} onSubmit={submitRename} onEscape={() => setRename(null)} active /></Box><Text color={C.fg}> ]</Text></Box>
          <Box flexShrink={0}>{faint(`  ↵ ${c.keys.save}  esc ${c.keys.cancel}`)}</Box>
        </Line>
      );
    }
    if (revoking === d.id) {
      return <Line key={d.id} selected><Text color={C.fg}>{glyph} </Text><Text color={C.red} wrap="truncate">{c.revokeAsk(name)}</Text><Box flexShrink={0}><Text color={C.fg} bold>{'  y / n'}</Text></Box></Line>;
    }
    const word = deviceWord(d)!;
    const seen = seenText(d, now, c, t.time);
    const linked = Date.parse(d.approvedAt) > 0 ? c.linkedOn(shortDate(d.approvedAt, lang)) : '';
    const pending = d.recovered?.pending === true;
    const tag = pending ? <Text color={C.blue} bold>{` ${c.recTag} `}</Text> : d.refused ? <Text color={C.yellow} bold>{` ${c.attTag} `}</Text> : null;
    // A name hides the model, which comes back first in the hint.
    const hint = tag ? `  ${seen}` : [d.name ? d.label : '', linked, seen].filter(Boolean).join(' · ');
    return (
      <Box key={d.id} flexDirection="column">
        <Line selected={selected}>
          <Text color={C.fg}>{glyph} </Text>
          <Box width={NAME} flexShrink={0}><Text color={C.fg} wrap="truncate">{name}</Text></Box>
          {tag ? <Box flexShrink={0}>{tag}</Box> : null}
          <Box flexGrow={1} flexShrink={1} overflow="hidden"><Text color={C.faint} wrap="truncate">{hint}</Text></Box>
        </Line>
        {pending ? <>{c.recWell(word).map(l => <Under key={l} color={C.blue}>{l}</Under>)}<Answers ack={c.recAck} revoke={c.keys.revoke} /></> : null}
        {d.refused ? <>{c.attWell(whenAt(d.refused.at, now, c, lang), word).map(l => <Under key={l} color={C.yellow}>{l}</Under>)}<Answers ack={c.attAck} revoke={c.keys.revoke} /></> : null}
      </Box>
    );
  };

  return (
    <TitledBox title={title} flexGrow={1} paddingX={0}>
      {blocked ? (
        <>
          <Line selected={sel('blocked')}><Text color={C.red} wrap="truncate">{g.linkBlocked} {c.blocked(blocked.failures, when(blocked.since))[0]}</Text></Line>
          {c.blocked(blocked.failures, when(blocked.since)).slice(1).map(l => <Under key={l} color={C.red}>{l}</Under>)}
          <Text wrap="truncate"><Text color={C.faint}>{'   ↵ '}</Text><Text color={C.fg} underline>{c.unblock}</Text></Text>
        </>
      ) : null}
      {pairings.map(p => (
        <Line key={p.id} selected={sel(`pair:${p.id}`)}>
          <Text color={C.yellow}>{g.linkAsks} </Text>
          <Text color={sel(`pair:${p.id}`) ? C.fg : C.yellow} bold={sel(`pair:${p.id}`)} wrap="truncate">{`${p.label} ${c.asks}`}</Text>
          <Box flexShrink={0}>{faint(`   ↵ ${c.compare}`)}</Box>
        </Line>
      ))}
      {m.devices.map(device)}
      {m.devices.length === 0 && !blocked && pairings.length === 0 ? c.empty(host(m.relayUrl)).map(l => <Line key={l}><Text color={C.dim} wrap="truncate">{l}</Text></Line>) : null}
    </TitledBox>
  );
}
