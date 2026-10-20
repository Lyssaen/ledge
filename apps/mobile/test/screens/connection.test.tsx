import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

const withPush = (push?: 'on' | 'off' | 'stale' | 'unavailable') => ({ ...snapshot([], 'PC-Desan'), device: { confirm: true, ...(push ? { push } : {}) } }) as never;
const stubBrowser = () => {
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'granted') });
  vi.stubGlobal('PushManager', class {});
};
beforeEach(stubBrowser);
afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(globalThis.navigator, 'standalone'); });

describe('Connection: notifications', () => {
  it('shows nothing from a PC that does not say (no device.push)', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(withPush()));
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('on → « Activées » with a switch that is on', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(withPush('on')));
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Activées')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('off → « Désactivées » with a switch that is off', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(withPush('off')));
    expect(screen.getByText('Désactivées')).toBeInTheDocument();
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('stale → the message, and « Activer les notifications »', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(withPush('stale')));
    expect(screen.getByText('Le PC a changé de clés : réactivez les notifications pour que ce téléphone les reçoive à nouveau.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activer les notifications' })).toBeInTheDocument();
  });

  it('unavailable → the PC cannot', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(withPush('unavailable')));
    expect(screen.getByText('Les notifications ne sont pas disponibles sur ce PC.')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('turning the switch off sends push.unsubscribe', async () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(withPush('on')));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(t.of('push.unsubscribe')).toHaveLength(1));
  });

  it('iOS outside the home screen → the unsupported text on a tap', async () => {
    Object.defineProperty(globalThis.navigator, 'standalone', { configurable: true, value: false });
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(withPush('off')));
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText(/Sur iPhone, ouvrez Ledge depuis son icône/)).toBeInTheDocument();
  });

  it('an activation that does not come through → the failed text', async () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(withPush('off')));
    // The app's stubbed fetch answers /push/key with a body that holds no key.
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText(/L’activation n’a pas abouti/)).toBeInTheDocument();
    expect(t.of('push.subscribe')).toEqual([]);
  });
});
