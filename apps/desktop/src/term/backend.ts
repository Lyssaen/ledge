import { isTauri, openPty } from '../tauri/bridge';

export interface PtyHandle { write(data: string): void; resize(cols: number, rows: number): void; close(): void }
export interface PtyEvents { data(bytes: Uint8Array): void; exit(code: number | null): void }
export interface PtyBackend { open(argv: string[], size: { cols: number; rows: number }, on: PtyEvents): Promise<PtyHandle | null> }

/** Tauri's pseudo-terminal in the app, the e2e fake (`window.__ledgeFakePty`, installed by main.tsx) in the e2e build, none in the browser build. */
export function ptyBackend(): PtyBackend | null {
  if (isTauri()) return { open: openPty };
  if (import.meta.env.VITE_LEDGE_E2E) return (window as unknown as { __ledgeFakePty?: PtyBackend }).__ledgeFakePty ?? null;
  return null;
}
