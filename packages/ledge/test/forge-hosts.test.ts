import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signedInHosts } from '../src/daemon/forge/hosts.js';

/** A home with gh's and glab's config files as they are written (host names; the token values here are fake). */
function home(gh: string, glab: string): string {
  const h = mkdtempSync(join(tmpdir(), 'ledge-hosts-'));
  mkdirSync(join(h, '.config', 'gh'), { recursive: true }); mkdirSync(join(h, '.config', 'glab-cli'), { recursive: true });
  writeFileSync(join(h, '.config', 'gh', 'hosts.yml'), gh);
  writeFileSync(join(h, '.config', 'glab-cli', 'config.yml'), glab);
  return h;
}
const GH = 'github.com:\n    users:\n        me:\n    git_protocol: ssh\n    user: me\nghe.corp.example:\n    user: me\n';
const GLAB = 'git_protocol: ssh\nhosts:\n    gitlab.com:\n        token: fake\n        api_host: gitlab.com\n    gitlab.corp.example:\n        api_protocol: https\nno_prompt: true\n';

describe('the hosts a forge CLI is signed in to', () => {
  it('reads gh\'s hosts.yml and glab\'s hosts section, host names only', async () => {
    const h = home(GH, GLAB);
    expect([...await signedInHosts('gh', { HOME: h })].sort()).toEqual(['ghe.corp.example', 'github.com']);
    expect([...await signedInHosts('glab', { HOME: h })].sort()).toEqual(['gitlab.com', 'gitlab.corp.example']);
  });
  it('nothing without a config, unless a host or a token is in the environment', async () => {
    const h = mkdtempSync(join(tmpdir(), 'ledge-hosts-none-'));
    expect([...await signedInHosts('gh', { HOME: h })]).toEqual([]);
    expect([...await signedInHosts('glab', { HOME: h })]).toEqual([]);
    expect([...await signedInHosts('gh', { HOME: h, GH_TOKEN: 'x' })]).toEqual(['github.com']);
    expect([...await signedInHosts('glab', { HOME: h, GITLAB_TOKEN: 'x' })]).toEqual(['gitlab.com']);
    // A token with GITLAB_HOST is meant for that host only.
    expect([...await signedInHosts('glab', { HOME: h, GITLAB_TOKEN: 'x', GITLAB_HOST: 'https://gitlab.corp.example/' })]).toEqual(['gitlab.corp.example']);
  });
  it('follows GH_CONFIG_DIR, GLAB_CONFIG_DIR and XDG_CONFIG_HOME', async () => {
    const h = home(GH, GLAB);
    expect([...await signedInHosts('gh', { HOME: '/nowhere', GH_CONFIG_DIR: join(h, '.config', 'gh') })]).toContain('github.com');
    expect([...await signedInHosts('glab', { HOME: '/nowhere', XDG_CONFIG_HOME: join(h, '.config') })]).toContain('gitlab.com');
  });
});
