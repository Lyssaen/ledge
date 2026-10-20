// The app: one screen at a time, chosen by the link's state first (signed out, another tab, a changed key, pairing),
// then by the address.
import { useEffect, useReducer, useRef, useState } from 'react';
import { MeResponseSchema } from '@ledge/protocol';
import type { LinkState, PhoneLink } from './link/link';
import { useRoute } from './router';
import { Agents } from './screens/Agents';
import { Compare } from './screens/Compare';
import { Connection } from './screens/Connection';
import { Denied } from './screens/Denied';
import { Inbox, clock } from './screens/Inbox';
import { KeyChanged } from './screens/KeyChanged';
import { Login, signinError } from './screens/Login';
import { Offline, Replaced } from './screens/Offline';
import { RequestDetail } from './screens/RequestDetail';
import { Terminal } from './screens/Terminal';
import { Thread } from './screens/Thread';
import { Update } from './screens/Update';
import { useMobile, type MobileStore } from './state/store';
import type { UpdateWatch } from './sw/register';
import type { BuildInfo } from './sw/types';

/** Every change of the link: its state, its pairing, its pinned PC. */
function useLink(link: PhoneLink): LinkState {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const off = link.subscribe(bump);
    bump();
    return off;
  }, [link]);
  return link.state();
}

/** The running build and the one waiting for consent, as the service worker tells them. */
function useUpdates(updates: UpdateWatch | null): { build: BuildInfo | null; waiting: BuildInfo | null } {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!updates) return;
    const off = updates.subscribe(bump);
    bump();
    return off;
  }, [updates]);
  return { build: updates?.current() ?? null, waiting: updates?.waiting() ?? null };
}

/** The GitHub login the relay's session belongs to, asked once signed in; null when unknown or signed out. */
function useLogin(fetchImpl: typeof fetch, signedIn: boolean): string | null {
  const [login, setLogin] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) { setLogin(null); return; }
    let live = true;
    fetchImpl('/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => (r.ok ? MeResponseSchema.safeParse(await r.json()) : null))
      .then((me) => { if (live && me?.success) setLogin(me.data.login); })
      .catch(() => { /* the account stays unknown */ });
    return () => { live = false; };
  }, [fetchImpl, signedIn]);
  return login;
}

export interface AppProps {
  link: PhoneLink;
  store: MobileStore;
  storage?: Storage;
  fetchImpl?: typeof fetch;
  /** The pinned service worker's builds; null where it could not be registered. */
  updates?: UpdateWatch | null;
  /** The relay's `?signin=` issue, taken from the address at start. */
  signin?: string | null;
  /** The keys were found lost at start, and the cache wiped. */
  lost?: boolean;
  /** The relay this app talks to, as shown on the login and connection screens. */
  relay?: string;
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function App({ link, store, storage, fetchImpl = defaultFetch, updates = null, signin = null, lost = false, relay = globalThis.location.host }: AppProps) {
  const state = useLink(link);
  const mobile = useMobile(store);
  const route = useRoute();
  const login = useLogin(fetchImpl, state !== 'signed_out');
  const { build, waiting } = useUpdates(updates);
  // « Plus tard » hides the sheet for this build until the page loads again.
  const [later, setLater] = useState<string | null>(null);
  // The sign-in issue stays until the user moves on: « Utiliser un autre compte » leaves Denied for the login board.
  const [issue, setIssue] = useState(signin);
  const [keysLost, setKeysLost] = useState(lost);
  // « Voir ce qui attend » was tapped: the pairing's outcome is no longer the screen.
  const [doneSeen, setDoneSeen] = useState(false);
  // A pairing was started from this page (by itself or by a tap): the ref guards against a second start in the same
  // commit, the state draws the screen.
  const startedRef = useRef(false);
  const [started, setStarted] = useState(false);
  const step = link.pairing()?.state() ?? null;

  const loginError = signinError(issue);
  const kind = issue === 'not_allowed' ? 'denied'
    : state === 'signed_out' || loginError || issue === 'another' ? 'login'
    : state === 'replaced' ? 'replaced'
    : state === 'key_changed' ? 'keyChanged'
    : state === 'unpaired' || state === 'pairing' || (step?.step === 'linked' && !doneSeen) ? 'compare'
    : 'route';
  // The pairing starts by itself only once its screen is the one shown (not behind the login or a refusal), and
  // only once: when it falls back to unpaired without a step, the screen offers to start again.
  const autoPair = kind === 'compare' && state === 'unpaired' && step === null && !started;
  const begin = (start: () => void) => { startedRef.current = true; setStarted(true); start(); };

  useEffect(() => {
    if (autoPair && !startedRef.current) begin(() => link.startPairing());
  }, [autoPair, link]);
  useEffect(() => {
    if (state === 'ready') { startedRef.current = false; setStarted(false); setKeysLost(false); }
    if (state === 'unpaired' || state === 'pairing') setDoneSeen(false);
  }, [state]);

  const pinned = link.pinned();
  // The pinned PC only while pairing: the name the old PC gave is not the one being paired.
  const pairingName = pinned?.name ?? null;
  const pcName = pinned?.name ?? mobile.daemon?.name ?? null;
  const retry = () => link.retry();
  const signOut = () => { void link.signOut(); };

  const screen = (() => {
    switch (kind) {
      case 'denied': return <Denied onOther={() => setIssue('another')} />;
      case 'login': return <Login server={relay} error={loginError} />;
      case 'replaced': return <Replaced onHere={() => globalThis.location.reload()} />;
      case 'keyChanged':
        return <KeyChanged pcName={pcName} known={pinned} received={link.receivedKey()} onRelink={() => begin(() => { void link.relink(); })} onSignOut={signOut} />;
      case 'compare':
        return (
          <Compare
            step={step} login={login} pcName={pairingName} lost={keysLost}
            stalled={state === 'unpaired' && step === null && started}
            onSame={() => link.pairing()?.confirmOnPhone()} onCancel={() => link.pairing()?.cancel()}
            onRestart={() => begin(() => link.startPairing())} onDone={() => setDoneSeen(true)}
          />
        );
    }
    switch (route.name) {
      case 'agents': return <Agents store={store} onReconnect={retry} />;
      case 'thread': return <Thread key={route.sessionId} store={store} sessionId={route.sessionId} storage={storage} onReconnect={retry} />;
      case 'terminal': return <Terminal key={route.sessionId} store={store} sessionId={route.sessionId} storage={storage} />;
      // Keyed by the session only: a request replaced in place rewrites the address, and must not start the screen over.
      case 'request': return <RequestDetail key={route.sessionId} store={store} sessionId={route.sessionId} requestKey={route.key} onReconnect={retry} />;
      case 'connection': return <Connection store={store} login={login} relay={relay} pinned={pinned} linkState={state} build={build} onSignOut={signOut} />;
      default: {
        const notice = state === 'pc_offline' ? <Offline pcName={pcName} since={clock(mobile.syncedAt)} onRetry={retry} /> : undefined;
        return <Inbox store={store} onReconnect={retry} notice={notice} />;
      }
    }
  })();

  return (
    <div className="app flex flex-col" data-route={route.name}>
      {screen}
      {updates && waiting && waiting.fingerprint !== later && (
        <Update next={waiting} current={build} onLater={() => setLater(waiting.fingerprint)} onApply={() => updates.accept()} />
      )}
    </div>
  );
}
