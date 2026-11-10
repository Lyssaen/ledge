// The app: one screen at a time, chosen by the link's state first (signed out, another tab, a changed key, a PC that
// no longer knows this phone, an unreadable key store, pairing), then by the address.
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { UiCopyProvider } from '@ledge/ui/i18n/copy';
import { MeResponseSchema } from '@ledge/protocol';
import type { LinkState, PhoneLink } from './link/link';
import { openFromWorker, replaceRoute, useRoute } from './router';
import { AtelierScreen } from './atelier/AtelierScreen';
import { Agents } from './screens/Agents';
import { Chat } from './screens/Chat';
import { Compare } from './screens/Compare';
import { Choose, Recover } from './screens/Recover';
import { usePlatform } from './screens/device';
import { ProtectStep } from './screens/Enroll';
import { Connection } from './screens/Connection';
import { NotifyStep, offersNotifications } from './screens/Notifications';
import { Denied } from './screens/Denied';
import { Inbox, clock } from './screens/Inbox';
import { KeyChanged } from './screens/KeyChanged';
import { Login, signinError } from './screens/Login';
import { Replaced } from './screens/Offline';
import { ChatUnavailable, EmptyPane, Prs, Rigs } from './screens/NotSent';
import { Rail, ShellProvider, TabBar, TopBar, lookOf, type ShellLink } from './shell/Shell';
import { atoiBadge, remember, tabOf, type Tab } from './shell/tabs';
import { requestsOf } from './model/requests';
import { RequestDetail } from './screens/RequestDetail';
import { StorageUnavailable } from './screens/StorageUnavailable';
import { Terminal } from './screens/Terminal';
import { Thread } from './screens/Thread';
import { Unrecognized } from './screens/Unrecognized';
import { Update } from './screens/Update';
import { copy, copyFor, useLang } from './copy';
import { Split, SplitEmpty, useWide } from './ui/layout';
import { ownName } from './screens/ThisDevice';
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
  // A language chosen in Réglages renders the whole app again in it, on the same screen (m0-langue.html, §1).
  const lang = useLang();
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
  // The PC did not confirm that it removed this phone when the user left.
  const [forgetNote, setForgetNote] = useState(false);
  // « Voir ce qui attend » was tapped: the pairing's outcome is no longer the screen.
  const [doneSeen, setDoneSeen] = useState(false);
  // The step after « Protéger les accords »: « Être prévenu quand un agent attend ».
  const [notifyStep, setNotifyStep] = useState(false);
  // A pairing was started from this page (by itself or by a tap): the ref guards against a second start in the same
  // commit, the state draws the screen.
  const startedRef = useRef(false);
  const [started, setStarted] = useState(false);
  const step = link.pairing()?.state() ?? null;
  const recovery = link.recovery()?.state() ?? null;
  const recovering = recovery?.step === 'reaching' || recovery?.step === 'faceid' || recovery?.step === 'checking';
  const platform = usePlatform();
  // The pairing by code was chosen after the passkey was found too old (screen 2 c): its last step offers the update (4 i).
  const [sawOld, setSawOld] = useState(false);
  // Screen 1 d offers the notifications until the PC's snapshot says whether this device can have them; once offered, the
  // step stays, so the snapshot arriving does not swap it for another button under the user's finger.
  const [recoverNotify, setRecoverNotify] = useState(false);
  const wantsNotify = recovery?.step === 'done' && (!mobile.fresh || offersNotifications(mobile.device?.push));
  useEffect(() => { if (wantsNotify) setRecoverNotify(true); }, [wantsNotify]);
  useEffect(() => { if (recovery && recovery.step !== 'done') setRecoverNotify(false); }, [recovery?.step]);

  const loginError = signinError(issue);
  const kind = issue === 'not_allowed' ? 'denied'
    : state === 'signed_out' || loginError || issue === 'another' ? 'login'
    : state === 'replaced' ? 'replaced'
    : state === 'key_changed' ? 'keyChanged'
    : state === 'denied' ? 'unrecognized'
    : state === 'storage_unavailable' ? 'storage'
    : recovery?.step === 'done' && !doneSeen ? 'recover'
    : step?.step === 'linked' && !doneSeen ? 'compare'
    : state === 'unpaired' || state === 'pairing'
      // An app without a key opens on the choice (passkey-reinstall.html, 1 a): the code once chosen, the passkey's screens while it runs.
      ? (step !== null || started || (state === 'pairing' && !recovering) ? 'compare' : recovery && recovery.step !== 'cancelled' ? 'recover' : 'choose')
    : 'route';
  const begin = (start: () => void) => { startedRef.current = true; setStarted(true); start(); };
  const pairByCode = () => { setSawOld(recovery?.step === 'failed' && recovery.why === 'old'); begin(() => link.startPairing()); };
  useEffect(() => {
    if (state === 'ready') { startedRef.current = false; setStarted(false); setKeysLost(false); setForgetNote(false); }
    if (state === 'unpaired' || state === 'pairing') { setDoneSeen(false); setNotifyStep(false); }
  }, [state]);
  // A tap on a notification: the service worker tells the page where to go.
  useEffect(() => {
    const sw = globalThis.navigator?.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => openFromWorker(e.data);
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, []);

  // The app opens on « À toi » (question Q7); a shared link or a notification opens the screen it names. Each tab remembers
  // the screen it was left on, and Réglages lights the tab it was opened from.
  const lastTab = useRef<Tab>('atoi');
  const tab = tabOf(route);
  if (tab) lastTab.current = tab;
  useEffect(() => { remember(route); }, [route]);

  const wide = useWide();
  // `#/atelier` on a phone, or once the PC says it has no Atelier (an older daemon): the agents instead. Before the first
  // snapshot the last known PC decides, so an offline iPad keeps its Atelier.
  const atelierOff = route.name === 'atelier' && (!wide || ((mobile.fresh || mobile.daemon !== null) && !mobile.daemon?.atelier));
  useEffect(() => { if (atelierOff) replaceRoute({ name: 'sessions' }); }, [atelierOff]);
  // A device the PC knows by id but that has no name yet names itself once, after its model and browser (docs/mockups/
  // mobile-multi-device.html, part 3): the PC then shows « iPad · Safari », and so do the other devices' threads.
  const named = useRef(false);
  const unnamed = state === 'ready' && mobile.fresh && !!mobile.device?.id && !mobile.device.name;
  useEffect(() => {
    if (!unnamed || named.current) return;
    if (store.renameDevice(ownName(undefined)) !== null) named.current = true;
  }, [unnamed, store]);
  const pinned = link.pinned();
  // The pinned PC only while pairing: the name the old PC gave is not the one being paired.
  const pairingName = pinned?.name ?? null;
  const pcName = pinned?.name ?? mobile.daemon?.name ?? null;
  const retry = () => link.retry();
  // Leaving (signing out, relinking) first asks the PC to remove this phone. Without its confirmation (offline, no
  // answer in time) the phone is erased all the same, and the note says the PC still has to be told. A PC that
  // denied this phone has already removed it.
  const leaving = useRef(false);
  const leave = (then: () => void) => {
    if (leaving.current) return;
    if (state !== 'ready') {
      if (state !== 'denied') setForgetNote(true);
      then();
      return;
    }
    leaving.current = true;
    void store.forgetDevice().then((applied) => {
      leaving.current = false;
      if (!applied) setForgetNote(true);
      then();
    });
  };
  const signOut = () => leave(() => { void link.signOut(); });
  const relink = () => leave(() => begin(() => { void link.relink(); }));

  const screen = (() => {
    switch (kind) {
      case 'denied': return <Denied onOther={() => setIssue('another')} />;
      case 'login': return <Login server={relay} error={loginError} />;
      case 'replaced': return <Replaced onHere={() => globalThis.location.reload()} />;
      case 'keyChanged':
        return <KeyChanged pcName={pcName} known={pinned} received={link.receivedKey()} onRelink={relink} onSignOut={signOut} />;
      case 'unrecognized':
        return <Unrecognized pcName={pcName} onRelink={relink} onSignOut={signOut} />;
      case 'storage': return <StorageUnavailable onRetry={retry} onReload={() => globalThis.location.reload()} />;
      case 'choose':
        return <Choose login={login} platform={platform} onPasskey={() => link.startRecovery()} onCode={pairByCode} />;
      case 'recover':
        return (
          <Recover
            state={recovery!} login={login} reach={link.reach()}
            onRetry={() => { if (!link.recovery()?.again()) link.startRecovery(); }}
            onCode={pairByCode} onCancel={() => link.recovery()?.cancel()} onSignOut={signOut} onDone={() => setDoneSeen(true)}
            actions={recoverNotify
              ? <NotifyStep store={store} fetchImpl={fetchImpl} body={copy.recover.done.notify} onDone={() => setDoneSeen(true)} />
              : undefined}
          />
        );
      case 'compare':
        return (
          <Compare
            step={step} login={login} pcName={pairingName} lost={keysLost}
            stalled={state === 'unpaired' && step === null && started}
            reach={link.reach()} onRetry={retry}
            onSame={() => link.pairing()?.confirmOnPhone()} onCancel={() => link.pairing()?.cancel()}
            onRestart={() => begin(() => link.startPairing())} onDone={() => setDoneSeen(true)}
            actions={notifyStep
              ? <NotifyStep store={store} fetchImpl={fetchImpl} onDone={() => { setNotifyStep(false); setDoneSeen(true); }} />
              : <ProtectStep store={store} update={sawOld} onDone={() => { if (offersNotifications(mobile.device?.push)) setNotifyStep(true); else setDoneSeen(true); }} />}
          />
        );
    }
    const shell: ShellLink = { pc: pcName, look: lookOf(mobile.fresh, !!mobile.syncedAt, link.reach()), reach: link.reach(), since: clock(mobile.syncedAt), retry };
    const badges = { atoi: atoiBadge(requestsOf([...mobile.sessions.values()]), mobile.asks ?? []) };
    const inbox = <Inbox store={store} />;
    const sessions = <Agents store={store} />;
    // The Ledge tab: the chat when the PC offers it (or, offline, while that is not known yet); else it says the PC does not.
    const chat = mobile.device?.chat || (!mobile.fresh && !mobile.device) ? <Chat store={store} onReconnect={retry} /> : <ChatUnavailable />;
    const connection = <Connection store={store} fetchImpl={fetchImpl} login={login} relay={relay} pinned={pinned} linkState={state} build={build} onSignOut={signOut} section={route.name === 'connection' ? route.section : undefined} />;
    // A wide screen keeps the list on the left and opens what it lists on the right (m0-socle.html, §2), the rail on its left.
    if (wide) {
      const content = (() => {
        switch (route.name) {
          case 'atoi': return <Split list={inbox} detail={<SplitEmpty {...copy.split.request} />} />;
          case 'request': return <Split list={inbox} detail={<RequestDetail key={route.sessionId} store={store} sessionId={route.sessionId} requestKey={route.key} onReconnect={retry} />} />;
          case 'sessions': return <Split list={sessions} detail={<SplitEmpty {...copy.split.agent} />} />;
          case 'thread': return <Split list={sessions} detail={<Thread key={route.sessionId} store={store} sessionId={route.sessionId} storage={storage} onReconnect={retry} />} />;
          case 'terminal': return <Split list={sessions} detail={<Terminal key={route.sessionId} store={store} link={link} sessionId={route.sessionId} storage={storage} />} />;
          case 'prs': return <Split list={<Prs />} detail={<EmptyPane icon="pr" {...copy.prs.pane} />} />;
          case 'rigs': return <Split list={<Rigs />} detail={<EmptyPane icon="rigs" {...copy.rigs.pane} />} />;
          case 'atelier': return mobile.daemon?.atelier
            ? <AtelierScreen store={store} {...(route.sessionId ? { sessionId: route.sessionId } : {})} {...(route.requestKey ? { requestKey: route.requestKey } : {})} storage={storage} onReconnect={retry} />
            : <Split list={sessions} detail={<SplitEmpty {...copy.split.agent} />} />;
          case 'chat': return chat;
          case 'connection': return connection;
        }
      })();
      return <ShellProvider value={shell}>{content}<Rail route={route} active={tab ?? 'settings'} badges={badges} atelier={!!mobile.daemon?.atelier} /></ShellProvider>;
    }
    // A phone: the five tabs, always there (m0-socle.html, §1); the header above a tab's screen, a thread, a terminal, a request
    // and Réglages bring their own.
    const framed = (body: ReactNode, top = true) => (
      <ShellProvider value={shell}>
        {top && <TopBar />}
        {body}
        <TabBar route={route} active={tab ?? lastTab.current} badges={badges} />
      </ShellProvider>
    );
    switch (route.name) {
      case 'atoi': return framed(inbox);
      case 'sessions': case 'atelier': return framed(sessions);
      case 'prs': return framed(<Prs />);
      case 'rigs': return framed(<Rigs />);
      case 'chat': return framed(chat);
      case 'connection': return framed(connection, false);
      case 'thread': return framed(<Thread key={route.sessionId} store={store} sessionId={route.sessionId} storage={storage} onReconnect={retry} />, false);
      case 'terminal': return framed(<Terminal key={route.sessionId} store={store} link={link} sessionId={route.sessionId} storage={storage} />, false);
      // Keyed by the session only: a request replaced in place rewrites the address, and must not start the screen over.
      case 'request': return framed(<RequestDetail key={route.sessionId} store={store} sessionId={route.sessionId} requestKey={route.key} onReconnect={retry} />, false);
    }
  })();

  return (
    <UiCopyProvider copy={copyFor(lang).ui}>
    <div className="app flex flex-col" data-route={route.name}>
      {forgetNote && state !== 'ready' && <p role="status" className="mx-4 my-3 text-body text-muted">{copy.forget.pending}</p>}
      {screen}
      {updates && waiting && waiting.fingerprint !== later && (
        <Update next={waiting} current={build} onLater={() => setLater(waiting.fingerprint)} onApply={() => updates.accept()} />
      )}
    </div>
    </UiCopyProvider>
  );
}
