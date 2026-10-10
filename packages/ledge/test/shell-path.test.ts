import { describe, it, expect } from 'vitest';
import { loginShellPath, pathCommand } from '../src/shell-path.js';

describe('pathCommand', () => {
  it('asks fish for its PATH joined with colons, any other shell for $PATH as is', () => {
    expect(pathCommand('/usr/bin/fish')).toEqual(['/usr/bin/fish', '-l', '-c', 'string join : $PATH']);
    expect(pathCommand('/bin/bash')).toEqual(['/bin/bash', '-l', '-c', 'printf %s "$PATH"']);
    expect(pathCommand('/bin/zsh')).toEqual(['/bin/zsh', '-l', '-c', 'printf %s "$PATH"']);
  });
});

describe('loginShellPath', () => {
  it('returns the PATH a login shell starts with', async () => {
    const p = await loginShellPath({ shell: '/bin/sh', fallback: '/fallback' });
    expect(p).not.toBe('/fallback');
    expect(p.split(':')).toContain('/usr/bin');
  });
  it('falls back when the shell cannot run or prints nothing', async () => {
    expect(await loginShellPath({ shell: '/nonexistent/shell', fallback: '/fallback' })).toBe('/fallback');
    expect(await loginShellPath({ shell: '/bin/sh', fallback: '/fallback', command: () => ['/bin/sh', '-c', 'exit 3'] })).toBe('/fallback');
    expect(await loginShellPath({ shell: '/bin/sh', fallback: '/fallback', command: () => ['/bin/sh', '-c', 'printf ""'] })).toBe('/fallback');
  });
  it('gives up on a shell that hangs', async () => {
    expect(await loginShellPath({ shell: '/bin/sh', fallback: '/fallback', timeoutMs: 100, command: () => ['/bin/sh', '-c', 'sleep 5'] })).toBe('/fallback');
  });
});
