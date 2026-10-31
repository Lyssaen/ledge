import { useState } from 'react';
import type { Exchange } from '@ledge/protocol';
import { useLedgeThreadCopy } from './copy';
import { hhmm, seatName } from './threadModel';

/** A rig's exchanges between agents in one time window, folded or not: « factory · 3 échanges entre agents · 16:36 → 16:42 ». */
export function ExchangeGroup(p: { rigName: string; exchanges: readonly Exchange[]; missing: number; from: string; to: string; defaultOpen: boolean }) {
  const copy = useLedgeThreadCopy();
  const [open, setOpen] = useState(p.defaultOpen);
  const start = hhmm(p.from), end = hhmm(p.to);
  return (
    <section className="lt-group" data-open={open || undefined}>
      <header className="lt-group-head">
        <span className="lt-group-rig">{p.rigName}</span>
        <span className="lt-group-sum">{` · ${copy.exchanges.count(p.exchanges.length + p.missing)} · ${start === end ? start : `${start} → ${end}`}`}</span>
        <button type="button" className="lt-link lt-group-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? copy.exchanges.fold : copy.exchanges.unfold}<span aria-hidden>{open ? ' ▾' : ' ▸'}</span>
        </button>
      </header>
      {open && (
        <>
          <ul className="lt-group-list">
            {p.exchanges.map(x => (
              <li key={x.id} className="lt-exchange">
                <div className="lt-exchange-head">
                  <strong>{seatName(x.from)}</strong><span aria-hidden> → </span><strong>{seatName(x.to)}</strong>
                  <span className="lt-exchange-meta">{` · ${copy.exchanges.kind[x.kind]} · ${hhmm(x.at)}`}</span>
                </div>
                <div className="lt-exchange-text">{x.text}</div>
              </li>
            ))}
          </ul>
          {p.missing > 0 && <div className="lt-group-missing">{copy.exchanges.missing(p.missing)}</div>}
        </>
      )}
    </section>
  );
}
