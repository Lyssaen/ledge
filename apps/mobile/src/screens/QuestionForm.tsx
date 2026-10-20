import type { AskQuestion } from '@ledge/protocol';
import { copy } from '../copy';
import { OTHER_MAX, type FreeAnswerProblem } from '../model/freeAnswer';

/**
 * The options of a question as radios, none preselected, then « Autre réponse » with its field when the tool takes a
 * free answer (`other`). The free answer is the radio after the last option (`value === options.length`); a question
 * without options shows the field alone. The send button lives in the footer (`DecisionFooter`).
 */
export function QuestionForm({ options, value, onChange, disabled = false, botName, other, onSubmit }: {
  options: string[]; value: number | null; onChange: (index: number) => void; disabled?: boolean;
  botName: string;
  /** Enter in the free answer: the field holds one line, so Enter sends rather than breaking it. */
  onSubmit?: (() => void) | undefined;
  /** Present when the tool accepts a free answer: the text typed so far and what stops it from being sent. */
  other?: { text: string; onText: (t: string) => void; problem: FreeAnswerProblem | null } | undefined;
}) {
  const otherIndex = options.length;
  const fieldOnly = options.length === 0;
  const choosingOther = other !== undefined && (fieldOnly || value === otherIndex);
  const showProblem = choosingOther && other.problem !== null && other.problem !== 'empty';
  const radio = 'flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-3 text-[13px] has-[:checked]:border-fg/40 has-[:checked]:bg-raised has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info';
  return (
    <fieldset disabled={disabled} className="my-3.5 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{copy.question.legend}</legend>
      {options.map((o, i) => (
        <label key={i} className={radio}>
          <input type="radio" name="answer" value={i} checked={value === i} onChange={() => onChange(i)} className="size-4 flex-none accent-[#f2f1ed]" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{o}</span>
        </label>
      ))}
      {other && (
        <>
          {!fieldOnly && (
            <label className={radio}>
              <input type="radio" name="answer" value={otherIndex} checked={choosingOther} onChange={() => onChange(otherIndex)} className="size-4 flex-none accent-[#f2f1ed]" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{copy.question.other}</span>
            </label>
          )}
          {choosingOther && (
            <div>
              <label htmlFor="other-answer" className="mt-3 mb-2 block text-xs text-muted">{copy.question.fieldLabel(botName)}</label>
              <textarea
                id="other-answer" rows={2} value={other.text} onChange={e => other.onText(e.target.value)} placeholder={copy.question.placeholder}
                aria-invalid={showProblem} aria-describedby={showProblem ? 'other-problem' : undefined} autoComplete="off" enterKeyHint="send"
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit?.(); } }}
                className="max-h-[120px] min-h-12 w-full min-w-0 resize-y rounded-[12px] border border-line bg-surface p-3 text-base leading-[22px] text-fg placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-info"
              />
              {showProblem && <p id="other-problem" role="alert" className="mt-2 text-xs text-danger-fg">{other.problem === 'long' ? copy.question.long(OTHER_MAX) : other.problem === 'digit' ? copy.question.digit : copy.question.untypable}</p>}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}

const choice = 'flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-3 text-[13px] has-[:checked]:border-fg/40 has-[:checked]:bg-raised has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info';

/**
 * The several questions of one OMP `ask`, a section each: radios for a single choice, checkboxes when `multi`. `selected`
 * holds the labels chosen per question, in order; none is preselected. The buttons live in the footer (`DecisionFooter`).
 */
export function MultiQuestionForm({ questions, selected, onToggle, disabled = false }: {
  questions: AskQuestion[]; selected: string[][]; onToggle: (question: number, label: string) => void; disabled?: boolean;
}) {
  return (
    <div className="my-3.5 flex flex-col gap-5">
      {questions.map((q, qi) => (
        <fieldset key={q.id} disabled={disabled} className="flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-[15px] leading-[1.4] font-semibold [overflow-wrap:anywhere]">{q.header ?? q.question}</legend>
          {q.header && <p className="mb-1 text-xs text-muted [overflow-wrap:anywhere]">{q.question}</p>}
          {q.options.map(o => (
            <label key={o.label} className={choice}>
              <input
                type={q.multi ? 'checkbox' : 'radio'} name={`question-${qi}`} checked={selected[qi]?.includes(o.label) === true}
                onChange={() => onToggle(qi, o.label)} className="size-4 flex-none accent-[#f2f1ed]"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}{o.description && <small className="mt-0.5 block text-[11px] text-muted">{o.description}</small>}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
