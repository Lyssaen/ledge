import type { ReactNode } from 'react';
import { copy } from '../copy';
import { useBusy } from '../useBusy';
import { buttonClass } from './Button';

const tones = { plain: 'border-line bg-surface', warning: 'border-attention/25 bg-attention/[0.06]', approval: 'border-approval/25 bg-approval/[0.06]', danger: 'border-danger-fg/25 bg-danger-bg' } as const;
export function Notice({ title, tone = 'plain', children, role }: { title: string; tone?: keyof typeof tones; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={`rounded-control border p-3.5 text-small leading-[1.65] ${tones[tone]}`}>
      <strong className="mb-[5px] block text-body">{title}</strong>
      {children}
    </div>
  );
}

/**
 * « PC hors ligne »: what is shown is the last known state. The way back is offered only when the screen is given
 * one; the link reconnects on its own either way.
 */
export function OfflineBanner({ onReconnect }: { onReconnect?: (() => void) | undefined }) {
  const [busy, setBusy] = useBusy();
  return (
    <Notice title={copy.offline.pcOffline} tone="warning" role="status">
      <p>{copy.link.lostBody}</p>
      {onReconnect && (
        <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className={buttonClass({ block: true, className: 'mt-3' })}>
          {busy ? copy.link.reconnecting : copy.link.reconnect}
        </button>
      )}
    </Notice>
  );
}
