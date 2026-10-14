import type { MachineState } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';

/** One notice per remote machine that has settled as unreachable; `connecting` (boot) never shows one, and local has its own state. */
export function OfflineNotice({ machines, onRetry }: { machines: MachineState[]; onRetry: (id: string) => void }) {
  const { t } = useI18n();
  return <>{machines.filter(m => m.id !== 'local' && m.status === 'unreachable').map(m => (
    <div key={m.id} role="status" className="offline-notice">
      <strong>{t.offline.title(m.label)}</strong><span>{t.offline.reconnecting(m.label)}</span>
      <button type="button" data-reconnect onClick={() => onRetry(m.id)}>{t.offline.retry}</button>
    </div>
  ))}</>;
}

export function LocalDownNotice() {
  const { t } = useI18n();
  return <div role="alert" className="offline-notice local-down"><strong>{t.localDown.title}</strong><span>{t.localDown.text}</span></div>;
}
