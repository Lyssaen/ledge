import { afterEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({ invoke: vi.fn() }));
const channels = vi.hoisted(() => [] as Array<{ onmessage: (m: unknown) => void }>);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: core.invoke,
  Channel: class { onmessage: (m: unknown) => void = () => {}; constructor() { channels.push(this); } },
}));
const notification = vi.hoisted(() => ({ isPermissionGranted: vi.fn(), requestPermission: vi.fn(), sendNotification: vi.fn() }));
vi.mock('@tauri-apps/plugin-notification', () => notification);
import { foregroundIsTerminal, openPty, setTrayLabels, showToast } from '../src/tauri/bridge';

const inTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
afterEach(() => { channels.length = 0; delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.clearAllMocks(); });

describe('outside the app', () => {
  it('every call is a quiet no-op', async () => {
    expect(await foregroundIsTerminal()).toBe(false);
    expect(await showToast('Otto', 'harness-assistant')).toBe(false);
    expect(() => setTrayLabels({ open: 'Open', newSession: 'New', dnd: 'DND', quit: 'Quit' })).not.toThrow();
    expect(core.invoke).not.toHaveBeenCalled();
    expect(notification.sendNotification).not.toHaveBeenCalled();
  });
});

describe('in the app', () => {
  it('asks the shell whether a terminal is in front, false on failure', async () => {
    inTauri();
    core.invoke.mockResolvedValueOnce(true);
    expect(await foregroundIsTerminal()).toBe(true);
    expect(core.invoke).toHaveBeenCalledWith('foreground_is_terminal', undefined);
    core.invoke.mockRejectedValueOnce(new Error('no'));
    expect(await foregroundIsTerminal()).toBe(false);
  });

  it('renames the tray entries with the Rust argument names', async () => {
    inTauri();
    core.invoke.mockResolvedValue(undefined);
    setTrayLabels({ open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge Desktop' });
    await vi.waitFor(() => expect(core.invoke).toHaveBeenCalledWith('set_tray_labels', { open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge Desktop' }));
  });

  it('sends a toast once permitted, and nothing when refused', async () => {
    inTauri();
    notification.isPermissionGranted.mockResolvedValueOnce(true);
    expect(await showToast('Otto needs your approval', 'Run the tests?')).toBe(true);
    expect(notification.sendNotification).toHaveBeenCalledWith({ title: 'Otto needs your approval', body: 'Run the tests?' });
    notification.isPermissionGranted.mockResolvedValueOnce(false);
    notification.requestPermission.mockResolvedValueOnce('denied');
    expect(await showToast('Nova has finished', 'ledge')).toBe(false);
    expect(notification.sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe('the daemon token source', () => {
  // The source is a module singleton: each case loads a fresh module.
  const fresh = async () => { vi.resetModules(); return import('../src/tauri/bridge'); };
  afterEach(() => { vi.unstubAllEnvs(); });

  it('no token source outside Tauri without VITE_LEDGE_TOKEN', async () => {
    expect((await fresh()).daemonTokenSource()).toBeUndefined();
  });

  it('VITE_LEDGE_TOKEN gives a fixed token', async () => {
    vi.stubEnv('VITE_LEDGE_TOKEN', 'ab12');
    const source = (await fresh()).daemonTokenSource()!;
    expect(await source.get(false)).toEqual({ kind: 'token', token: 'ab12' });
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it('inside Tauri the source asks daemon_token, once per window', async () => {
    inTauri();
    core.invoke.mockResolvedValue({ kind: 'absent' });
    const bridge = await fresh();
    const source = bridge.daemonTokenSource()!;
    expect(bridge.daemonTokenSource()).toBe(source);
    expect(await source.get(false)).toEqual({ kind: 'absent' });
    expect(core.invoke).toHaveBeenCalledWith('daemon_token', undefined);
    expect(source.missing()).toBe(true);
  });
});

describe('the pseudo-terminal', () => {
  it('opens a pty with the Rust argument names and streams raw bytes', async () => {
    inTauri(); core.invoke.mockResolvedValueOnce(0);
    const data = vi.fn(), exit = vi.fn();
    const pty = await openPty(['sh'], { cols: 80, rows: 24 }, { data, exit });
    expect(core.invoke).toHaveBeenCalledWith('pty_open', expect.objectContaining({ argv: ['sh'], cols: 80, rows: 24 }));
    channels[0]!.onmessage(new Uint8Array([104, 105]).buffer); expect(data).toHaveBeenCalledWith(new Uint8Array([104, 105]));
    channels[1]!.onmessage(3); expect(exit).toHaveBeenCalledWith(3);
    core.invoke.mockResolvedValue(undefined);
    pty!.write('ls\r'); expect(core.invoke).toHaveBeenCalledWith('pty_write', { id: 0, data: 'ls\r' });
    pty!.resize(100, 30); expect(core.invoke).toHaveBeenCalledWith('pty_resize', { id: 0, cols: 100, rows: 30 });
  });

  it('closes once and then stops delivering output', async () => {
    inTauri(); core.invoke.mockResolvedValueOnce(5);
    const data = vi.fn();
    const pty = await openPty(['sh'], { cols: 80, rows: 24 }, { data, exit: vi.fn() });
    core.invoke.mockResolvedValue(undefined);
    pty!.close(); pty!.close();
    expect(core.invoke.mock.calls.filter(c => c[0] === 'pty_close')).toEqual([['pty_close', { id: 5 }]]);
    channels[0]!.onmessage(new Uint8Array([1]).buffer); expect(data).not.toHaveBeenCalled();
  });

  it('null when the shell refuses, and outside the app', async () => {
    inTauri(); core.invoke.mockRejectedValueOnce('no wsl');
    expect(await openPty(['sh'], { cols: 80, rows: 24 }, { data: vi.fn(), exit: vi.fn() })).toBeNull();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; core.invoke.mockClear();
    expect(await openPty(['sh'], { cols: 80, rows: 24 }, { data: vi.fn(), exit: vi.fn() })).toBeNull();
    expect(core.invoke).not.toHaveBeenCalled();
  });
});
