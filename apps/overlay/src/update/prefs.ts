const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* in-memory only */ } };
export const loadAuto = () => get('ledge.update.auto') !== '0';
export const saveAuto = (on: boolean) => set('ledge.update.auto', on ? '1' : '0');
export const loadDismissed = () => get('ledge.update.dismissed');
export const saveDismissed = (v: string | null) => set('ledge.update.dismissed', v);
export const loadCheckedAt = () => { const v = Number(get('ledge.update.checkedAt')); return Number.isFinite(v) && v > 0 ? v : null; };
export const saveCheckedAt = (ms: number) => set('ledge.update.checkedAt', String(ms));
/** The app version before an update, written just before installing; read once after the relaunch. */
export const saveUpdatedFrom = (v: string) => set('ledge.update.from', v);
export function takeUpdatedFrom(): string | null { const v = get('ledge.update.from'); set('ledge.update.from', null); return v; }
