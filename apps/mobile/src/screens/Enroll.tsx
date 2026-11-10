import { useEffect, useState, type ReactNode } from 'react';
import { b64u, recoveryUserId } from '@ledge/seal';
import { copy } from '../copy';
import { createCredential } from '../link/webauthn';
import { deviceLabel } from '../link/label';
import { href } from '../router';
import { useMobile, type ConfirmChallenge, type MobileStore } from '../state/store';
import { Notice } from '../ui/Notice';
import { OUTLINE, PRIMARY, Spinner } from '../ui/Board';
import { Icon } from '../ui/icons';
import { isApple, usePlatform } from './device';
import { modelOf } from './Recover';

const E = copy.enroll;

type Problem = 'cancelled' | 'unsupported' | 'failed' | 'prepareFailed';

/**
 * Making this device's passkey, whose public key the PC keeps: `protect` the high-impact accepts (the PC checks the device,
 * this one has no credential yet), or `update` an old one, made before a passkey could bring the device back after a
 * reinstall (the PC checks the device, its passkey is not marked `recover`). The challenge and the passkey's `user.id`
 * (« L1 » ‖ the pinned PC key's digest ‖ random) are ready as soon as the offer shows, so the tap opens the device's
 * prompt at once (the browser wants it inside the tap). Nothing is offered on a device that cannot verify its user.
 */
