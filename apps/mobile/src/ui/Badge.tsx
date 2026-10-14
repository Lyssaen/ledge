import { copy } from '../copy';
import type { InboxItem } from '../model/requests';

const tone: Record<InboxItem['kind'], string> = { permission: 'text-attention bg-attention/[0.07]', question: 'text-attention bg-attention/[0.07]', plan: 'text-info bg-info/[0.07]', diff: 'text-info bg-info/[0.07]' };

/** The kind of request; a high-risk one says so instead (spec §4). */
export function Badge({ kind, risk = 'low' }: { kind: InboxItem['kind']; risk?: InboxItem['risk'] }) {
  const high = risk === 'high' && kind !== 'question';
  return <span className={`inline-flex items-center rounded-md px-[7px] py-[3px] text-[10px] font-medium whitespace-nowrap ${high ? 'bg-danger-fg/[0.07] text-danger-fg' : tone[kind]}`}>{high ? copy.risk.badge : copy.kind[kind]}</span>;
}
