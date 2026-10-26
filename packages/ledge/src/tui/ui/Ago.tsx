import { useI18n } from '../i18n/lang.js';
import { ago } from '../model/time.js';
import { useNow } from './now.js';

/** How long ago `iso` was, drawn again each second on its own. */
export function Ago({ iso }: { iso: string }) {
  const now = useNow();
  const { t } = useI18n();
  return <>{ago(iso, now, t.time)}</>;
}
