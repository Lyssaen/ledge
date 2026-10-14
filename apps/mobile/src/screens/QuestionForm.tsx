import { copy } from '../copy';
import { newOperationId } from '../model/operations';
import type { InboxItem } from '../model/requests';
import { mobileStore } from '../state/store';

/** The options of a question as radios, none preselected. The send button lives in the footer (`DecisionFooter`). */
export function QuestionForm({ options, value, onChange, disabled = false }: { options: string[]; value: number | null; onChange: (index: number) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="my-3.5 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{copy.question.legend}</legend>
      {options.map((o, i) => (
        <label key={i} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-3 text-[13px] has-[:checked]:border-fg/40 has-[:checked]:bg-raised has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info">
          <input type="radio" name="answer" value={i} checked={value === i} onChange={() => onChange(i)} className="size-4 flex-none accent-[#f2f1ed]" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{o}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Send the option the person chose: the agent reads its number. Never queued; the store refuses a second one. */
export function answer(item: InboxItem, index: number): void {
  const operationId = newOperationId();
  const text = String(index + 1);
  mobileStore.submit(
    { operationId, sessionId: item.sessionId, pendingId: item.pendingId, pendingVersion: item.pendingVersion, kind: 'answer', text, phase: 'sending', startedAt: new Date().toISOString() },
    { type: 'session.reply', id: item.sessionId, text, pendingId: item.pendingId, pendingVersion: item.pendingVersion, operationId }
  );
}
