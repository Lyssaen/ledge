import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { readClipboardImage } from '../src/tui/clipboard.js';
import { openImage } from '../src/tui/openImage.js';

const POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const WSL = { WSL_DISTRO_NAME: 'Ubuntu' } as NodeJS.ProcessEnv;
const NO_WSL = {} as NodeJS.ProcessEnv;

/** A PNG header of `w`×`h`: enough for the size sniffer. */
function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

describe('readClipboardImage', () => {
  it('WSL: runs PowerShell from /mnt/c and parses its JSON line, preview included', async () => {
    const main = Buffer.from('main-jpeg-bytes'), prev = Buffer.from('prev');
    const run = vi.fn(async () => ({ stdout: Buffer.from(`${JSON.stringify({ w: 1440, h: 900, main: main.toString('base64'), prev: prev.toString('base64') })}\r\n`) }));
    const got = await readClipboardImage(WSL, run, 'linux');
    expect(got).toEqual({ image: { mime: 'image/jpeg', data: main.toString('base64'), preview: { mime: 'image/jpeg', data: prev.toString('base64') } }, width: 1440, height: 900, bytes: main.length });
    expect(run).toHaveBeenCalledTimes(1);
    const [file, args, o] = run.mock.calls[0] as unknown as [string, string[], { cwd?: string; encoding: string }];
    expect(file).toBe(POWERSHELL);
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-STA', '-Command']);
    expect(args[3]).toContain('Clipboard]::GetImage()');
    expect(args[3]).not.toContain('"');
    expect(o).toMatchObject({ cwd: '/mnt/c', encoding: 'buffer' });
  });

  it('WSL: nothing printed means no image', async () => {
    expect(await readClipboardImage(WSL, async () => ({ stdout: Buffer.from('') }), 'linux')).toBeNull();
    expect(await readClipboardImage(WSL, async () => { throw new Error('boom'); }, 'linux')).toBeNull();
  });

  it('Linux: wl-paste first, no preview', async () => {
    const run = vi.fn(async (_file: string, _args: string[], _o: object) => ({ stdout: png(300, 200) }));
    const got = await readClipboardImage(NO_WSL, run, 'linux');
    expect(got).toMatchObject({ image: { mime: 'image/png' }, width: 300, height: 200, bytes: 40 });
    expect(got!.image.preview).toBeUndefined();
    expect(run.mock.calls[0]![0]).toBe('wl-paste');
    expect(run.mock.calls[0]![1]).toEqual(['--type', 'image/png']);
  });

  it('Linux: falls back to xclip when wl-paste fails, null when both do', async () => {
    const calls: string[] = [];
    const run = async (file: string) => { calls.push(file); if (file === 'wl-paste') throw new Error('not found'); return { stdout: png(10, 20) }; };
    expect(await readClipboardImage(NO_WSL, run, 'linux')).toMatchObject({ width: 10, height: 20 });
    expect(calls).toEqual(['wl-paste', 'xclip']);
    expect(await readClipboardImage(NO_WSL, async () => { throw new Error('none'); }, 'linux')).toBeNull();
  });

  it('Linux: a clipboard that holds no picture is no image', async () => {
    expect(await readClipboardImage(NO_WSL, async () => ({ stdout: Buffer.from('some text') }), 'linux')).toBeNull();
  });

  it('macOS: osascript writes the PNG to a temp file that is read back and removed', async () => {
    let path = '';
    const run = async (_file: string, args: string[]) => { path = /POSIX file "([^"]+)"/.exec(args.join(' '))![1]!; writeFileSync(path, png(64, 32)); return { stdout: Buffer.alloc(0) }; };
    expect(await readClipboardImage(NO_WSL, run, 'darwin')).toMatchObject({ image: { mime: 'image/png' }, width: 64, height: 32 });
    expect(existsSync(path)).toBe(false);
  });
});

/** A spawn that answers like a child process: `wslpath` prints, anything else just starts. */
function fakeSpawn(winpath = 'C:\\tmp\\ledge-images\\a.png') {
  const calls: Array<{ file: string; args: string[]; o: { cwd?: string; detached?: boolean } }> = [];
  const unref = vi.fn();
  const spawn = ((file: string, args: string[], o: { cwd?: string; detached?: boolean }) => {
    calls.push({ file, args, o });
    const child = Object.assign(new EventEmitter(), { stdout: Readable.from([Buffer.from(`${winpath}\n`)]), unref });
    if (file === 'wslpath') child.stdout.on('end', () => setImmediate(() => child.emit('close', 0)));
    else setImmediate(() => child.emit('spawn'));
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  return { spawn, calls, unref };
}

describe('openImage', () => {
  it('WSL: converts the path with wslpath and hands it to explorer.exe, detached', async () => {
    const f = fakeSpawn();
    await openImage('/tmp/ledge-images/a.png', WSL, f.spawn, 'linux');
    expect(f.calls[0]).toMatchObject({ file: 'wslpath', args: ['-w', '/tmp/ledge-images/a.png'] });
    expect(f.calls[1]).toMatchObject({ file: '/mnt/c/Windows/explorer.exe', args: ['C:\\tmp\\ledge-images\\a.png'], o: { cwd: '/mnt/c', detached: true } });
    expect(f.unref).toHaveBeenCalled();
  });

  it('Linux xdg-open, macOS open', async () => {
    const a = fakeSpawn(); await openImage('/x/a.png', NO_WSL, a.spawn, 'linux');
    expect(a.calls).toHaveLength(1); expect(a.calls[0]).toMatchObject({ file: 'xdg-open', args: ['/x/a.png'] });
    const b = fakeSpawn(); await openImage('/x/a.png', NO_WSL, b.spawn, 'darwin');
    expect(b.calls[0]).toMatchObject({ file: 'open', args: ['/x/a.png'] });
  });
});
