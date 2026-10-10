const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export async function screenHeight(): Promise<number> {
  if (!inTauri()) return window.innerHeight;
  const { currentMonitor } = await import('@tauri-apps/api/window');
  const m = await currentMonitor();
  return m ? Math.round(m.size.height / m.scaleFactor) : window.innerHeight;
}
let last = '';
export function setFrame(f: { top: number; w: number; h: number }): void {
  if (!inTauri()) return;
  const key = `${f.top}:${f.w}:${f.h}`; if (key === last) return; last = key;
  import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_frame', { top: f.top, width: f.w, height: f.h })).catch(() => {});
}
export async function focusTerminal(title: string): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('focus_terminal', { title }).catch(() => {});
}
export function onShortcut(fn: () => void): () => void {
  if (!inTauri()) { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') fn(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }
  let off = () => {}; let disposed = false;
  import('@tauri-apps/plugin-global-shortcut').then(async ({ register, unregister }) => {
    await register('Ctrl+Alt+L', e => { if (e.state === 'Pressed') fn(); });
    off = () => { unregister('Ctrl+Alt+L').catch(() => {}); };
    if (disposed) off();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}
