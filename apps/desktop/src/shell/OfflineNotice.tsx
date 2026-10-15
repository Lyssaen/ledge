import type { MachineState } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';

/** One notice per remote machine that has settled as unreachable; `connecting` (boot) never shows one, and local has its own state.
 *  `onSettings` (not inside the launch screen) opens Settings › Machines. */
export function OfflineNotice({ machines, onRetry, onSettings }: { machines: MachineState[]; onRetry: (id: string) => void; onSettings?: () => void }) {
  const { t } = useI18n();
  return <>{machines.filter(m => m.id !== 'local' && m.status === 'unreachable').map(m => (
    <div key={m.id} role="status" className="connection-notice">
      <div><strong>{t.offline.title(m.label)}</strong><p>{t.offline.text}</p></div>
      <button type="button" className="settings-button" data-reconnect onClick={() => onRetry(m.id)}>{t.offline.retry}</button>
      {onSettings && <button type="button" className="settings-button" data-open-machines onClick={onSettings}>{t.offline.settings}</button>}
    </div>
  ))}</>;
}

/** `role` is `status` inside the launch screen, where only validation and failure messages are alerts. */
export function LocalDownNotice({ role = 'alert' }: { role?: 'alert' | 'status' } = {}) {
  const { t } = useI18n();
  return <div role={role} className="connection-notice local-down"><div><strong>{t.localDown.title}</strong><p>{t.localDown.text}</p></div></div>;
}
