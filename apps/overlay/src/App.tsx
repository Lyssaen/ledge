import { useEffect, useMemo, useState } from 'react';
import { PROTOCOL_PORT } from '@ledge/protocol';
import { createDaemonClient } from './daemon/client';
import { attachClient } from './daemon/store';
import { Surface } from './surface/Surface';
import { isTauri, screenHeight } from './tauri/bridge';
import { autoScale, loadScale, migrateLegacyScale, resolveScale, saveScale, type ScaleTarget, type UiScale } from './scale';
import { LangProvider, loadLang, saveLang, type Lang } from './i18n/lang';

export function App() {
  const client = useMemo(() => createDaemonClient({ url: `ws://127.0.0.1:${PROTOCOL_PORT}` }), []);
  // The work-area height in logical px. The page is never zoomed: each layer applies its own scale.
  const [workH, setWorkH] = useState(window.innerHeight);
  const [scales, setScales] = useState<Record<ScaleTarget, UiScale>>(() => { migrateLegacyScale(); return { handle: loadScale('handle'), panel: loadScale('panel') }; });
  const [lang, setLang] = useState<Lang>(loadLang);
  const [dnd, setDnd] = useState(() => { try { return localStorage.getItem('ledge.dnd') === '1'; } catch { return false; } });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('ledge.theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; } });
  const tauri = isTauri();
  const handleScale = resolveScale(scales.handle, workH, 'handle');
  const panelScale = resolveScale(scales.panel, workH, 'panel');
  useEffect(() => { const off = attachClient(client); client.connect(); screenHeight().then(setWorkH).catch(() => {}); return () => { off(); client.close(); }; }, [client]);
  // In the browser the viewport is the work area: follow its resizes.
  useEffect(() => { if (tauri) return; const h = () => setWorkH(window.innerHeight); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [tauri]);
  useEffect(() => { const d = document.documentElement.dataset; d.handleScale = String(handleScale); d.panelScale = String(panelScale); }, [handleScale, panelScale]);
  useEffect(() => { saveScale('handle', scales.handle); saveScale('panel', scales.panel); }, [scales]);
  useEffect(() => { saveLang(lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('ledge.theme', theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem('ledge.dnd', dnd ? '1' : '0'); } catch { /* ignore */ } }, [dnd]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') setTheme(t => (t === 'dark' ? 'light' : 'dark')); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  return (
    <LangProvider lang={lang}>
      <Surface screenH={workH} handleScale={handleScale} panelScale={panelScale} scales={scales} autoScales={{ handle: autoScale(workH, 'handle'), panel: autoScale(workH, 'panel') }}
        onScale={(target, s) => setScales(x => ({ ...x, [target]: s }))} onLang={setLang}
        theme={theme} client={client} dnd={dnd} onToggleDnd={() => setDnd(d => !d)} onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} />
    </LangProvider>
  );
}
