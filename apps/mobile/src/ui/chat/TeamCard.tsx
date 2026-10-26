import { useState } from 'react';
import type { PhoneChatTeam } from '@ledge/protocol';
import { copy } from '../../copy';
import { href } from '../../router';
import type { MobileStore } from '../../state/store';
import { Flag, RolePill } from '../teams/RolePill';
import { CARD, GHOST, PRIMARY } from './RelayCard';

type Note = 'failed' | 'cancelled' | 'expired';
const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * The team Ledge proposes (roles spec §3.8): its name, the room it sits in, its seats with what they run and their
 * autonomy. Launching it is an accept like a launch card's: the device's own check confirms it.
 */
export function TeamCard({ store, qid, team, canConfirm }: { store: MobileStore; qid: string; team: PhoneChatTeam; canConfirm: boolean }) {
  const [hidden, setHidden] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const done = team.teamId !== undefined;
  if (hidden && !done) return null;
  const go = () => {
    setBusy(true); setNote(null);
    void store.launchTeam(qid).then(r => { if (r.status === 'applied') setApplied(true); else if (r.status === 'cancelled' || r.status === 'expired') setNote(r.status); else setNote('failed'); }, () => setNote('failed')).finally(() => setBusy(false));
  };
  const auto = team.seats.filter(s => s.autonomy === 'auto').map(s => `@${s.role}`);
  const shown: Note | null = team.failed ? 'failed' : note;
  return (
    <section aria-label={copy.chat.team.label} className={CARD}>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <span className="text-muted">{copy.chat.team.team}</span>
        <div><span className="flex items-center gap-1.5 font-semibold"><Flag />{team.name}</span>{!done && <span className="text-xs text-muted">{copy.chat.team.newTable(team.project)}</span>}</div>
        <span className="text-muted">{copy.chat.team.seats}</span>
        <ul className="flex flex-col gap-1">
          {team.seats.map(s => (
            <li key={s.role} className="flex flex-wrap items-center gap-1.5">
              <span>{s.label}</span><RolePill role={s.role} />
              <span className="text-muted">{[copy.tools[s.tool], s.model].filter(Boolean).join(' · ')} · <span className={s.autonomy === 'auto' ? 'text-attention' : s.autonomy === 'edits' ? 'text-info' : ''}>{copy.chat.team.autonomy[s.autonomy ?? 'ask']}</span></span>
            </li>
          ))}
        </ul>
      </div>
      {!done && auto.length > 0 && <p role="note" className="text-[13px] text-attention">{copy.chat.team.autoWarning(auto.join(', '))}</p>}
      {done && (
        <div role="status" className="border-t border-line pt-2.5">
          <p className="text-[13px] text-ok">✓ {copy.chat.team.launched(time(team.launchedAt ?? new Date().toISOString()))}</p>
          <p className="text-xs text-muted">{copy.chat.team.byKey} · <a href={href({ name: 'agents' })} className="text-info underline underline-offset-2">{copy.chat.team.openAgents}</a></p>
        </div>
      )}
      {!done && shown && <p role="status" className={`text-[13px] ${shown === 'failed' ? 'text-danger-fg' : 'text-muted'}`}>{shown === 'failed' ? copy.chat.team.notLaunched : copy.confirm[shown]}</p>}
      {!done && !canConfirm && (
        <p className="text-[13px] text-attention">{copy.chat.launchSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>
      )}
      {!done && (
        <div className="flex gap-2">
          {!applied && <button type="button" className={GHOST} onClick={() => setHidden(true)}>{copy.chat.ignore}</button>}
          <button type="button" className={PRIMARY} disabled={busy || applied || !canConfirm} onClick={go}>{copy.chat.team.launch}</button>
        </div>
      )}
    </section>
  );
}
