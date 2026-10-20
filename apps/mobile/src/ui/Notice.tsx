import type { ReactNode } from 'react';
import { copy } from '../copy';
import { useBusy } from '../useBusy';

const tones = { plain: 'border-line bg-surface', warning: 'border-attention/15 bg-attention/[0.045]', danger: 'border-danger-fg/15 bg-danger-bg' } as const;
export function Notice({ title, tone = 'plain', children, role }: { title: string; tone?: keyof typeof tones; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={`rounded-control border p-3.5 text-xs leading-[1.65] ${tones[tone]}`}>
      <strong className="mb-[5px] block text-[13px]">{title}</strong>
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
        <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium disabled:opacity-45">
          {busy ? copy.link.reconnecting : copy.link.reconnect}
        </button>
      )}
    </Notice>
  );
}
