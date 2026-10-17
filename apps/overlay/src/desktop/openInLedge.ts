/** What the island asks Ledge Desktop to open. Replacing `openInLedge` is the whole integration. */
export type LedgeTarget =
  | { kind: 'session'; id: string }
  | { kind: 'terminal'; id: string }
  | { kind: 'document'; path: string }
  | { kind: 'settings' }
  | { kind: 'launch' }
  | { kind: 'update' }
  | { kind: 'machines' };

type Listener = (target: LedgeTarget) => void;
const listeners = new Set<Listener>();

/** Records the opening and tells the subscribers. It does not start Desktop, and it does not touch the daemon. */
export function openInLedge(target: LedgeTarget): void {
  for (const listener of listeners) listener(target);
}

/** Subscribe to openings. The returned function removes the subscription. */
export function subscribeOpenInLedge(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
