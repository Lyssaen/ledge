import { GitHubError, type DeviceCode, type DevicePoll, type GitHub, type GitHubUser } from '../src/github.js';

/** Access tokens all start with this, so a test can look for any of them in logs. */
export const FAKE_ACCESS_PREFIX = 'gho_fake_';

/**
 * An in-memory GitHub. Device codes stay pending until `approve` or `deny`; web codes come from `codeFor`.
 * Every call first consumes a failure armed by `failNext`. `holdDeviceStart` keeps the next `deviceStart` pending.
 */
export function fakeGitHub(): GitHub & {
  approve(deviceCode: string, user: GitHubUser): void;
  deny(deviceCode: string): void;
  codeFor(user: GitHubUser): string;
  failNext(code: 'unavailable' | 'rejected'): void;
  /** The next `deviceStart` waits until `release()`; `reached` resolves once it is waiting. */
  holdDeviceStart(): { reached: Promise<void>; release(): void };
} {
  let n = 0;
  const devices = new Map<string, { state: 'pending' } | { state: 'approved'; user: GitHubUser } | { state: 'denied' }>();
  const codes = new Map<string, GitHubUser>();
  const tokens = new Map<string, GitHubUser>();
  let failure: 'unavailable' | 'rejected' | null = null;
  let hold: { arrived(): void; gate: Promise<void> } | null = null;

  const maybeFail = () => {
    if (!failure) return;
    const code = failure;
    failure = null;
    throw new GitHubError(code);
  };
  const issueToken = (user: GitHubUser) => {
    const token = `${FAKE_ACCESS_PREFIX}${++n}`;
    tokens.set(token, user);
    return token;
  };

  return {
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({ client_id: 'fake', redirect_uri: redirectUri, state });
      return `https://github.fake/login/oauth/authorize?${q.toString()}`;
    },
    async exchangeCode(code) {
      maybeFail();
      const user = codes.get(code);
      if (!user) throw new GitHubError('rejected');
      codes.delete(code);
      return issueToken(user);
    },
    async deviceStart(): Promise<DeviceCode> {
      maybeFail();
      if (hold) {
        const h = hold;
        hold = null;
        h.arrived();
        await h.gate;
      }
      const deviceCode = `dc_fake_${++n}`;
      devices.set(deviceCode, { state: 'pending' });
      return { deviceCode, userCode: `UC-${n}`, verificationUri: 'https://github.fake/login/device', expiresIn: 900, interval: 5 };
    },
    async devicePoll(deviceCode): Promise<DevicePoll> {
      maybeFail();
      const d = devices.get(deviceCode);
      if (!d) return { status: 'expired' };
      if (d.state === 'pending') return { status: 'pending' };
      devices.delete(deviceCode);
      if (d.state === 'denied') return { status: 'denied' };
      return { status: 'ok', accessToken: issueToken(d.user) };
    },
    async user(accessToken) {
      maybeFail();
      const user = tokens.get(accessToken);
      if (!user) throw new GitHubError('rejected');
      return { ...user };
    },
    approve(deviceCode, user) {
      if (devices.has(deviceCode)) devices.set(deviceCode, { state: 'approved', user: { ...user } });
    },
    deny(deviceCode) {
      if (devices.has(deviceCode)) devices.set(deviceCode, { state: 'denied' });
    },
    codeFor(user) {
      const code = `code_fake_${++n}`;
      codes.set(code, { ...user });
      return code;
    },
    failNext(code) {
      failure = code;
    },
    holdDeviceStart() {
      let release!: () => void;
      let arrived!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const reached = new Promise<void>((r) => { arrived = r; });
      hold = { arrived, gate };
      return { reached, release };
    }
  };
}
