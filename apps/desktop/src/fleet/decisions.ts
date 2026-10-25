import type { DaemonClient, DaemonError } from '@ledge/fleet';
import { useDecisions as useSharedDecisions, type Decisions } from '@ledge/fleet/decisions';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

export { FLASH_MS, UNCONFIRMED_MS, markOf, requestKey, type Decisions } from '@ledge/fleet/decisions';

/** The shared decisions (`@ledge/fleet/decisions`), speaking Desktop's language. */
export function useDecisions(o: { client: Pick<DaemonClient, 'send'>; sessions: readonly Session[]; errors: readonly DaemonError[]; notify(text: string): void }): Decisions {
  const { t } = useI18n();
  return useSharedDecisions({ ...o, copy: t.decisions });
}
