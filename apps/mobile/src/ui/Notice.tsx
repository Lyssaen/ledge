import { useEffect, useState } from 'react';
import { copy } from '../copy';
import type { ReactNode } from 'react';

const tones = { plain: 'border-line bg-surface', warning: 'border-attention/15 bg-attention/[0.045]', danger: 'border-danger-fg/15 bg-danger-bg' } as const;
export function Notice({ title, tone = 'plain', children, role }: { title: string; tone?: keyof typeof tones; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={`rounded-control border p-3.5 text-xs leading-[1.65] ${tones[tone]}`}>
      <strong className="mb-[5px] block text-[13px]">{title}</strong>
      {children}
    </div>
  );
}

/** « Connexion au PC perdue » with the way back; shown only while the link is down. */
export function LostBanner({ detail, onReconnect }: { detail: string; onReconnect: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 4000);
    return () => clearTimeout(t);
  }, [busy]);
  return (
    <Notice title={copy.link.lostTitle} tone="warning">
      <p>{detail}</p>
      <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium disabled:opacity-45">
        {busy ? copy.link.reconnecting : copy.link.reconnect}
      </button>
    </Notice>
  );
}
