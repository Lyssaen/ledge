import type { MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from './theme';

/** What Desktop shows until the Atelier's skeleton (lot 3): the product, the session count and each machine's connection. */
export function Waiting({ sessions, machines }: { sessions: Session[]; machines: MachineState[] }) {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced: reducedMotion } = useMotionPreferences();
  return (
    <section className="waiting">
      <div className="waiting-body">
        <ResidentMascot size={72} theme={theme} reducedMotion={reducedMotion} />
        <h1>{t.waiting.title}</h1>
        <p>{t.waiting.text}</p>
      </div>
      <footer className="statusbar">
        <span>{t.status.sessions(sessions.length)}</span>
        {machines.map(m => (
          <span key={m.id} className="connection"><i className={`dot ${m.status === 'unreachable' ? 'offline-dot' : 'green'}`} aria-hidden="true" />{m.status === 'unreachable' ? t.status.disconnected(m.label, m.id === 'local') : t.status.connected(m.label, m.id === 'local')}</span>
        ))}
      </footer>
    </section>
  );
}
