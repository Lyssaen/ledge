// What the two Équipes editors (role, team) share: the catalog wait, the mounted guard and the « changed » wait.
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PhoneCatalog } from '@ledge/protocol';
import { copy } from '../copy';
import { useMobile, type MobileStore } from '../state/store';
import { BackHeader, linkView } from '../ui/Header';
import { buttonClass } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { outcomeNote, type OutcomeNote } from '../model/teamsOutcome';
import type { Route } from '../router';
import { CATALOG_WAIT_MS } from './Teams';

/** Whether the screen is still on: a write that resolves after the user left must not navigate (`history.back()` would pop one screen too far). */
export function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}

/**
 * The catalog an editor opens on: asked on mount, when the link turns fresh and on `retry`; `waited` once the PC has not answered
 * for `CATALOG_WAIT_MS` (a refused read is never answered), so the screen says so instead of waiting for ever.
 */
export function useCatalogGate(store: MobileStore): { waited: boolean; retry: () => void } {
  const state = useMobile(store);
  const [attempt, setAttempt] = useState(0);
  const [waited, setWaited] = useState(false);
  const have = state.catalog !== null;
  useEffect(() => { store.requestCatalog(); }, [store, state.fresh, attempt]);
  useEffect(() => {
    setWaited(false);
    if (have) return;
    const timer = setTimeout(() => setWaited(true), CATALOG_WAIT_MS);
    return () => clearTimeout(timer);
  }, [have, state.fresh, attempt]);
  return { waited, retry: () => setAttempt(n => n + 1) };
}

/**
 * After a write is refused as « changed »: the file moved on the PC, so the editor must not write over it until the catalog that
 * says how has arrived. `begin()` asks for it; `onArrive` gets it (once, with the catalog as it is then); `waiting` gates the save in between.
 * The wait ends by itself past `CATALOG_WAIT_MS`, so a catalog that never comes does not lock the screen.
 */
export function useChangedWait(store: MobileStore, catalog: PhoneCatalog | null, onArrive: (catalog: PhoneCatalog | null) => void): { waiting: boolean; begin: () => void } {
  // The catalog that was current when it began: the wait is over when another one is held.
  const [from, setFrom] = useState<PhoneCatalog | null | undefined>(undefined);
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  useEffect(() => {
    if (from === undefined || catalog === from) return;
    arrive.current(catalog);
    setFrom(undefined);
  }, [catalog, from]);
  useEffect(() => {
    if (from === undefined) return;
    const timer = setTimeout(() => setFrom(undefined), CATALOG_WAIT_MS);
    return () => clearTimeout(timer);
  }, [from]);
  return { waiting: from !== undefined, begin: () => { setFrom(catalog); store.requestCatalog(); } };
}

/** Starts (`start`, a seat that holds no session) or restarts (`restart`) a seat of a live team, after the device's confirmation. Null once it is done, else the note that says why not. */
export function seatAction(store: MobileStore, team: string, role: string, action: 'start' | 'restart'): Promise<OutcomeNote | null> {
  const fallback = action === 'start' ? copy.teams.team.notStarted : copy.teams.team.notRestarted;
  return store.teamOp({ type: 'team.seat', team, role, action }).then(r => r.status === 'applied' ? null : outcomeNote(r, fallback), () => ({ text: fallback, quiet: false }));
}

/** What a screen shows until it has what it opens on: the wait for the catalog, its retry, or `missing` when the PC answered without it (`wording` when what it waits for is not the catalog). It leads back to the Équipes tab, or to `back`. */
export function EditorPending({ store, waited, retry, missing, back, wording }: { store: MobileStore; waited: boolean; retry: () => void; missing: string | null; back?: { route: Route; title: string; label: string }; wording?: { loading: string; unavailable: string; retry: string } }) {
  const state = useMobile(store);
  return (
    <>
      <BackHeader title={back?.title ?? copy.nav.teams} fallback={back?.route ?? { name: 'teams' }} label={back?.label ?? copy.nav.backTo.teams ?? copy.nav.back} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto pb-[22px]">
        {missing !== null ? <p className="py-6 text-center text-body text-muted">{missing}</p>
          : waited ? (
            <div className="mt-3"><Notice title={wording?.unavailable ?? copy.teams.unavailable} tone="plain">
              <button type="button" onClick={retry} className={buttonClass({ block: true, className: 'mt-3' })}>{wording?.retry ?? copy.teams.retry}</button>
            </Notice></div>
          ) : <p role="status" className="py-6 text-center text-body text-muted">{wording?.loading ?? copy.teams.loading}</p>}
      </main>
    </>
  );
}
