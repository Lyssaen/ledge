import { copy } from '../copy';
import type { InboxItem } from '../model/requests';

const tone: Record<InboxItem['kind'], string> = { permission: 'text-attention bg-attention/[0.07]', question: 'text-attention bg-attention/[0.07]', plan: 'text-info bg-info/[0.07]', diff: 'text-info bg-info/[0.07]' };

export function Badge({ kind }: { kind: InboxItem['kind'] }) {
  return <span className={`inline-flex items-center rounded-md px-[7px] py-[3px] text-[10px] font-medium whitespace-nowrap ${tone[kind]}`}>{copy.kind[kind]}</span>;
}
