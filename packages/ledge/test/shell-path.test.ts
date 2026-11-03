import { describe, it, expect } from 'vitest';
import { envCommand, loginShellEnv, parseEnv } from '../src/shell-path.js';
import { parseRegQuery, windowsRegistryEnv, userEnv } from '../src/shell-path.js';

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

describe('the user environment on Windows (registry)', () => {
  const HKCU = [
    '', 'HKEY_CURRENT_USER\\Environment',
    '    Path    REG_EXPAND_SZ    C:\\Users\\u\\node;%USERPROFILE%\\bin',
    '    TEMP    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Temp',
    '    IntelliJ IDEA    REG_SZ    C:\\Program Files\\JetBrains\\bin',
    '    Weird    REG_EXPAND_SZ    %NOPE%\\x',
    '    Count    REG_DWORD    0x1',
    '    Empty    REG_SZ    ',
    '',
  ].join('\r\n');
  const HKLM = [
    '', 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    '    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\Git\\cmd',
    '    TEMP    REG_EXPAND_SZ    %SystemRoot%\\TEMP',
    '    JAVA_HOME    REG_SZ    C:\\jdk',
    '',
  ].join('\r\n');
  const run = async (key: string) => (key.startsWith('HKCU') ? HKCU : HKLM);

  it('parses reg query: names with spaces, string types only', () => {
    expect(parseRegQuery(HKCU)).toEqual({
      Path: { type: 'REG_EXPAND_SZ', value: 'C:\\Users\\u\\node;%USERPROFILE%\\bin' },
      TEMP: { type: 'REG_EXPAND_SZ', value: '%USERPROFILE%\\AppData\\Local\\Temp' },
      'IntelliJ IDEA': { type: 'REG_SZ', value: 'C:\\Program Files\\JetBrains\\bin' },
      Weird: { type: 'REG_EXPAND_SZ', value: '%NOPE%\\x' },
      Empty: { type: 'REG_SZ', value: '' },
    });
  });

  it('machine then user, the user winning, Path joined, %VAR% expanded, an unknown one kept', async () => {
    const env = await windowsRegistryEnv(run, { USERPROFILE: 'C:\\Users\\u', SystemRoot: 'C:\\WINDOWS' });
    expect(env.Path).toBe('C:\\WINDOWS\\system32;C:\\Program Files\\Git\\cmd;C:\\Users\\u\\node;C:\\Users\\u\\bin');
    expect(env.TEMP).toBe('C:\\Users\\u\\AppData\\Local\\Temp');
    expect(env.JAVA_HOME).toBe('C:\\jdk');
    expect(env.Weird).toBe('%NOPE%\\x');
  });

  it('userEnv: the registry on Windows, the login shell elsewhere', async () => {
    const calls: string[] = [];
    expect((await userEnv('win32', { registry: async () => { calls.push('reg'); return { A: '1' }; }, shell: async () => { calls.push('sh'); return {}; } })).A).toBe('1');
    await userEnv('linux', { registry: async () => { calls.push('reg'); return {}; }, shell: async () => { calls.push('sh'); return {}; } });
    expect(calls).toEqual(['reg', 'sh']);
  });
});
