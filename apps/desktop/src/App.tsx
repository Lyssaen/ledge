import { useCallback, useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { LangProvider, loadLang, useI18n, type Lang } from './i18n/lang';
import { useFleet } from './fleet/useFleet';
import { useAlerts } from './notify/useAlerts';
import { getDnd, setDnd, useDnd } from './notify/prefs';
import { onTrayAction, setTrayLabels } from './tauri/bridge';
import { useAppearance } from './shell/theme';
import { Waiting } from './shell/Waiting';

/** The shell until the Atelier's skeleton (lot 3): the real fleet, toasts and sounds, the tray, and a waiting screen. */
function Shell({ client }: { client?: DaemonClient }) {
  const { sessions, machines, status, localDown } = useFleet(client);
  const { t } = useI18n();
  // Toasts and sounds from session changes (spec 2026-10-14 §10); no daemon update can start before the settings (lot 10).
  useAlerts({ sessions, machines, status });
  // The tray's « Nouvelle session » has no screen yet (lot 7): ignored. « Ne pas déranger » switches without showing the window.
  useEffect(() => onTrayAction(action => { if (action === 'dnd') setDnd(!getDnd()); }), []);
  // The tray speaks the app's language and names the way back from do not disturb.
  const [dnd] = useDnd();
  useEffect(() => {
    setTrayLabels({ open: t.tray.open, newSession: t.tray.newSession, dnd: dnd ? t.tray.dndOff : t.tray.dnd, quit: t.tray.quit });
  }, [t, dnd]);
  return (
    <main className="app" data-readonly={localDown ? 'true' : undefined}>
      <Waiting sessions={sessions} machines={machines} />
    </main>
  );
}

export function App({ client }: { client?: DaemonClient } = {}) {
  const [lang] = useState<Lang>(loadLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useAppearance();
  return <LangProvider lang={lang}><Shell client={client} /></LangProvider>;
}
