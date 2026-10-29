import { useEffect, useState } from 'react';
import type { ModelRefusal, PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { effortLabel, modelLabel, running, samePick, type Pick } from '../model/modelChoice';
import { useMobile, type MobileStore } from '../state/store';
import { Button, chipClass } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { MODEL_TITLE_ID, ModelSheet } from '../ui/ModelSheet';

const NONE: { models: never[]; error?: true } = { models: [] };

/** What a session picks when it has a change waiting: that one, else what it runs. */
const upNext = (s: PhoneSession): Pick => s.modelNext ? { model: s.modelNext.model ?? null, effort: s.modelNext.effort ?? null } : running(s);

/** Whether the phone can change this session's model: the PC knows how, and the session was launched by Ledge. */
const available = (daemon: { models?: true } | null, s: PhoneSession): boolean => !!daemon?.models && s.canSwitch === true;

/** The chip at the head of the quick row: the session's model and effort, and the sheet that changes them. */
export function SessionModelChip({ store, session }: { store: MobileStore; session: PhoneSession }) {
  const { daemon, models } = useMobile(store);
  const [open, setOpen] = useState(false);
  const can = available(daemon, session);
  useEffect(() => { if (can) store.requestModels(session.tool); }, [can, store, session.tool]);
  if (!can) return null;
  const listing = models[session.tool] ?? NONE;
  const next = session.modelNext ? upNext(session) : null;
  const shown = next ?? running(session);
  const text = [modelLabel(session.tool, shown.model ?? undefined, listing.models), shown.effort ? effortLabel(shown.effort) : null].filter(Boolean).join(' · ');
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-label={copy.model.chip(next ? `${text}, ${copy.model.nextTurn}` : text)}
        onClick={() => { store.requestModels(session.tool); setOpen(true); }} className={`${chipClass()} gap-2 whitespace-nowrap`}>
        <span>{text}</span>
        {next && <span className="text-meta font-normal text-attention">{copy.model.nextTurn}</span>}
      </button>
      {open && <ChangeSheet store={store} session={session} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A late failure of the last change, in one line under the row; nothing without one. */
export function SessionModelNote({ store, session }: { store: MobileStore; session: PhoneSession }) {
  const { daemon, modelFailures } = useMobile(store);
  const reason: ModelRefusal | undefined = modelFailures[session.id];
  if (!available(daemon, session) || !reason) return null;
  return <p role="status" className="pb-2 text-meta text-attention">{copy.model.failedLine(copy.model.failed[reason])}</p>;
}

function ChangeSheet({ store, session, onClose }: { store: MobileStore; session: PhoneSession; onClose: () => void }) {
  const { models } = useMobile(store);
  const listing = models[session.tool] ?? NONE;
  const now = running(session);
  const [pick, setPick] = useState<Pick>(upNext(session));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const send = async (to: Pick) => {
    setBusy(true);
    setRefused(null);
    const done = await store.changeModel(session.id, to.model, to.effort);
    setBusy(false);
    if (done.status === 'applied') { onClose(); return; }
    const reason = done.status === 'rejected' ? done.reason : null;
    setRefused(reason && reason in copy.model.failed ? copy.model.failed[reason as ModelRefusal] : copy.model.notApplied);
  };
  const working = session.state === 'working';
  return (
    <Sheet labelledBy={MODEL_TITLE_ID} onClose={onClose}>
      <ModelSheet
        tool={session.tool} models={listing.models} error={listing.error} current={now} pick={pick} onPick={setPick}
        note={working ? copy.model.noteWorking(session.name) : copy.model.noteIdle(session.name)}
        actions={
          <>
            {refused && <p role="alert" className="text-meta text-attention">{refused}</p>}
            {session.modelNext && <Button variant="outline" disabled={busy} onClick={() => void send(now)}>{copy.model.cancelPending}</Button>}
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={onClose}>{copy.model.cancel}</Button>
              <Button variant="primary" className="flex-[2]" disabled={busy || samePick(pick, now)} onClick={() => void send(pick)}>{copy.model.apply}</Button>
            </div>
          </>
        }
      />
    </Sheet>
  );
}
