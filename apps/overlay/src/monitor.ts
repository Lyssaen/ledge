/**
 * The Screen setting: which monitor's left edge carries the handle. `null` means the primary monitor, whichever it is
 * after a reconfiguration; otherwise the id the shell reports for a monitor (`list_monitors`). A chosen monitor that is
 * not plugged in falls back to the primary in the shell until it comes back; the setting itself is kept.
 */
const KEY = 'ledge.monitor';

export interface MonitorInfo { id: string; name: string | null; width: number; height: number; workH: number; workW?: number; primary: boolean }

/** The persisted choice; `null` (the primary) when absent or when storage is unavailable. */
export function loadMonitor(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function saveMonitor(id: string | null): void {
  try { if (id === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, id); } catch { /* storage unavailable: the in-memory value still applies */ }
}

/** The monitor a choice resolves to in `monitors`: the chosen one while listed, else the primary (or the first). */
export function resolveMonitor(choice: string | null, monitors: MonitorInfo[]): MonitorInfo | undefined {
  return (choice !== null ? monitors.find(m => m.id === choice) : undefined) ?? monitors.find(m => m.primary) ?? monitors[0];
}
