import { afterEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: core.invoke }));
const notification = vi.hoisted(() => ({ isPermissionGranted: vi.fn(), requestPermission: vi.fn(), sendNotification: vi.fn() }));
vi.mock('@tauri-apps/plugin-notification', () => notification);
import { foregroundIsTerminal, setTrayLabels, showToast } from '../src/tauri/bridge';

const inTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.clearAllMocks(); });

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
