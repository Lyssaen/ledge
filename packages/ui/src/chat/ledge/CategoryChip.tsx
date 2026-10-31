import { ALWAYS_USER, type MandateCategory } from '@ledge/protocol';
import { useLedgeThreadCopy } from './copy';

/** A mandate category pill: amber for what always comes back to the user (design, architecture, critical), neutral otherwise. */
export function CategoryChip({ category }: { category: MandateCategory }) {
  const copy = useLedgeThreadCopy();
  return <span className="lt-chip" data-tone={ALWAYS_USER.includes(category) ? 'amber' : 'neutral'}>{copy.category(category)}</span>;
}
