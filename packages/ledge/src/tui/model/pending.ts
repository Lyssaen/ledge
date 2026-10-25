import { offers, type Pending, type Session } from '@ledge/protocol';

/** Claude Code's own free-text row in a question's dialog: its digit only moves the cursor, so it is never offered as a choice. */
export const isFreeRow = (label: string): boolean => /^Type something\.?$/.test(label);

/** What a key can do to the session's request, or why not (the toast says it). */
export type Answer =
  | { kind: 'decide'; decision: 'accept' | 'deny' | 'always' }
  | { kind: 'option'; n: number }
  | { kind: 'select'; questionId: string; label: string; n: number }
  | { kind: 'refused'; why: 'offline' | 'readOnly' | 'notNow' | 'noAlways' };

/** `y`, `n`, `A` and `1`…`9` on a session: permission, diff and plan take y / n / A (where the harness offers « always »);
 *  a question takes its options' digits (OMP's single question by its label). Nothing for an offline or read-only session. */
export function answerFor(s: Session, key: string): Answer | null {
  const p = s.pending;
  const digit = /^[1-9]$/.test(key) ? Number(key) : null;
  if (key !== 'y' && key !== 'n' && key !== 'A' && digit === null) return null;
  if (s.offline) return { kind: 'refused', why: 'offline' };
  if (s.source === 'hook_only') return { kind: 'refused', why: 'readOnly' };
  if (!p) return { kind: 'refused', why: 'notNow' };
  if (p.kind !== 'question') {
    if (key === 'y') return { kind: 'decide', decision: 'accept' };
    if (key === 'n') return { kind: 'decide', decision: 'deny' };
    if (key === 'A') return offers(s.tool, p.kind, 'always') ? { kind: 'decide', decision: 'always' } : { kind: 'refused', why: 'noAlways' };
    return { kind: 'refused', why: 'notNow' };
  }
  if (digit === null) return { kind: 'refused', why: 'notNow' };
  const q = p.questions?.length === 1 ? p.questions[0]! : undefined;
  if (q) {
    const option = q.options[digit - 1];
    return option && !q.multi ? { kind: 'select', questionId: q.id, label: option.label, n: digit } : { kind: 'refused', why: 'notNow' };
  }
  const option = p.options?.[digit - 1];
  return option !== undefined && !isFreeRow(option) ? { kind: 'option', n: digit } : { kind: 'refused', why: 'notNow' };
}

/** The choices a question shows, numbered from 1, its free-text row left out. */
export function choices(p: Pending): Array<{ n: number; label: string }> {
  const q = p.questions?.length === 1 ? p.questions[0] : undefined;
  const labels = q ? q.options.map(o => o.label) : (p.options ?? []);
  return labels.map((label, i) => ({ n: i + 1, label })).filter(c => !isFreeRow(c.label));
}
