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
import { ProtectRow } from './Enroll';
import { NotificationsRow } from './Notifications';

const N = copy.connection;
const status = (s: LinkState): string => s === 'ready' ? N.states.online : s === 'handshaking' ? N.states.connecting : N.states.offline;

/** The account, the relay, the PC this phone trusts and the app it runs, each one checkable, and the way out. */
export function Connection({ store, login, relay, pinned, linkState, build, onSignOut, fetchImpl }: {
  store: MobileStore; fetchImpl?: typeof fetch; login: string | null; relay: string; pinned: PinnedPc | null; linkState: LinkState;
  /** The running app's version and fingerprint, from the service worker; null until it gives them. */
  build: BuildInfo | null;
  onSignOut: () => void;
}) {
  const state = useMobile(store);
  const pc = pinned?.name ?? state.daemon?.name ?? null;
  const rows: [string, string, boolean][] = [
    [N.account, login ? copy.account(login) : N.unknown, false],
    [N.relay, relay, true],
    [N.pc, pc ?? N.unknown, false],
    [N.pcFingerprint, pinned ? groupFingerprint(pinned.fingerprint) : N.unknown, true],
    [N.status, status(linkState), false],
    [N.version, build?.version ?? N.none, true],
    [N.appFingerprint, build ? formatFingerprint(build.fingerprint) : N.none, true]
  ];
  return (
    <>
      <BackHeader title={N.title} backTo={href({ name: 'inbox' })} label={N.back} link={linkView(state)} />
      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pt-5 pb-[34px]">
        <dl className="flex flex-col rounded-control border border-line bg-surface text-[13px]">
          {rows.map(([label, value, mono]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
              <dt className="flex-none text-muted">{label}</dt>
              <dd className={`min-w-0 text-right break-words ${mono ? 'font-mono' : ''}`}>{value}</dd>
            </div>
          ))}
          <ProtectRow store={store} />
          <NotificationsRow store={store} fetchImpl={fetchImpl} />
        </dl>
        <div className="flex-grow" aria-hidden="true" />
        <button type="button" onClick={onSignOut} className={OUTLINE}>{N.signOut}</button>
      </main>
    </>
  );
}
