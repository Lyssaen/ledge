import type { Handover } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';

/** A relief under way, failed, or done with no relief to open (context handover spec §3.3): its state, by whom, why. */
export const reliefText = (h: Handover, th: Messages['handover']): string =>
  `${th.state[h.state]}${h.auto ? ` · ${th.auto}` : ''}${h.reason ? ` : ${h.reason}` : ''}`;

/** The relief is done and names the session that took over: it opens; otherwise its state is said. */
export const reliefDone = (h: Handover): h is Handover & { to: string } => h.state === 'done' && !!h.to;
