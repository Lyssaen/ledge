import { DEFAULT_SOUNDS } from '../src/sounds/preferences';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { loadMonitor, saveMonitor, resolveMonitor, type MonitorInfo } from '../src/monitor';
import { SettingsView, monitorOptions } from '../src/surface/SettingsView';
import { LangProvider } from '../src/i18n/lang';

const main: MonitorInfo = { id: '\\\\.\\DISPLAY1', name: '\\\\.\\DISPLAY1', width: 1920, height: 1080, workH: 1032, primary: true };
const side: MonitorInfo = { id: '\\\\.\\DISPLAY2', name: '\\\\.\\DISPLAY2', width: 2560, height: 1440, workH: 1400, primary: false };
const base = { visible: true, theme: 'dark' as const, dnd: false, reduced: false, osReduced: false, onToggleDnd: () => {}, onReduced: () => {}, onBack: () => {}, onClose: () => {}, finished: 'both' as const, sounds: DEFAULT_SOUNDS, onFinished: () => {}, onSounds: () => {}, onTestSound: () => {} };

describe('the Screen setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('is the primary monitor by default and remembers a chosen monitor id', () => {
    expect(loadMonitor()).toBeNull();
    saveMonitor(side.id);
    expect(loadMonitor()).toBe(side.id);
    expect(localStorage.getItem('ledge.monitor')).toBe(side.id);
    saveMonitor(null);
    expect(loadMonitor()).toBeNull();
    expect(localStorage.getItem('ledge.monitor')).toBeNull();
  });

  it('resolves to the chosen monitor while it is listed, else to the primary', () => {
    expect(resolveMonitor(null, [main, side])).toBe(main);
    expect(resolveMonitor(side.id, [main, side])).toBe(side);
    expect(resolveMonitor('\\\\.\\DISPLAY3', [main, side])).toBe(main);
    expect(resolveMonitor(side.id, [])).toBeUndefined();
    // No monitor reports itself primary: the first one stands in.
    expect(resolveMonitor(null, [{ ...side, primary: false }])).toEqual({ ...side, primary: false });
  });

  it('offers the primary first and numbers the others in the OS order; an unplugged choice stays visible', () => {
    const t = { primary: 'Primary', nth: (n: number) => `Screen ${n}`, missing: 'Unplugged' };
    expect(monitorOptions([main, side], null, t)).toEqual([{ value: 'primary', label: 'Primary' }, { value: side.id, label: 'Screen 2' }]);
    expect(monitorOptions([side, main], null, t)).toEqual([{ value: 'primary', label: 'Primary' }, { value: side.id, label: 'Screen 1' }]);
    expect(monitorOptions([main], '\\\\.\\DISPLAY3', t)).toEqual([{ value: 'primary', label: 'Primary' }, { value: '\\\\.\\DISPLAY3', label: 'Unplugged' }]);
  });

  it('Settings shows the monitors as a radio group with the chosen screen size in the hint; each click reports the choice', () => {
    const onMonitor = vi.fn();
    const { rerender } = render(<SettingsView {...base} monitors={[main, side]} monitor={null} onMonitor={onMonitor} />);
    const group = screen.getByRole('group', { name: 'Screen' });
    expect(within(group).getByRole('radio', { name: 'Primary' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Screen 2' })).not.toBeChecked();
    expect(group.textContent).toContain('The handle sits on the left edge of this screen (1920\u00a0×\u00a01080).');
    fireEvent.click(within(group).getByRole('radio', { name: 'Screen 2' }));
    expect(onMonitor).toHaveBeenLastCalledWith(side.id);
    rerender(<SettingsView {...base} monitors={[main, side]} monitor={side.id} onMonitor={onMonitor} />);
    expect(within(group).getByRole('radio', { name: 'Screen 2' })).toBeChecked();
    expect(group.textContent).toContain('(2560\u00a0×\u00a01440)');
    fireEvent.click(within(group).getByRole('radio', { name: 'Primary' }));
    expect(onMonitor).toHaveBeenLastCalledWith(null);
  });

  it('a chosen monitor that is unplugged is shown checked as such, and the hint falls back to the primary', () => {
    render(<SettingsView {...base} monitors={[main]} monitor={side.id} onMonitor={() => {}} />);
    const group = screen.getByRole('group', { name: 'Screen' });
    expect(within(group).getByRole('radio', { name: 'Unplugged' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Primary' })).not.toBeChecked();
    expect(group.textContent).toContain('(1920\u00a0×\u00a01080)');
  });

  it('without a monitor list (no shell answer yet) the group is not shown', () => {
    render(<SettingsView {...base} />);
    expect(screen.queryByRole('group', { name: 'Screen' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });

  it('the French labels', () => {
    render(<LangProvider lang="fr"><SettingsView {...base} monitors={[main, side]} monitor={side.id} onMonitor={() => {}} /></LangProvider>);
    const group = screen.getByRole('group', { name: 'Écran' });
    expect(within(group).getByRole('radio', { name: 'Principal' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Écran 2' })).toBeChecked();
    expect(group.textContent).toContain('La poignée se pose au bord gauche de cet écran (2560\u00a0×\u00a01440).');
  });
});
