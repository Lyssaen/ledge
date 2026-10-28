import { copy } from '../copy';
import type { PinnedPc } from '../link/keys';
import type { LinkState } from '../link/link';
import { groupFingerprint } from '../model/fingerprint';
import { href } from '../router';
import { formatFingerprint } from '../sw/fingerprint';
import { useMobile, type MobileStore } from '../state/store';
import type { BuildInfo } from '../sw/types';
import { BackHeader, linkView } from '../ui/Header';
import { OUTLINE } from '../ui/Board';
import { Segmented } from '../ui/Segmented';
import { setTheme, useThemeChoice, type ThemeChoice } from '../theme';
import { ProtectRow } from './Enroll';
import { NotificationsRow } from './Notifications';
import { PcSection } from './PcSection';
import { olderThan } from '../state/pc';

const N = copy.connection;
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: N.themes.system }, { value: 'light', label: N.themes.light }, { value: 'dark', label: N.themes.dark }
];
const status = (s: LinkState): string => s === 'ready' ? N.states.online : s === 'handshaking' ? N.states.connecting : N.states.offline;

/** The account, the relay, the PC this phone trusts and the app it runs, each one checkable, the theme, and the way out. */
export function Connection({ store, login, relay, pinned, linkState, build, onSignOut, fetchImpl }: {
  store: MobileStore; fetchImpl?: typeof fetch; login: string | null; relay: string; pinned: PinnedPc | null; linkState: LinkState;
  /** The running app's version and fingerprint, from the service worker; null until it gives them. */
  build: BuildInfo | null;
  onSignOut: () => void;
}) {
  const state = useMobile(store);
  const theme = useThemeChoice();
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
      <BackHeader title={N.title} fallback={{ name: 'inbox' }} label={N.back} link={linkView(state)} />
      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pt-5 pb-[34px]">
        <dl className="flex flex-col rounded-control border border-line bg-surface text-body">
          {rows.map(([label, value, mono, tone]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
              <dt className="flex-none text-muted">{label}</dt>
              <dd className={`min-w-0 text-right break-words ${mono ? 'font-mono' : ''} ${tone ?? ''}`}>{value}</dd>
            </div>
          ))}
          <ProtectRow store={store} />
          <NotificationsRow store={store} fetchImpl={fetchImpl} />
        </dl>
        <PcSection store={store} appVersion={build?.version ?? null} />
        <section aria-labelledby="appearance-title" className="flex flex-col gap-2.5">
          <h2 id="appearance-title" className="text-body text-muted">{N.appearance}</h2>
          <Segmented name="theme" legend={N.appearance} options={THEMES} value={theme} onChange={v => setTheme(v)} />
        </section>
        <div className="flex-grow" aria-hidden="true" />
        <button type="button" onClick={onSignOut} className={OUTLINE}>{N.signOut}</button>
      </main>
    </>
  );
}
