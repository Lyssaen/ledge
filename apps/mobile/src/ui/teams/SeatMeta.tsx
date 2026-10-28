import type { PhoneRole, Tool } from '@ledge/protocol';
import { copy } from '../../copy';

/**
 * What a seat runs with. The seat's own value wins over its role's default; autonomy is the role's, and « auto » is in the warning tone.
 * `sheet` (a live team's sheet) says tool · IA · effort · autonomy, the effort the role's when the seat has none; the team editor
 * (default) says tool · IA · autonomy, and an effort only when the seat sets one.
 */
export function SeatMeta({ seat, role, sheet = false }: { seat: { tool?: Tool; model?: string; effort?: string }; role: PhoneRole | undefined; sheet?: boolean }) {
  const tool = seat.tool ?? role?.tool;
  const autonomy = role?.autonomy ?? 'ask';
  const model = seat.model ?? role?.model ?? null;
  const parts = sheet
    ? [tool ? copy.tools[tool] : null, model, seat.effort ?? role?.effort ?? null, copy.teams.autonomy[autonomy]]
    : [tool ? copy.tools[tool] : null, model, copy.teams.autonomy[autonomy], seat.effort ?? null];
  return <span className={autonomy === 'auto' ? 'text-attention' : ''}>{parts.filter(x => x !== null).join(' · ')}</span>;
}