export function useEnroll(store: MobileStore, purpose: 'protect' | 'update' = 'protect') {
  const state = useMobile(store);
  const platform = usePlatform();
  const confirm = state.device?.confirm;
  const offered = platform && (purpose === 'protect' ? confirm === false : confirm === true && !state.device?.recover);
  const [ready, setReady] = useState<{ challenge: ConfirmChallenge; userId: Uint8Array } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [asking, setAsking] = useState(false);
  const [opId, setOpId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const phase = opId ? state.ops[opId]?.phase : undefined;
  const registered = (purpose === 'protect' ? confirm === true : state.device?.recover === true) || phase === 'applied';
  const sending = phase === 'sending' || phase === 'uncertain';
  const refused = phase === 'rejected' || phase === 'failed';

  useEffect(() => {
    if (!offered || registered) return;
    let on = true;
    setReady(null);
    const key = store.pcKey();
    Promise.all([store.prepareConfirm({ purpose: 'register' }), key ? recoveryUserId(key) : Promise.reject(new Error('unpaired'))]).then(
      ([challenge, userId]) => { if (on) setReady({ challenge, userId }); },
      () => { if (on) setProblem('prepareFailed'); }
    );
    return () => { on = false; };
  }, [store, offered, registered, attempt]);

  // The create call stays in the tap's own turn: nothing is awaited before it.
  const go = () => {
    if (!ready || asking || sending) return;
    const { challenge: ch, userId } = ready;
    setAsking(true);
    setProblem(null);
    // The passkey's name in the device's sheet: « iPad » too on an iPad that says it is a Mac (decision 7).
    const label = deviceLabel(globalThis.navigator?.userAgent ?? '', globalThis.navigator?.maxTouchPoints ?? 0);
    createCredential({ challenge: ch.challenge, rpId: ch.rpId }, { label, id: userId }).then(
      made => {
        setAsking(false);
        if (made === 'cancelled') { setProblem('cancelled'); return; }
        if (made === 'unsupported') { setProblem('unsupported'); return; }
        // The challenge is spent by this registration, whatever the PC says of it.
        setReady(null);
        const op = store.registerCredential(made, b64u(userId));
        if (op === null) setProblem('failed'); else setOpId(op);
      },
      () => { setAsking(false); setProblem('failed'); }
    );
  };
  const retry = () => { setProblem(null); setOpId(null); setAttempt(a => a + 1); };
  const shown: Problem | null = problem ?? (refused ? 'failed' : null);
  return { offered, registered, challenge: ready?.challenge ?? null, asking: asking || sending, problem: shown, go, retry };
}

type Enroll = ReturnType<typeof useEnroll>;

/** The offer's button, or « Réessayer » when a new challenge is needed, and what went wrong. */
function Action({ e, className, label = E.go }: { e: Enroll; className: string; label?: string }) {
  const renew = e.problem === 'failed' || e.problem === 'prepareFailed';
  const text = e.problem === 'cancelled' ? copy.confirm.cancelled : e.problem === 'unsupported' ? E.unsupported : e.problem === 'failed' ? copy.confirm.failed : e.problem === 'prepareFailed' ? copy.confirm.prepareFailed : null;
  return (
    <>
      {text && <Notice title={text} tone="warning" role="alert" />}
      {renew
        ? <button type="button" onClick={e.retry} className={className}>{copy.confirm.retry}</button>
        : e.problem === 'unsupported' ? null
        : <button type="button" disabled={!e.challenge || e.asking} onClick={e.go} className={className}>{e.challenge || e.asking ? label : copy.confirm.preparing}</button>}
    </>
  );
}

/** The row of Connection: « Accords à impact élevé », protected by this device or the way to protect them. Nothing from a PC that does not check the device. */
export function ProtectRow({ store }: { store: MobileStore }) {
  const e = useEnroll(store);
  if (e.registered) return <ProtectedRow>{E.done}</ProtectedRow>;
  if (!e.offered) return null;
  return (
    <ProtectedRow>
      <div className="flex flex-col items-end gap-2">
        <Action e={e} className="inline-flex min-h-10 items-center justify-center rounded-control border border-line px-3 text-body font-medium disabled:opacity-45" />
      </div>
    </ProtectedRow>
  );
}

function ProtectedRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="flex-none text-muted">{E.row}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

/**
 * The step after a pairing: « Protéger les accords » when the PC checks the device and this one can, then the way to
 * the inbox. Once shown it stays, until the protection is done or put off.
 */
export function ProtectStep({ store, onDone, update = false }: {
  store: MobileStore; onDone: () => void;
  /** An old passkey was seen before this pairing (screen 2 c): the step says it is updated (passkey-reinstall.html, 4 i). */
  update?: boolean;
}) {
  const e = useEnroll(store);
  const [shown, setShown] = useState(false);
  useEffect(() => { if (e.offered) setShown(true); }, [e.offered]);
  const inbox = href({ name: 'atoi' });
  if (!shown) return <a href={inbox} onClick={onDone} className={PRIMARY}>{copy.compare.seePending}</a>;
  if (e.registered) {
    return (
      <>
        <Notice title={E.done} role="status" />
        <a href={inbox} onClick={onDone} className={PRIMARY}>{copy.compare.seePending}</a>
      </>
    );
  }
  return (
    <>
      <section aria-labelledby="protect-title" className="flex flex-col gap-3 rounded-control border border-line bg-surface p-4">
        <h2 id="protect-title" className="text-title leading-[1.35] font-semibold">{update ? copy.passkeyUpdate.title : E.title}</h2>
        <p className="text-body leading-[1.6] text-muted">{update ? copy.passkeyUpdate.stepBody(modelOf()) : E.body}</p>
        <Action e={e} className={PRIMARY} label={update ? copy.passkeyUpdate.go : E.go} />
      </section>
      <a href={inbox} onClick={onDone} className={OUTLINE}>{E.later}</a>
    </>
  );
}

const U = copy.passkeyUpdate;
/** « Plus tard » on the card, per device: only the row of Connection offers the update after that (P7). */
const LATER_KEY = 'ledge.mobile.passkeyUpdateLater';
const laterFor = (storage: Storage | undefined, device: string | undefined): boolean => {
  try { return !!device && storage?.getItem(LATER_KEY) === device; } catch { return false; }
};

/**
 * The card at the top of « À toi » on a device whose passkey predates recovery (passkey-reinstall.html, 4 a–f): « Mettre à
 * jour la passkey » with Face ID, « Plus tard ». Once done, a receipt that stays until « À toi » is opened again. It is not a
 * request: it counts in no badge.
 */
export function UpdateCard({ store, storage = globalThis.localStorage }: { store: MobileStore; storage?: Storage }) {
  const e = useEnroll(store, 'update');
  const device = useMobile(store).device?.id;
  const [later, setLater] = useState(() => laterFor(storage, device));
  // Shown in this visit: the receipt replaces it once the PC took the new passkey.
  const [shown, setShown] = useState(false);
  useEffect(() => { if (e.offered && !later) setShown(true); }, [e.offered, later]);
  if (!shown) return null;
  if (e.registered) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-card border border-line bg-surface p-4">
        <Icon name="check" className="size-5 text-ok" />
        <span className="flex flex-col gap-0.5"><strong className="text-body font-semibold">{U.done}</strong><small className="text-small text-muted">{U.doneBody(modelOf())}</small></span>
      </div>
    );
  }
  if (later) return null;
  const putOff = () => {
    try { if (device) storage?.setItem(LATER_KEY, device); } catch { /* the card comes back next time */ }
    setLater(true);
    setShown(false);
  };
  const failed = e.problem === 'failed' || e.problem === 'prepareFailed' || e.problem === 'unsupported';
  const problem = e.problem === 'cancelled' ? U.cancelled : failed ? U.failed(store.pcName() ?? copy.yourPc) : null;
  return (
    <section aria-labelledby="passkey-update-title" className="flex flex-col gap-3 rounded-card border border-info/30 bg-info/[0.06] p-4">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-full bg-raised text-muted"><Icon name="key" className="size-[18px]" /></span>
        <h2 id="passkey-update-title" className="text-title leading-[1.35] font-semibold">{U.title}</h2>
      </div>
      {problem
        ? <Notice title={problem} tone={e.problem === 'cancelled' ? 'warning' : 'danger'} role="alert" />
        : <p className="text-body leading-[1.6] text-muted">{isApple() ? U.body(modelOf()) : U.bodyOther(modelOf())}</p>}
      <div className={problem ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'}>
        {problem
          ? <button type="button" onClick={failed ? e.retry : e.go} disabled={!failed && !e.challenge} className={PRIMARY}>{U.retry}</button>
          : <button type="button" onClick={e.go} disabled={!e.challenge || e.asking} className={PRIMARY}>{e.asking ? <><Spinner size="size-4" />{U.updating}</> : e.challenge ? U.go : copy.confirm.preparing}</button>}
        <button type="button" onClick={putOff} disabled={e.asking} className={OUTLINE}>{U.later}</button>
      </div>
    </section>
  );
}

