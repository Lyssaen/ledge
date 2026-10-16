import { useEffect, useState } from 'react';
import { createDaemonClient, type DaemonClient } from './daemon/client';
import { createFleetClient } from './daemon/fleet';
import { loadMachines } from './daemon/machines';
import { attachClient } from './daemon/store';
import { Surface } from './surface/Surface';
import { useUpdate } from './update/useUpdate';
import { daemonToken, getAutostart, isTauri, listMonitors, screenHeight, screenWidth, setAutostart, setMonitor, setTrayLabels } from './tauri/bridge';
import { autoScale, loadScale, migrateLegacyScale, resolveScale, saveScale, type ScaleTarget, type UiScale } from './scale';
import { loadMonitor, saveMonitor, type MonitorInfo } from './monitor';
import { LangProvider, loadLang, messagesFor, saveLang, type Lang } from './i18n/lang';
import { createWebAudioPlayer } from './sounds/player';
import { applyAccent, loadAccent, saveAccent } from './accent';
import { loadIslandPosition, saveIslandPosition, loadDiscreet, saveDiscreet, type IslandPosition } from './island';

function browserDaemonToken(): string | undefined {
  const token = import.meta.env.VITE_LEDGE_TOKEN;
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token) ? token : undefined;
}

export function App() {
  // An isolated browser demo points at a fake daemon and never needs the token. Under Tauri the token is read from
  // WSL before the first socket; the browser (tests included) connects immediately, with VITE_LEDGE_TOKEN when set.
  const demo = import.meta.env.DEV && import.meta.env.VITE_LEDGE_DEMO_WS ? String(import.meta.env.VITE_LEDGE_DEMO_WS) : '';
  const [client, setClient] = useState<DaemonClient | null>(() => {
    if (demo) return createDaemonClient({ url: demo });
    if (isTauri()) return null;
    return createFleetClient(loadMachines(), createDaemonClient, browserDaemonToken());
  });
  useEffect(() => {
    if (client || demo) return undefined;
    let live = true;
    let created: DaemonClient | undefined;
    void daemonToken().then(token => {
      if (!live) return;
      created = createFleetClient(loadMachines(), createDaemonClient, token ?? undefined);
      setClient(created);
    });
    return () => { live = false; created?.close(); };
  }, [client, demo]);
  if (!client) return null;
  return <AppShell client={client} />;
}

function AppShell({ client }: { client: DaemonClient }) {
  // The work-area height in logical px. The page is never zoomed: each layer applies its own scale.
  const [workH, setWorkH] = useState(window.innerHeight);
  const [workW, setWorkW] = useState(window.innerWidth);
  const [scales, setScales] = useState<Record<ScaleTarget, UiScale>>(() => { migrateLegacyScale(); return { handle: loadScale('handle'), panel: loadScale('panel') }; });
  // The Screen setting (null: the primary monitor) and the monitors it can choose from, listed again when Settings opens.
  const [monitor, setMonitorChoice] = useState<string | null>(loadMonitor);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  // Launch at login lives in Windows (the Run key), not in localStorage: read again whenever Settings opens, since it
  // can also be changed from the Task Manager. null: not offered (browser, `tauri dev`).
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [lang, setLang] = useState<Lang>(loadLang);
  const [islandPosition, setIslandPosition] = useState<IslandPosition>(loadIslandPosition);
  const [discreet, setDiscreet] = useState(loadDiscreet);
  useEffect(() => { saveIslandPosition(islandPosition); }, [islandPosition]);
  useEffect(() => { saveDiscreet(discreet); }, [discreet]);
  const [dnd, setDnd] = useState(() => { try { return localStorage.getItem('ledge.dnd') === '1'; } catch { return false; } });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('ledge.theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; } });
  const [accent, setAccent] = useState<string | null>(loadAccent);
  const [player] = useState(() => createWebAudioPlayer());
  const tauri = isTauri();
  const handleScale = resolveScale(scales.handle, workH, 'handle');
  const panelScale = resolveScale(scales.panel, workH, 'panel');
  const update = useUpdate(client);
  useEffect(() => { const off = attachClient(client); client.connect(); return () => { off(); client.close(); }; }, [client]);
  const refreshMonitors = () => { listMonitors().then(setMonitors).catch(() => {}); };
  useEffect(refreshMonitors, []);
  const refreshAutostart = () => { getAutostart().then(setAutostartState).catch(() => {}); };
  const onSettingsOpen = () => { refreshMonitors(); refreshAutostart(); };
  const onAutostart = (on: boolean) => { setAutostartState(on); setAutostart(on).then(setAutostartState).catch(() => {}); };
  // The shell moves the overlay to the chosen monitor; the surface then lays itself out in that monitor's work area.
  useEffect(() => { saveMonitor(monitor); let live = true; setMonitor(monitor).then(() => Promise.all([screenHeight(monitor), screenWidth(monitor)])).then(([h, w]) => { if (live) { setWorkH(h); setWorkW(w); } }).catch(() => {}); return () => { live = false; }; }, [monitor]);
  // In the browser the viewport is the work area: follow its resizes.
  useEffect(() => { if (tauri) return; const h = () => { setWorkH(window.innerHeight); setWorkW(window.innerWidth); }; window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [tauri]);
  useEffect(() => { const d = document.documentElement.dataset; d.handleScale = String(handleScale); d.panelScale = String(panelScale); }, [handleScale, panelScale]);
  useEffect(() => { saveScale('handle', scales.handle); saveScale('panel', scales.panel); }, [scales]);
  useEffect(() => { saveLang(lang); document.documentElement.lang = lang; void setTrayLabels(messagesFor(lang).tray); }, [lang]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('ledge.theme', theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { saveAccent(accent); applyAccent(accent, theme); }, [accent, theme]);
  useEffect(() => { try { localStorage.setItem('ledge.dnd', dnd ? '1' : '0'); } catch { /* ignore */ } }, [dnd]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') setTheme(t => (t === 'dark' ? 'light' : 'dark')); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  return (
    <LangProvider lang={lang}>
      <Surface update={update} screenH={workH} screenW={workW} handleScale={handleScale} panelScale={panelScale} scales={scales} autoScales={{ handle: autoScale(workH, 'handle'), panel: autoScale(workH, 'panel') }}
        onScale={(target, s) => setScales(x => ({ ...x, [target]: s }))} onLang={setLang}
        monitors={monitors} monitor={monitor} onMonitor={setMonitorChoice} onSettingsOpen={onSettingsOpen}
        autostart={autostart} onAutostart={onAutostart}
        theme={theme} client={client} dnd={dnd} soundPlayer={player} onToggleDnd={() => setDnd(d => !d)} onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        accent={accent} onAccent={setAccent} islandPosition={islandPosition} onIslandPosition={setIslandPosition} discreet={discreet} onDiscreet={setDiscreet} />
    </LangProvider>
  );
}
