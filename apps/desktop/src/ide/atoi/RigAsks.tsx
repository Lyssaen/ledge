import { useEffect, useRef, useState, type JSX } from 'react';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import type { HumanAsk, Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { AskCard, AskDone } from '../../asks/AskCard';
import { AskBanner } from '../../asks/AsksColumn';
import { DONE_MS, pillOf, sessionOfAsk, whoOf } from '../../asks/model';

const ALERT = ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'];
/** How long a card brought by the sidebar's « Voir » stays ringed. */
export const LIT_MS = 1500;

/** Whether the block shows at all: a request, the channel's banner (the rigs cannot write to the person), or a partial read. */
export const rigAsksShown = (view: OpenRigAsksView | undefined): boolean =>
  !!view && (view.asks.length > 0 || (!!view.channel && view.channel.state !== 'ready') || !!view.partial);

/** « Rigs OpenRig » of the page « À toi » (docs/mockups/ledge-ide-tasks-history.html, cards 10 to 13): one line per request, in the
 *  daemon's order; « Ouvrir » unfolds its whole card (AskCard) under it, one at a time, « Replier » folds it. The sidebar's « Voir »
 *  (`focus`) unfolds that card, brings it into view with the focus, ringed a moment. Once answered, the card shows its end, then the
 *  line goes. */
export function RigAsks({ view, sessions, machineLabel, focus, sourceOf, onOpenSeat }: {
  view: OpenRigAsksView; sessions: readonly Session[]; machineLabel: string;
  focus: { id: string; n: number } | null;
  sourceOf?(ask: HumanAsk): ((path: string) => void) | null;
  onOpenSeat?(sessionId: string): void;
}): JSX.Element {
  const { t } = useI18n();
  const a = t.atoiPage;
  const [open, setOpen] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlyMap<string, { ask: HumanAsk; end: 'sent' | 'already' }>>(new Map());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  // The sidebar's « Voir »: that card unfolded and ringed; AskCard itself scrolls to it and gives it the focus.
  const seen = useRef(0);
  useEffect(() => {
    if (!focus || focus.n === seen.current) return;
    seen.current = focus.n;
    setOpen(focus.id);
    setLit(focus.id);
    later(() => setLit(l => (l === focus.id ? null : l)), LIT_MS);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (ask: HumanAsk, end: 'sent' | 'already') => {
    setDone(d => new Map(d).set(ask.id, { ask, end }));
    later(() => { setDone(d => { const n = new Map(d); n.delete(ask.id); return n; }); setOpen(o => (o === ask.id ? null : o)); }, DONE_MS);
  };
  // The pushed list, plus the answered ones still showing their end after the push dropped them.
  const asks = [...view.asks, ...[...done.values()].filter(d => !view.asks.some(x => x.id === d.ask.id)).map(d => d.ask)];
  const banner = !!view.channel && view.channel.state !== 'ready';
  const count = view.asks.filter(x => !done.has(x.id)).length;
  return (
    <div className="fg-blk" data-block="rigs">
      <div className="fg-blk-h"><span className={`fg-dot ${count ? 'wait' : ''}`} aria-hidden="true" /><b>{a.rigs}</b><span className="fg-sub">{count ? `${count} · ${a.rigsSub}` : count}</span></div>
      <div className="fg-blk-b">
        <AskBanner channel={view.channel} machineLabel={machineLabel} />
        {!banner && view.partial && <span className="atoi-partial" role="status"><Icon d={ALERT} size={12} />{t.asks.partial}</span>}
        {asks.map(ask => {
          const session = sessionOfAsk(ask, sessions);
          const who = whoOf(ask, session);
          const d = done.get(ask.id);
          const unfolded = open === ask.id;
          const pill = pillOf(ask);
          return (
            <div key={ask.id} className="atoi-ask" data-ask={ask.id}>
              <div className="atoi-line">
                {ask.priority !== 'routine' && <span className="atoi-pill urgent">{t.asks.priority[ask.priority]}</span>}
                <span className="atoi-pill">{t.asks.pill[pill]}</span>
                <span className="grow"><b>{who.name}</b>{ask.from.rig ? ` · ${ask.from.rig}` : ''} — {ask.summary}</span>
                {!d && <button type="button" className="fg-btn" aria-expanded={unfolded} onClick={() => setOpen(unfolded ? null : ask.id)}>{unfolded ? a.fold : a.open}</button>}
              </div>
              {d ? <AskDone end={d.end} name={who.name} role={who.role} />
                : unfolded && (
                  <div className={`atoi-askc${lit === ask.id ? ' lit' : ''}`}>
                    <AskCard ask={ask} session={session} answer={view.answer} onDone={end => finish(ask, end)} focus={focus?.id === ask.id ? focus.n : 0}
                      {...(() => { const src = sourceOf?.(ask); return src ? { onSource: src } : {}; })()}
                      {...(onOpenSeat ? { onOpenSeat } : {})} />
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
