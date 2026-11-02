import { useState } from 'react';
import type { PhoneChatTask } from '@ledge/protocol';
import { copy } from '../../copy';
import type { MobileStore } from '../../state/store';
import { CARD, PRIMARY } from './RelayCard';

/**
 * A task Ledge proposes to give to a session. Once given it follows its task (« Confiée à Otto · t91b0d4 · prise »).
 */
function Row({ store, qid, row, task }: { store: MobileStore; qid: string; row: number; task: PhoneChatTask }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [applied, setApplied] = useState(false);
  const given = task.taskId !== undefined;
  const go = () => {
    setBusy(true); setFailed(false);
    void store.giveTask(qid, row).then(r => { if (r.status === 'applied') setApplied(true); else setFailed(true); }, () => setFailed(true)).finally(() => setBusy(false));
  };
  return (
    <section aria-label={copy.chat.task.label} className={CARD}>
      <p className="text-body"><span className="font-mono text-agent">{task.toName ?? task.to}</span> · <span className="font-semibold">{task.title}</span></p>
      {task.text && <p className="whitespace-pre-wrap break-words text-body text-fg/80">{task.text}</p>}
      {given && <p role="status" className="text-body text-ok">{copy.chat.task.given(task.ownerName ?? task.toName ?? task.to, task.taskId!, copy.chat.point.state[task.state ?? 'open'])}</p>}
      {!given && (failed || task.failed) && <p role="status" className="text-body text-danger-fg">{copy.chat.task.notGiven}</p>}
      {!given && (
        <div className="flex items-center gap-3">
          <button type="button" className={PRIMARY} disabled={busy || applied} onClick={go}>{copy.chat.task.give}</button>
        </div>
      )}
    </section>
  );
}

export function TaskCards({ store, qid, tasks }: { store: MobileStore; qid: string; tasks: PhoneChatTask[] }) {
  return <>{tasks.map((t, i) => <Row key={i} store={store} qid={qid} row={i} task={t} />)}</>;
}
