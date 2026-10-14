import { useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import type { Device, PairErrorReason } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { relativeTime } from '../format';
import { Button } from '../ui/Button';

export interface MobileSettingsProps {
  state: { devices: Device[]; origin: string | null; listening: boolean } | null;
  pairing: { code: string; expiresAt: string; url: string } | null;
  pairError?: PairErrorReason | null;
  /** The daemon connection is open: the list is being requested; otherwise it is unavailable. */
  online?: boolean;
  now: () => number;
  onPair(): void;
  onRevoke(id: string): void;
}

const ENABLE_COMMAND = 'ledge mobile enable --origin https://<machine>.<tailnet>.ts.net';
const title = { fontSize: 14, lineHeight: '18px', fontWeight: 600 } as const;
const hint = { fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' } as const;

/** `481203` -> `481 203`. */
const grouped = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** The Mobile tab: the paired phones, and the pairing code (QR and digits) with its countdown. */
export function MobileSettings({ state, pairing, pairError, online = true, now, onPair, onRevoke }: MobileSettingsProps) {
  const { t } = useI18n();
  const m = t.settings.mobile;
  // The countdown and the "seen ago" labels move with the clock.
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  if (!state) return <div role="status" style={{ ...hint, padding: '12px 0' }}>{online ? m.loading : m.unavailable}</div>;
  const left = pairing ? Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now()) / 1000)) : 0;
  const live = pairing !== null && left > 0;
  return (
    <>
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--sidebar-border)' }}>
        <div style={title}>{m.title}</div>
        <div style={{ ...hint, marginTop: 3 }}>{m.hint}</div>
        {state.origin === null ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, lineHeight: '20px' }}>{m.enable}</div>
            <code className="mono" style={{ display: 'block', marginTop: 6, padding: '8px 10px', background: 'var(--well)', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: '18px', overflowWrap: 'anywhere', userSelect: 'all' }}>{ENABLE_COMMAND}</code>
            <div className="mono" style={{ ...hint, marginTop: 6 }}>{m.docs}</div>
          </div>
        ) : !pairing || !live ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <span style={{ ...hint, flexGrow: 1, color: pairError || pairing ? 'var(--warning)' : 'var(--muted-foreground)' }} role={pairError ? 'alert' : undefined}>{pairError ? m.errors[pairError] : pairing ? m.expired : m.pairHint}</span>
            <Button variant={pairing ? 'outline' : 'primary'} size="sm" onClick={onPair}>{pairing ? m.newCode : m.pair}</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <div role="img" aria-label={pairing.url} data-testid="pair-qr" style={{ width: 168, height: 168, padding: 8, boxSizing: 'border-box', background: '#fff', borderRadius: 'var(--radius-md)', lineHeight: 0 }}
              dangerouslySetInnerHTML={{ __html: renderSVG(pairing.url, { border: 0, whiteColor: '#fff', blackColor: '#000' }).replace('<svg ', '<svg width="152" height="152" aria-hidden="true" ') }} />
            <div className="mono" aria-label={m.codeLabel} style={{ fontSize: 28, lineHeight: '32px', fontWeight: 600, letterSpacing: '0.08em' }}>{grouped(pairing.code)}</div>
            <div style={hint} role="timer">{m.countdown(left)}</div>
            <div style={{ ...hint, textAlign: 'center' }}>{m.scan}</div>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 0' }}>
        <div style={title}>{m.devices}</div>
        {state.devices.length === 0 ? <div style={{ ...hint, marginTop: 3 }}>{m.none}</div> : (
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
            {state.devices.map(d => (
              <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, lineHeight: '18px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={hint}>{d.lastSeenAt ? m.lastSeen(relativeTime(d.lastSeenAt, now(), t)) : m.never}</span>
                </span>
                <Button variant="ghost" size="sm" aria-label={m.revokeLabel(d.name)} onClick={() => onRevoke(d.id)}>{m.revoke}</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
