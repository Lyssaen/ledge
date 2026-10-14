import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { guessDeviceName, isIosBrowserTab, PairFailure, pairDevice, savePairing, type PairSocket } from '../src/connection/pair';
import { Pairing } from '../src/screens/Pairing';
import { copy } from '../src/copy';
import { DEVICE_KEY, TOKEN_KEY } from '../src/state/persist';

const REG = { id: 'c', rawId: 'c', type: 'public-key', response: { clientDataJSON: 'x', attestationObject: 'y' } };
function fakeSocket(replies: Record<string, unknown>[]) {
  const sent: Record<string, unknown>[] = [];
  let closed = false;
  const socket: PairSocket = {
    send: m => { sent.push(m); },
    receive: () => replies.length ? Promise.resolve(replies.shift()!) : Promise.reject(new Error('closed')),
    close: () => { closed = true; }
  };
  return { socket, sent, isClosed: () => closed };
}
const deps = (socket: PairSocket, startRegistration = vi.fn().mockResolvedValue(REG)) =>
  ({ open: () => Promise.resolve(socket), startRegistration: startRegistration as never, deviceName: 'iPhone' });

beforeEach(() => localStorage.clear());

describe('pairDevice', () => {
  it('pairs: options, registration, complete, then returns the token and device', async () => {
    const f = fakeSocket([{ type: 'pair.challenge', options: { challenge: 'abc' }, expiresAt: 'x' }, { type: 'pair.done', token: 'tok', deviceId: 'dev-9' }]);
    const reg = vi.fn().mockResolvedValue(REG);
    const r = await pairDevice('123456', deps(f.socket, reg));
    expect(r).toEqual({ token: 'tok', deviceId: 'dev-9' });
    expect(reg).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc' } });
    expect(f.sent).toEqual([{ type: 'pair.options', code: '123456' }, { type: 'pair.complete', code: '123456', deviceName: 'iPhone', webauthn: REG }]);
    expect(f.isClosed()).toBe(true);
    savePairing(r, 'iPhone');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
    expect(JSON.parse(localStorage.getItem(DEVICE_KEY)!)).toEqual({ id: 'dev-9', name: 'iPhone' });
  });

  it('maps pair.error reasons to failures', async () => {
    for (const reason of ['invalid_code', 'expired', 'locked', 'no_window'] as const) {
      const f = fakeSocket([{ type: 'pair.error', reason }]);
      await expect(pairDevice('000000', deps(f.socket))).rejects.toMatchObject({ reason });
      expect(f.isClosed()).toBe(true);
    }
  });

  it('fails with webauthn_failed when the device verification is refused, and with the daemon reason on complete', async () => {
    const challenge = { type: 'pair.challenge', options: {}, expiresAt: 'x' };
    const refused = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    await expect(pairDevice('123456', deps(fakeSocket([challenge]).socket, refused))).rejects.toMatchObject({ reason: 'webauthn_failed' });
    await expect(pairDevice('123456', deps(fakeSocket([challenge, { type: 'pair.error', reason: 'webauthn_failed' }]).socket))).rejects.toBeInstanceOf(PairFailure);
  });

  it('fails with network when the socket cannot open or drops', async () => {
    await expect(pairDevice('123456', { ...deps(fakeSocket([]).socket), open: () => Promise.reject(new Error('x')) })).rejects.toMatchObject({ reason: 'network' });
    await expect(pairDevice('123456', deps(fakeSocket([]).socket))).rejects.toMatchObject({ reason: 'network' });
  });
});

describe('device helpers', () => {
  it('names the device from the user agent', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe('iPhone');
    expect(guessDeviceName('Mozilla/5.0 (iPad; CPU OS 18_0)')).toBe('iPad');
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 15)')).toBe('Android');
    expect(guessDeviceName('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Navigateur');
  });

  it('detects an iOS browser tab but not the installed app or other platforms', () => {
    const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', platform: 'iPhone', maxTouchPoints: 5 } as Navigator;
    const tab = (() => ({ matches: false })) as unknown as typeof matchMedia;
    const app = (() => ({ matches: true })) as unknown as typeof matchMedia;
    expect(isIosBrowserTab(iphone, tab)).toBe(true);
    expect(isIosBrowserTab(iphone, app)).toBe(false);
    expect(isIosBrowserTab({ ...iphone, standalone: true } as Navigator, tab)).toBe(false);
    expect(isIosBrowserTab({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 } as Navigator, tab)).toBe(true);
    expect(isIosBrowserTab({ userAgent: 'Mozilla/5.0 (Linux; Android 15)', platform: 'Linux', maxTouchPoints: 5 } as Navigator, tab)).toBe(false);
  });
});

describe('Pairing screen', () => {
  const goToCode = () => { fireEvent.click(screen.getByRole('button', { name: copy.pairing.steps[0].button })); fireEvent.click(screen.getByRole('button', { name: copy.pairing.steps[1].button })); };

  it('stays on install instructions inside an iOS Safari tab, with no next button', () => {
    render(createElement(Pairing, { onContinue: vi.fn(), iosTab: true }));
    fireEvent.click(screen.getByRole('button', { name: copy.pairing.steps[0].button }));
    expect(screen.getByRole('heading', { name: copy.pairing.steps[1].title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.pairing.steps[1].button })).toBeNull();
    expect(screen.getByText(copy.pairing.install.body)).toBeInTheDocument();
  });

  it('sends only at six digits, keeps the typed code on error, then reaches the done step', async () => {
    const onContinue = vi.fn();
    const pair = vi.fn().mockRejectedValueOnce(new PairFailure('invalid_code')).mockResolvedValueOnce({ token: 'tok', deviceId: 'd' });
    render(createElement(Pairing, { onContinue, pair, iosTab: false }));
    goToCode();
    const input = screen.getByLabelText(copy.pairing.codeLabel) as HTMLInputElement;
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    const send = screen.getByRole('button', { name: copy.pairing.steps[2].button });
    fireEvent.change(input, { target: { value: '12a34' } });
    expect(input.value).toBe('1234'); expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: '123456' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.pairing.errors.invalid_code);
    expect(input.value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: copy.pairing.steps[2].button }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Vous êtes connecté' })).toBeInTheDocument());
    expect(pair).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(onContinue).toHaveBeenCalled();
  });
});
