import type { PhoneSession } from '@ledge/protocol';
import { useState } from 'react';
import { copy } from '../copy';
import { closeHeld } from '../model/sessionEnd';
import { dotOf } from '../model/sessions';
import { useMobile, type MobileStore } from '../state/store';
import { iconButtonClass } from '../ui/Button';
import { BackLink } from '../ui/Header';
import { Icon } from '../ui/icons';
import { DetailHeader } from '../ui/kit/Controls';
import { useNow } from '../useNow';
import { EndSheet } from './SessionClose';
import { ChangeSheet, available as modelSwitchable } from './SessionModel';
import { SessionMore } from './SessionMore';
import { ViewToggle } from './Thread';

/**
 * The head the terminal shares with the thread (m2-sessions.html §3, §6): back, the runtime, the name and its dot, « Fil · Terminal »,
 * and « Plus d'actions » with the sheets it opens (Modèle et effort, Fermer).
 */
export function SessionHead({ store, session, current, onLeave, onReconnect, display, model: modelOpen, onModel }: {
  store: MobileStore; session: PhoneSession; current: 'thread' | 'terminal'; onReconnect?: (() => void) | undefined;
  /** Before « Fil · Terminal » goes to the other view: it keeps this one's place. */ onLeave?: (() => void) | undefined;
  /** « Affichage » in « Plus d'actions », when the terminal shows. */ display?: { value: string; onToggle: () => void } | undefined;
  /** « Modèle et effort » opened from outside (the session's foot), and how it closes. */ model?: boolean; onModel?: ((open: boolean) => void) | undefined;
}) {
  const state = useMobile(store);
  const now = useNow();
  const [more, setMore] = useState(false);
  const [ownModel, setOwnModel] = useState(false);
  const model = modelOpen ?? ownModel;
  const setModel = onModel ?? setOwnModel;
  const [closing, setClosing] = useState(false);
  const dot = dotOf(session);
  const closable = !!state.daemon?.sessionClose && !session.readOnly;
  const shut = closeHeld(session, state.ops, state.daemon?.boot ?? null, now);
  return (
    <>
      <DetailHeader
        back={<BackLink fallback={{ name: 'sessions' }} label={copy.thread.back} />}
        tool={session.tool} name={session.name} dot={dot} pulse={dot === 'work' && state.fresh}
        more={<>
          <ViewToggle sessionId={session.id} current={current} {...(onLeave ? { onLeave } : {})} />
          <button type="button" aria-haspopup="dialog" aria-label={copy.sessions.moreOf(session.name)} title={copy.sessions.more} onClick={() => setMore(true)} className={iconButtonClass({ className: more ? 'bg-raised text-fg' : 'text-muted' })}>
            <Icon name="more" />
          </button>
        </>}
      />
      {more && <SessionMore store={store} session={session} closable={closable} closing={shut} onClose={() => setMore(false)}
        onModel={() => { setMore(false); setModel(true); }} onCloseSession={() => { setMore(false); setClosing(true); }}
        display={display && { value: display.value, onToggle: () => { display.onToggle(); setMore(false); } }} />}
      {model && modelSwitchable(state.daemon, session) && <ChangeSheet store={store} session={session} onClose={() => setModel(false)} />}
      {closing && <EndSheet store={store} session={session} mode="close" onClose={() => setClosing(false)} onSent={() => setClosing(false)} onReconnect={onReconnect} />}
    </>
  );
}
