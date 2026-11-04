import { useId, useState } from 'react';
import type { BrainChoice, PhoneTask } from '@ledge/protocol';
import { copy } from '../../copy';
import type { MobileStore } from '../../state/store';
import { buttonClass } from '../Button';
import { Tag } from '../Tag';

const YES = buttonClass({ variant: 'primary', size: 'sm', className: 'min-w-[64px] flex-none' });
const SMALL = buttonClass({ size: 'sm', className: 'min-w-[64px] flex-none' });
const FIELD = 'w-full rounded-control border border-line bg-surface px-2.5 py-2 text-body text-fg';
const one = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/**
 * A proposal about the user's notes in « Le point » (docs/mockups/ledge-brain-notes.html, part 2): the fact as it will be written,
 * its source, then the same buttons as the PC's. « Refuser » goes at once; a « yes » asks for the device's check over that exact
 * choice (the PC refuses it otherwise).
 */
export function NoteProposal({ task, store, fresh }: { task: PhoneTask & { brain: NonNullable<PhoneTask['brain']> }; store: MobileStore; fresh: boolean }) {
  const P = copy.chat.point.note;
  const p = task.brain;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.fact);
  const [title, setTitle] = useState(p.title ?? p.note);
  const [when, setWhen] = useState(p.when ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (yes: boolean) => {
    setBusy(true); setError(null);
    const fact = one(text);
    const choice: BrainChoice = !yes ? { yes } : {
      yes, ...(fact && fact !== p.fact ? { text: fact } : {}),
      ...(p.create && one(title) ? { title: one(title) } : {}), ...(p.create && one(when) ? { when: one(when) } : {})
    };
    const r = await store.answerNote(task.id, choice);
    setBusy(false);
    if (r.status === 'applied') return;
    setError(r.status === 'rejected' && r.reason === 'confirm_required' ? P.confirmRequired : r.status === 'rejected' && r.reason === 'stale' ? P.stale
      : r.status === 'cancelled' ? P.cancelled : r.status === 'expired' ? P.expired : P.failed);
  };
  const head = p.kind === 'flag' ? P.flag(p.note) : p.create ? P.create(p.note) : P.add(p.note);
  const off = !fresh || busy;
  return (
    <div className="flex flex-col gap-2 rounded-control bg-raised p-2.5" data-note-proposal={task.id}>
      <span className="flex flex-wrap items-center gap-1.5 text-body">
        <Tag tone="attention" label={P.tag} />
        <span className="font-medium">{task.giverName ?? copy.chat.point.someone}</span><span className="text-muted">{head}</span>
      </span>
      {p.create && (
        <>
          <label htmlFor={`${id}t`} className="flex flex-col gap-1 text-small text-muted">{P.titleField}<input id={`${id}t`} className={FIELD} value={title} disabled={off} onChange={e => setTitle(e.target.value)} /></label>
          <label htmlFor={`${id}w`} className="flex flex-col gap-1 text-small text-muted">{P.whenField}<input id={`${id}w`} className={FIELD} value={when} disabled={off} onChange={e => setWhen(e.target.value)} /></label>
        </>
      )}
      {editing
        ? <label htmlFor={`${id}f`} className="flex flex-col gap-1 text-small text-muted">{P.field}<textarea id={`${id}f`} className={FIELD} rows={3} value={text} disabled={off} onChange={e => setText(e.target.value)} /></label>
        : <p className="m-0 whitespace-pre-wrap break-words rounded-control bg-surface px-2.5 py-2 text-body">{p.fact}</p>}
      {p.source && !editing && <span className="break-words text-small text-muted">{P.source(p.source)}</span>}
      {error && <p role="alert" className="m-0 text-small text-approval">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {p.kind === 'flag' ? <>
          <button type="button" className={YES} disabled={off} onClick={() => { void send(true); }}>{P.mark}</button>
          <button type="button" className={SMALL} disabled={off} onClick={() => { void send(false); }}>{P.ignore}</button>
        </> : editing ? <>
          <button type="button" className={YES} disabled={off || !one(text)} onClick={() => { void send(true); }}>{P.editYes}</button>
          <button type="button" className={SMALL} disabled={off} onClick={() => { setEditing(false); setText(p.fact); }}>{P.cancel}</button>
        </> : <>
          <button type="button" className={YES} disabled={off} onClick={() => { void send(true); }}>{p.create ? P.createYes : P.yes}</button>
          <button type="button" className={SMALL} disabled={off} onClick={() => setEditing(true)}>{P.edit}</button>
          <button type="button" className={SMALL} disabled={off} onClick={() => { void send(false); }}>{P.no}</button>
        </>}
      </div>
    </div>
  );
}
