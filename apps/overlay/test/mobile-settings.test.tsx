import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { Device } from '@ledge/protocol';
import { MobileSettings } from '../src/surface/MobileSettings';
import { LangProvider } from '../src/i18n/lang';
import { daemonStore } from '../src/daemon/store';

const T = Date.parse('2026-10-14T12:00:00.000Z');
const dev = (id: string, name: string, lastSeenAt?: string): Device => ({ id, name, createdAt: '2026-10-01T00:00:00.000Z', hasKey: true, ...(lastSeenAt ? { lastSeenAt } : {}) });
const withOrigin = (devices: Device[] = []) => ({ devices, origin: 'https://pc.tail.ts.net', listening: true });
const pairing = { code: '481203', expiresAt: new Date(T + 125_000).toISOString(), url: 'https://pc.tail.ts.net/m/#/pair' };
const show = (props: Partial<Parameters<typeof MobileSettings>[0]> = {}, lang: 'en' | 'fr' = 'en', now = () => T) => {
  const onPair = vi.fn(), onRevoke = vi.fn();
  const ui = (p: typeof props) => <LangProvider lang={lang}><MobileSettings state={withOrigin()} pairing={null} now={now} onPair={onPair} onRevoke={onRevoke} {...p} /></LangProvider>;
  const r = render(ui(props));
  return { onPair, onRevoke, rerender: (p: typeof props) => r.rerender(ui(p)) };
};

afterEach(() => { cleanup(); vi.useRealTimers(); daemonStore.reset(); });

describe('<MobileSettings>', () => {
  it('without an origin shows only the enable command', () => {
    show({ state: { devices: [], origin: null, listening: false } });
    expect(screen.getByText('ledge mobile enable --origin https://<machine>.<tailnet>.ts.net')).toBeInTheDocument();
    expect(screen.getByText('See docs/mobile.md')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pair a phone' })).toBeNull();
  });
  it('shows the QR, the grouped code and the countdown, then offers a new code when it expires', () => {
    vi.useFakeTimers();
    let t = T;
    const { onPair, rerender } = show({ pairing }, 'en', () => t);
    expect(screen.getByRole('img', { name: pairing.url }).querySelector('svg')).not.toBeNull();
    expect(screen.getByText('481 203')).toBeInTheDocument();
    expect(screen.getByText('Expires in 2:05')).toBeInTheDocument();
    t = T + 124_000;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Expires in 0:01')).toBeInTheDocument();
    t = T + 125_000;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('img', { name: pairing.url })).toBeNull();
    expect(screen.getByText('Code expired')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New code' }));
    expect(onPair).toHaveBeenCalledTimes(1);
    rerender({ pairing: null });
    expect(screen.getByRole('button', { name: 'Pair a phone' })).toBeInTheDocument();
  });
  it('lists devices with their last connection and revokes in one click', () => {
    const { onRevoke } = show({ state: withOrigin([dev('a', 'iPhone de Joffrey', new Date(T - 120_000).toISOString()), dev('b', 'iPad')]) });
    expect(screen.getByText('iPhone de Joffrey')).toBeInTheDocument();
    expect(screen.getByText('Seen 2m ago')).toBeInTheDocument();
    expect(screen.getByText('Never connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove iPhone de Joffrey' }));
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith('a');
  });
  it('says so while the list loads or when the daemon is unreachable', () => {
    const { rerender } = show({ state: null });
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    rerender({ state: null, online: false });
    expect(screen.getByRole('status')).toHaveTextContent('unreachable');
  });
  it('shows the reason when pairing is refused', () => {
    show({ pairError: 'locked' });
    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts');
  });
  it('has both FR and EN strings', () => {
    show({ state: withOrigin([dev('a', 'iPhone')]) }, 'fr');
    expect(screen.getByRole('button', { name: 'Appairer un téléphone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirer iPhone' })).toBeInTheDocument();
    cleanup();
    show({ state: withOrigin([dev('a', 'iPhone')]) }, 'en');
    expect(screen.getByRole('button', { name: 'Pair a phone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove iPhone' })).toBeInTheDocument();
  });
});

describe('daemon store, mobile', () => {
  it('keeps the pairing code until a new device appears, then returns to the list', () => {
    daemonStore.apply({ type: 'devices', devices: [dev('a', 'iPhone')], origin: 'https://pc.tail.ts.net', listening: true });
    daemonStore.apply({ type: 'pair.code', code: '481203', expiresAt: pairing.expiresAt, url: pairing.url });
    expect(daemonStore.getState().pairing?.code).toBe('481203');
    daemonStore.apply({ type: 'devices', devices: [dev('a', 'iPhone')], origin: 'https://pc.tail.ts.net', listening: true });
    expect(daemonStore.getState().pairing).not.toBeNull();
    daemonStore.apply({ type: 'devices', devices: [dev('a', 'iPhone'), dev('b', 'iPad')], origin: 'https://pc.tail.ts.net', listening: true });
    expect(daemonStore.getState().pairing).toBeNull();
    expect(daemonStore.getState().mobile?.devices).toHaveLength(2);
  });
  it('a refusal clears the code and keeps the reason', () => {
    daemonStore.apply({ type: 'pair.error', reason: 'not_configured' });
    expect(daemonStore.getState()).toMatchObject({ pairing: null, pairError: 'not_configured' });
  });
});