/** The row of Connection: « Reconnexion sans code », « Prête » or the way to update the passkey (4 g, 4 h). Nothing before the accepts are protected. */
export function UpdateRow({ store }: { store: MobileStore }) {
  const e = useEnroll(store, 'update');
  const device = useMobile(store).device;
  if (!device?.confirm) return null;
  if (e.registered) {
    return (
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
        <dt className="flex-none text-muted">{U.row}</dt>
        <dd className="text-right text-ok">{U.ready}</dd>
      </div>
    );
  }
  if (!e.offered) return null;
  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <dt className="flex min-w-0 flex-col"><span>{U.row}</span><span className="text-small text-muted">{U.rowHint}</span></dt>
        <dd className="flex-none">
          <button type="button" disabled={!e.challenge || e.asking} onClick={e.problem === 'failed' || e.problem === 'prepareFailed' ? e.retry : e.go}
            className="inline-flex min-h-10 items-center justify-center rounded-control border border-line px-3 text-body font-medium disabled:opacity-45">{e.asking ? U.updating : U.update}</button>
        </dd>
      </div>
      {e.problem && <Notice title={e.problem === 'cancelled' ? U.cancelled : U.failed(store.pcName() ?? copy.yourPc)} tone="warning" role="alert" />}
    </div>
  );
}
