import type { MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

export function StatusBar({ sessions, machines }: { sessions: Session[]; machines: MachineState[] }) {
  const { t } = useI18n();
  return (
    <footer className="statusbar">
      <span>{t.status.sessions(sessions.length)}{machines.map(m => (
        <span key={m.id} className="connection"><i className={`dot ${m.status === 'unreachable' ? 'offline-dot' : 'green'}`} aria-hidden="true" />{m.status === 'unreachable' ? t.status.disconnected(m.label, m.id === 'local') : t.status.connected(m.label, m.id === 'local')}</span>
      ))}</span>
    </footer>
  );
}
