import { useEffect } from 'react';
import { copy } from '../copy';
import type { PinnedPc } from '../link/keys';
import type { LinkState } from '../link/link';
import { groupFingerprint } from '../model/fingerprint';
import { href } from '../router';
import { formatFingerprint } from '../sw/fingerprint';
import { useMobile, type MobileStore } from '../state/store';
import type { BuildInfo } from '../sw/types';
import { BackLink } from '../ui/Header';
import { OUTLINE } from '../ui/Board';
import { Segmented } from '../ui/Segmented';
import { setTheme, useThemeChoice, type ThemeChoice } from '../theme';
import { ProtectRow } from './Enroll';
import { NotificationsRow } from './Notifications';
import { PcSection } from './PcSection';
import { LedgePrefs, ManagedOnPc, MotionRow, NotificationPrefs } from './Settings';
import { ProjectsSection } from './Projects';
import { ThisDevice } from './ThisDevice';
import { olderThan } from '../state/pc';

const N = copy.connection;
const S = copy.settings;
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: N.themes.system }, { value: 'light', label: N.themes.light }, { value: 'dark', label: N.themes.dark }
];
const status = (s: LinkState): string => s === 'ready' ? N.states.online : s === 'handshaking' ? N.states.connecting : N.states.offline;

/**
 * Réglages (the `connection` route): this device (its name, its look), its notifications, Ledge's settings it may change, the
 * PC's update, the link (the account, the relay, the PC this phone trusts and the app it runs, each one checkable), what only
 * the PC sets, and the way out.
 */
export function Connection({ store, login, relay, pinned, linkState, build, onSignOut, fetchImpl, section }: {
  store: MobileStore;
  /** `link`: opened from the host pill, on its « Connexion » section. */
  section?: 'link' | undefined; fetchImpl?: typeof fetch; login: string | null; relay: string; pinned: PinnedPc | null; linkState: LinkState;
  /** The running app's version and fingerprint, from the service worker; null until it gives them. */
  build: BuildInfo | null;
  onSignOut: () => void;
}) {
  const state = useMobile(store);
  const theme = useThemeChoice();
  useEffect(() => { if (section === 'link') document.getElementById('link-title')?.scrollIntoView({ block: 'start' }); }, [section]);
  const pc = pinned?.name ?? state.daemon?.name ?? null;
  // The PC's version, in the warning colour when it is older than this app.
  const behind = !!state.daemon && !!build && olderThan(state.daemon.version, build.version);
  const rows: [string, string, boolean, string?][] = [
    [N.account, login ? copy.account(login) : N.unknown, false],
    [N.relay, relay, true],
    [N.pc, pc ?? N.unknown, false],
    [N.pcFingerprint, pinned ? groupFingerprint(pinned.fingerprint) : N.unknown, true],
    [N.status, status(linkState), false],
    [N.version, build?.version ?? N.none, true],
    [N.appFingerprint, build ? formatFingerprint(build.fingerprint) : N.none, true],
    [N.pcVersion, state.daemon?.version ?? N.none, true, behind ? 'text-attention' : undefined]
  ];
  return (
    <>
      {/* Pushed over the tab it was opened from (m0-socle.html, §5): back, « Réglages ». */}
      <header className="bleed flex h-14 flex-none items-center gap-2 border-b border-line pr-1.5 pl-2.5">
        <BackLink fallback={{ name: 'atoi' }} label={N.back} />
        <h1 className="text-base font-semibold">{N.title}</h1>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pt-5 pb-[34px]">
        <ThisDevice store={store} pinned={pinned} />
        <section aria-labelledby="appearance-title" className="flex flex-col gap-2.5">
          <h2 id="appearance-title" className="text-small font-medium text-muted">{S.appearance}</h2>
          <Segmented name="theme" legend={N.appearance} options={THEMES} value={theme} onChange={v => setTheme(v)} />
          <MotionRow />
        </section>
        {state.device?.push && (
          <section aria-labelledby="notifications-title" className="flex flex-col gap-2.5">
            <h2 id="notifications-title" className="text-small font-medium text-muted">{S.notifications}</h2>
            <dl className="flex flex-col rounded-[10px] border border-line bg-surface text-body">
              <NotificationsRow store={store} fetchImpl={fetchImpl} />
            </dl>
            <NotificationPrefs store={store} />
          </section>
        )}
        <LedgePrefs store={store} />
        <ProjectsSection store={store} />
        <PcSection store={store} appVersion={build?.version ?? null} />
        <section aria-labelledby="link-title" className="flex flex-col gap-2.5">
          <h2 id="link-title" className="text-small font-medium text-muted">{N.section}</h2>
          <dl className="flex flex-col rounded-[10px] border border-line bg-surface text-body">
            {rows.map(([label, value, mono, tone]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
                <dt className="flex-none text-muted">{label}</dt>
                <dd className={`min-w-0 text-right break-words ${mono ? 'font-mono' : ''} ${tone ?? ''}`}>{value}</dd>
              </div>
            ))}
            <ProtectRow store={store} />
          </dl>
        </section>
        <ManagedOnPc store={store} />
        <div className="flex-grow" aria-hidden="true" />
        <button type="button" onClick={onSignOut} className={OUTLINE}>{N.signOut}</button>
      </main>
    </>
  );
}
