import { openDesktop } from '../tauri/bridge';

/** What the island asks Ledge Desktop to open. */
export type LedgeTarget =
  | { kind: 'session'; id: string }
  | { kind: 'terminal'; id: string }
  | { kind: 'document'; path: string }
  | { kind: 'settings' }
  | { kind: 'launch' }
  | { kind: 'update' }
  | { kind: 'machines' };

/** 'opening' at once; then 'missing' when Ledge Desktop is not installed, 'failed' when it could not be started. */
export type OpenOutcome = 'opening' | 'missing' | 'failed';
type Listener = (target: LedgeTarget, outcome: OpenOutcome) => void;
const listeners = new Set<Listener>();
const tell = (target: LedgeTarget, outcome: OpenOutcome) => { for (const listener of listeners) listener(target, outcome); };

/** Starts Ledge Desktop on the target (`ledge-desktop.exe --open <json>`; a running one gets it through its single
 *  instance) and tells the subscribers how it went. */
export function openInLedge(target: LedgeTarget): void {
  tell(target, 'opening');
  void openDesktop(JSON.stringify(target)).then(r => { if (r === 'missing' || r === 'failed') tell(target, r); });
}

/** Subscribe to openings. The returned function removes the subscription. */
export function subscribeOpenInLedge(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
