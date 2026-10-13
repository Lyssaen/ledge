import { describe, it, expect } from 'vitest';
import { gitRoot, installKind, underSystemd, manualCommand } from '../src/update/self.js';
import { LEDGE_VERSION } from '../src/version.js';

const NPM = '/home/u/.local/share/nvm/v26.7.0/lib/node_modules/@paradow/ledge/dist/cli/index.js';
const CLONE = '/home/u/soft/ledge/packages/ledge/dist/cli/index.js';
const hasGit = (p: string) => p === '/home/u/soft/ledge/.git';

describe('installKind', () => {
  it('is npm under a global node_modules', () => { expect(installKind(NPM, hasGit)).toBe('npm'); });
  it('is git inside a clone', () => { expect(installKind(CLONE, hasGit)).toBe('git'); expect(gitRoot(CLONE, hasGit)).toBe('/home/u/soft/ledge'); });
  it('is unknown elsewhere', () => { expect(installKind('/opt/ledge/index.js', () => false)).toBe('unknown'); });
});

describe('underSystemd', () => {
  const CG = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/ledge-daemon.service\n';
  it('needs both the invocation id and the service cgroup', () => {
    expect(underSystemd({ INVOCATION_ID: 'abc' }, CG)).toBe(true);
    expect(underSystemd({}, CG)).toBe(false);
    expect(underSystemd({ INVOCATION_ID: 'abc' }, '0::/user.slice/session-2.scope\n')).toBe(false);
  });
});

describe('manualCommand', () => {
  it('pulls, rebuilds and restarts from the clone', () => {
    expect(manualCommand('/home/u/soft/ledge')).toBe('cd /home/u/soft/ledge && git pull && pnpm install && pnpm --filter @paradow/ledge build && systemctl --user restart ledge-daemon');
  });
});

describe('LEDGE_VERSION', () => {
  it('falls back to a dev version when not built', () => { expect(LEDGE_VERSION).toBe('0.0.0-dev'); });
});
