import { useEffect, useRef, useState, type JSX } from 'react';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import type { HumanAsk, Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { AskCard, AskDone } from './AskCard';
import { ASK_SECTIONS, bySection, DONE_MS, sectionOf, sessionOfAsk, whoOf, type AskSection } from './model';

const ALERT = ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'];

/** A card that has answered, kept as its one-line end for `DONE_MS` even once the pushed list no longer has it. */
type Done = { ask: HumanAsk; end: 'sent' | 'already' };

/**
 * OpenRig's asks in « À toi » (docs/mockups/ledge-human-operator-ab-lot1.html): the channel's banner when the rigs cannot reach the
 * person, then « Décisions », « Questions », « Nouvelles », each in the daemon's order (critical, urgent, then the most recent).
 */
export function AsksColumn({ view, sessions, machineLabel, focus, onSource, onOpenSeat }: {
  view: OpenRigAsksView; sessions: readonly Session[]; machineLabel: string;
  /** The ask « Voir » (sidebar) brings into view, and how many times it was asked. */
  focus?: { id: string; n: number } | null;
  onSource?(ask: HumanAsk, path: string): void;
  onOpenSeat?(sessionId: string): void;
}): JSX.Element | null {
  const { t } = useI18n();
  const a = t.asks;
  const [done, setDone] = useState<ReadonlyMap<string, Done>>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  const finish = (ask: HumanAsk, end: 'sent' | 'already') => {
    setDone(d => new Map(d).set(ask.id, { ask, end }));
    timers.current.set(ask.id, setTimeout(() => {
      timers.current.delete(ask.id);
      setDone(d => { const n = new Map(d); n.delete(ask.id); return n; });
    }, DONE_MS));
  };

  const channel = view.channel;
  const banner = channel && channel.state !== 'ready' ? (() => {
    const c = a.channel;
    // The command or the reason OpenRig gives, as is, on its own line (unreachable, no_default).
    const [title, body, tone, mono] = channel.state === 'no_person' ? [c.no_person.title, c.no_person.body, 'err', '']
      : channel.state === 'no_default' ? [c.no_default.title, c.no_default.body, 'err', channel.message ?? '']
      : channel.state === 'openrig_stopped' ? [c.openrig_stopped.title, c.openrig_stopped.body, 'warn', '']
      : channel.state === 'unreachable' ? [c.unreachable.title, '', 'warn', channel.message ?? '']
      : [c.not_installed.title(machineLabel), c.not_installed.body, '', ''];
    return (
      <div className={cls('ask-banner', tone && `ask-banner-${tone}`)} role="status" data-channel={channel.state}>
        <Icon d={ALERT} size={16} />
        <div className="ask-banner-text"><b>{title}</b>{body && <p>{body}</p>}{mono && <p className="ask-mono">{mono}</p>}</div>
      </div>
    );
  })() : null;

  // The pushed list, plus the cards still showing their end after the push dropped them, in their section.
  const groups = bySection(view.asks);
  const gone = [...done.values()].filter(d => !view.asks.some(x => x.id === d.ask.id));
  for (const d of gone) groups[sectionOf(d.ask)].push(d.ask);
  const shown = ASK_SECTIONS.filter(s => groups[s].length > 0);
  if (!banner && shown.length === 0 && !view.partial) return null;
  const count = (s: AskSection) => groups[s].filter(x => !done.has(x.id)).length;
  return (
    <div className="ask-col" aria-label={t.side.yours}>
      {banner}
      {!banner && view.partial && <p className="ask-partial" role="status"><Icon d={ALERT} size={12} />{a.partial}</p>}
      {shown.map(s => (
        <section key={s} className="ask-sec" aria-label={a.sections[s]}>
          <h4 className="ask-sec-title">{a.sections[s]}{count(s) > 0 && <b className={cls('ask-n', s === 'updates' && 'neutral')}>{count(s)}</b>}</h4>
          {groups[s].map(ask => {
            const session = sessionOfAsk(ask, sessions);
            const d = done.get(ask.id);
            if (d) { const w = whoOf(ask, session); return <AskDone key={ask.id} end={d.end} name={w.name} role={w.role} />; }
            return (
              <AskCard key={ask.id} ask={ask} session={session} answer={view.answer} onDone={end => finish(ask, end)}
                focus={focus?.id === ask.id ? focus.n : 0}
                {...(onSource ? { onSource: (path: string) => onSource(ask, path) } : {})}
                {...(onOpenSeat ? { onOpenSeat } : {})} />
            );
          })}
        </section>
      ))}
    </div>
  );
}
