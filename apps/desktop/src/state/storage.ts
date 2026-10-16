/** Desktop's own keys (spec §7): every read survives a missing, corrupt or blocked store. */
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function readJson(key: string): unknown {
  try { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); } catch { return null; }
}
export function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: the value still holds for this run */ }
}
