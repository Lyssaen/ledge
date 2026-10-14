import type { startAuthentication as StartAuthentication } from '@simplewebauthn/browser';
import { OperationReasonSchema, type AuthenticationJson, type ClientMessage, type OperationReason, type ServerMessage } from '@ledge/protocol';
import { newOperationId, type OpState } from '../model/operations';
import type { InboxItem } from '../model/requests';

export type DecideChallenge = Extract<ServerMessage, { type: 'decide.challenge' }>;

/** Why the device check could not lead to a decision. Nothing was sent to the agent in any of these cases. */
export class VerifyFailure extends Error {
  constructor(readonly reason: OperationReason | 'offline' | 'timeout' | 'webauthn_failed') { super(reason); this.name = 'VerifyFailure'; }
}

export interface PrepareDeps {
  send(m: ClientMessage): boolean;
  listen(fn: (m: ServerMessage) => void): () => void;
  timeoutMs?: number;
}

const PREPARE_TIMEOUT_MS = 10_000;

/**
 * Ask the PC for a challenge bound to this request, this version and this decision. Run it when the confirmation opens,
 * never from the confirming tap: the tap then calls `confirmWithDevice` with no await before the browser prompt.
 * Rejects on an `error` answering the request, on a lost link and on silence: it never waits forever.
 */
export function fetchChallenge(item: InboxItem, deps: PrepareDeps): Promise<DecideChallenge> {
  return new Promise((resolve, reject) => {
    let stop = (): void => {};
    const timer = setTimeout(() => { stop(); reject(new VerifyFailure('timeout')); }, deps.timeoutMs ?? PREPARE_TIMEOUT_MS);
    const done = (fn: () => void) => { clearTimeout(timer); stop(); fn(); };
    stop = deps.listen(m => {
      if (m.type === 'decide.challenge' && m.id === item.sessionId && m.pendingId === item.pendingId && m.pendingVersion === item.pendingVersion && m.decision === 'accept') done(() => resolve(m));
      else if (m.type === 'error' && m.id === item.sessionId) {
        const reason = OperationReasonSchema.safeParse(m.message);
        done(() => reject(new VerifyFailure(reason.success ? reason.data : 'invalid')));
      }
    });
    const sent = deps.send({ type: 'decide.prepare', id: item.sessionId, pendingId: item.pendingId, pendingVersion: item.pendingVersion, decision: 'accept' });
    if (!sent) done(() => reject(new VerifyFailure('offline')));
  });
}

export interface ConfirmDeps {
  startAuthentication: typeof StartAuthentication;
  /** Send the tracked decision (`store.submit`); false when the link is not usable. */
  submit(op: OpState, msg: ClientMessage): boolean;
  now?: () => number;
}

const cancelled = (e: unknown): boolean => {
  const named = (x: unknown) => typeof x === 'object' && x !== null && (x as { name?: unknown }).name === 'NotAllowedError';
  return named(e) || named((e as { cause?: unknown } | null)?.cause);
};

/**
 * The confirming tap. NOT async on purpose: `startAuthentication` is called before any await, so the browser still sees
 * the user activation (WebKit refuses navigator.credentials.get without it). A held challenge that has expired is refused
 * here, without the prompt: the caller fetches a new one and asks for another tap.
 */
export function confirmWithDevice(item: InboxItem, challenge: DecideChallenge, deps: ConfirmDeps): Promise<{ operationId: string } | { cancelled: true }> {
  if ((deps.now ?? Date.now)() >= Date.parse(challenge.expiresAt)) return Promise.reject(new VerifyFailure('assertion_expired'));
  let asking: ReturnType<typeof StartAuthentication>;
  try { asking = deps.startAuthentication({ optionsJSON: challenge.options as never }); } catch (e) { return cancelled(e) ? Promise.resolve({ cancelled: true as const }) : Promise.reject(new VerifyFailure('webauthn_failed')); }
  return asking.then(
    assertion => {
      const operationId = newOperationId();
      const ok = deps.submit(
        { operationId, sessionId: item.sessionId, pendingId: item.pendingId, pendingVersion: item.pendingVersion, kind: 'decide', decision: 'accept', phase: 'sending', startedAt: new Date().toISOString() },
        { type: 'session.decide', id: item.sessionId, decision: 'accept', pendingId: item.pendingId, pendingVersion: item.pendingVersion, operationId, assertion: assertion as unknown as AuthenticationJson }
      );
      if (!ok) throw new VerifyFailure('offline');
      return { operationId };
    },
    (e: unknown) => {
      if (cancelled(e)) return { cancelled: true as const };
      throw new VerifyFailure('webauthn_failed');
    }
  );
}
