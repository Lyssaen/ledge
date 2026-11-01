import { useEffect, useState } from 'react';
import type { PhoneTeam } from '@ledge/protocol';
import { copy } from '../copy';
import { roleFor } from '../model/catalog';
import { isBusy, modelLabel, samePick, type Pick } from '../model/modelChoice';
import { outcomeNote, seatModelNote, type OutcomeNote } from '../model/teamsOutcome';
import { useMobile, type MobileStore } from '../state/store';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { MODEL_TITLE_ID, ModelSheet } from '../ui/ModelSheet';
import { seatOut, seatsOfTeam } from './TeamEditor';

const NONE: { models: never[]; error?: true } = { models: [] };

/**
 * « Changer » on a live team's seat: the seat's model and effort. They are saved on the seat (a composition, one passkey) and, when
 * a session holds the seat and Ledge can switch it, applied to that session too. The tool is shown, not changed here.
 */
export function SeatModelSheet({ store, team, role, onClose }: { store: MobileStore; team: PhoneTeam; role: string; onClose: () => void }) {
  const { catalog, sessions, models } = useMobile(store);
  const seat = team.seats.find(s => s.role === role);
  const def = catalog ? roleFor(catalog, team.project, role) : undefined;
  const tool = seat?.tool ?? def?.tool ?? 'claude';
  const holder = seat?.sessionId ? sessions.get(seat.sessionId) : undefined;
  const canSwitch = holder?.canSwitch === true;
  const current: Pick = { model: seat?.model ?? def?.model ?? null, effort: seat?.effort ?? def?.effort ?? null };
  const listing = models[tool] ?? NONE;
  const [pick, setPick] = useState<Pick>(current);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<OutcomeNote | null>(null);
  useEffect(() => { store.requestModels(tool); }, [store, tool]);

  const apply = async () => {
    setBusy(true); setDone(null); setFailed(null);
    // The saved composition, this seat's model and effort replaced; « Par défaut » removes the seat's own value.
    const seats = seatsOfTeam(team).map(s => {
      if (s.role !== role) return seatOut(s);
      const { model: _m, effort: _e, ...rest } = s;
      return seatOut({ ...rest, ...(pick.model !== null ? { model: pick.model } : {}), ...(pick.effort !== null ? { effort: pick.effort } : {}) });
    });
    const r = await store.teamOp({ type: 'team.compose', team: team.id, seats }).catch(() => null);
    setBusy(false);
    if (r?.status === 'applied') setDone(seatModelNote(r.models, role, holder?.name ?? '', canSwitch));
    else setFailed(r ? outcomeNote(r, copy.teams.team.notSaved, { invalid: copy.teams.team.notSaved, changed: copy.teams.team.composeChanged }) : { text: copy.teams.team.notSaved, quiet: false });
  };

  const s = copy.model.seat;
  const working = holder?.state === 'working';
  // The PC applies at once only to a free agent: one waiting on a request gets it at the end of its turn too.
  const note = holder && canSwitch
    ? `${s.saved}\n${isBusy(holder) ? s.nowWorking(holder.name) : s.now(holder.name)}`
    : `${s.saved}\n${s.later}`;
  const label = def?.label ?? `@${role}`;
  return (
    <Sheet labelledBy={MODEL_TITLE_ID} onClose={() => { if (!busy) onClose(); }}>
      <p className="text-small text-muted [overflow-wrap:anywhere]">
        <span className="font-mono text-role">@{role}</span> · {holder ? s.heldBy(label, holder.name, working) : label}
      </p>
      <div className="flex items-center justify-between gap-2 rounded-control bg-surface px-3 py-2.5">
        <span className="text-body font-medium">{s.tool}</span>
        <span className="text-right text-body">{copy.tools[tool as keyof typeof copy.tools] ?? tool}{holder && <span className="block text-meta text-muted">{s.toolRestart}</span>}</span>
      </div>
      <ModelSheet
        tool={tool} models={listing.models} error={listing.error} current={current} pick={pick} onPick={setPick}
        note={note} {...(def?.model ? { defaultHint: s.roleDefault(modelLabel(tool, def.model, listing.models)) } : {})}
        actions={
          <>
            {done && <p role="status" className="text-body">{done}</p>}
            {failed && <p role="alert" className={`text-body ${failed.quiet ? 'text-muted' : 'text-danger-fg'}`}>{failed.text}</p>}
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{done ? s.close : copy.model.cancel}</Button>
              <Button variant="primary" className="flex-[2]" disabled={busy || done !== null || samePick(pick, current)} onClick={() => void apply()}>{copy.model.apply}</Button>
            </div>
            <p className="text-center text-small text-muted">{s.passkey}{holder && canSwitch && ` ${s.restarts(holder.name)}`}</p>
          </>
        }
      />
    </Sheet>
  );
}
