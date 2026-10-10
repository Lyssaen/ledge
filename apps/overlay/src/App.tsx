import { useEffect, useMemo, useState } from 'react';
import { PROTOCOL_PORT } from '@ledge/protocol';
import { createDaemonClient } from './daemon/client';
import { attachClient } from './daemon/store';
import { Surface } from './surface/Surface';
import { isTauri, screenHeight, setWebviewZoom } from './tauri/bridge';
import { autoScale, loadUiScale, resolveScale, saveUiScale, type UiScale } from './scale';

export function App() {
  const client = useMemo(() => createDaemonClient({ url: `ws://127.0.0.1:${PROTOCOL_PORT}` }), []);
  // The work-area height in logical px, before the UI zoom.
  const [workH, setWorkH] = useState(window.innerHeight);
  const [uiScale, setUiScale] = useState<UiScale>(loadUiScale);
  const [dnd, setDnd] = useState(() => { try { return localStorage.getItem('ledge.dnd') === '1'; } catch { return false; } });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('ledge.theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; } });
  const tauri = isTauri();
  const scale = resolveScale(uiScale, workH);
  useEffect(() => { const off = attachClient(client); client.connect(); screenHeight().then(setWorkH).catch(() => {}); return () => { off(); client.close(); }; }, [client]);
  // In the browser the viewport is the work area: follow its resizes.
  useEffect(() => { if (tauri) return; const h = () => setWorkH(window.innerHeight); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [tauri]);
  useEffect(() => { document.documentElement.dataset.uiScale = String(scale); void setWebviewZoom(scale); }, [scale]);
  useEffect(() => { saveUiScale(uiScale); }, [uiScale]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('ledge.theme', theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem('ledge.dnd', dnd ? '1' : '0'); } catch { /* ignore */ } }, [dnd]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') setTheme(t => (t === 'dark' ? 'light' : 'dark')); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const surface = <Surface screenH={workH / scale} scale={scale} uiScale={uiScale} autoScale={autoScale(workH)} onUiScale={setUiScale}
    theme={theme} client={client} dnd={dnd} onToggleDnd={() => setDnd(d => !d)} onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} />;
  // Under Tauri the webview zoom scales the page; the browser (dev, e2e) emulates it with a CSS zoom on the app root.
  return tauri ? surface : <div data-ui-zoom style={{ zoom: scale }}>{surface}</div>;
}
