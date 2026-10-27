import { copy } from '../copy';
import type { InboxItem } from '../model/requests';
import { kindTone } from '../model/agents';
import { Tag } from './Tag';

/** The kind of request; a high-risk one says so instead (spec §4). */
export function Badge({ kind, risk = 'low' }: { kind: InboxItem['kind']; risk?: InboxItem['risk'] }) {
  const high = risk === 'high' && kind !== 'question';
  return <Tag tone={high ? 'danger' : kindTone[kind]} label={high ? copy.risk.badge : copy.kind[kind]} />;
}
