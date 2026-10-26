import { useState } from 'react';
import type { PhoneChatTask } from '@ledge/protocol';
import { copy } from '../../copy';
import type { MobileStore } from '../../state/store';
import { CARD, PRIMARY } from './RelayCard';

/**
 * A task Ledge proposes to give to a seat. Under a team card that is not launched yet it waits for it; once given it
 * follows its task (« Confiée à Otto · t91b0d4 · prise »).
 */
function Row({ store, qid, row, task, waiting }: { store: MobileStore; qid: string; row: number; task: PhoneChatTask; waiting: boolean }) {
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
      <p className="text-[13px]"><span className="font-mono text-role">{task.toName ?? task.to}</span> · <span className="font-semibold">{task.title}</span></p>
      {task.text && <p className="whitespace-pre-wrap break-words text-[13px] text-[#c8cbce]">{task.text}</p>}
      {given && <p role="status" className="text-[13px] text-ok">{copy.chat.task.given(task.ownerName ?? task.toName ?? task.to, task.taskId!, copy.chat.point.state[task.state ?? 'open'])}</p>}
      {!given && (failed || task.failed) && <p role="status" className="text-[13px] text-danger-fg">{copy.chat.task.notGiven}</p>}
      {!given && (
        <div className="flex items-center gap-3">
          <button type="button" className={PRIMARY} disabled={busy || applied || waiting} onClick={go}>{copy.chat.task.give}</button>
          {waiting && <span className="text-xs text-muted">{copy.chat.task.waitTeam}</span>}
        </div>
      )}
    </section>
  );
}

export function TaskCards({ store, qid, tasks, waiting }: { store: MobileStore; qid: string; tasks: PhoneChatTask[]; waiting: boolean }) {
  return <>{tasks.map((t, i) => <Row key={i} store={store} qid={qid} row={i} task={t} waiting={waiting} />)}</>;
}
