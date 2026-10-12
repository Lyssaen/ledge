import { describe, it, expect } from 'vitest';
import { envCommand, loginShellEnv, parseEnv } from '../src/shell-path.js';

describe('envCommand', () => {
  it('asks any login shell for its environment, NUL-separated', () => {
    expect(envCommand('/usr/bin/fish')).toEqual(['/usr/bin/fish', '-l', '-c', 'env -0']);
    expect(envCommand('/bin/bash')).toEqual(['/bin/bash', '-l', '-c', 'env -0']);
  });
});

describe('parseEnv', () => {
  it('keeps values with = and newlines, drops shell-local variables', () => {
    expect(parseEnv('PATH=/a:/b\0HTTPS_PROXY=http://p:8080\0X=a=b\nc\0PWD=/tmp\0SHLVL=2\0_=/usr/bin/env\0'))
      .toEqual({ PATH: '/a:/b', HTTPS_PROXY: 'http://p:8080', X: 'a=b\nc' });
  });
});

describe('loginShellEnv', () => {
  it('returns the environment a login shell starts with', async () => {
    const env = await loginShellEnv({ shell: '/bin/sh', command: () => ['/bin/sh', '-c', 'HTTPS_PROXY=http://p:8080 env -0'] });
    expect(env.PATH?.split(':')).toContain('/usr/bin');
    expect(env.HTTPS_PROXY).toBe('http://p:8080');
    expect(env.PWD).toBeUndefined();
  });
  it('returns nothing when the shell cannot run or prints no PATH', async () => {
    expect(await loginShellEnv({ shell: '/nonexistent/shell' })).toEqual({});
    expect(await loginShellEnv({ shell: '/bin/sh', command: () => ['/bin/sh', '-c', 'exit 3'] })).toEqual({});
    expect(await loginShellEnv({ shell: '/bin/sh', command: () => ['/bin/sh', '-c', 'printf ""'] })).toEqual({});
  });
  it('gives up on a shell that hangs', async () => {
    expect(await loginShellEnv({ shell: '/bin/sh', timeoutMs: 100, command: () => ['/bin/sh', '-c', 'sleep 5'] })).toEqual({});
  });
});
