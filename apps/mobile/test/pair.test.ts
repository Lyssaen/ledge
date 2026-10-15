import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { guessDeviceName, isIosBrowserTab, PairFailure, completePairing, requestChallenge, savePairing, type PairSocket } from '../src/connection/pair';
import { Pairing } from '../src/screens/Pairing';
import { copy } from '../src/copy';
import { mobileStore } from '../src/state/store';
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
const CH = { type: 'pair.challenge', options: { challenge: 'abc' }, expiresAt: '2099-01-01T00:00:00.000Z' };
const held = async (replies: Record<string, unknown>[]) => {
  const f = fakeSocket(replies);
  const ch = await requestChallenge('123456', () => Promise.resolve(f.socket));
  return { f, ch };
};
const cdeps = (startRegistration = vi.fn().mockResolvedValue(REG)) => ({ startRegistration: startRegistration as never, deviceName: 'iPhone' });

beforeEach(() => localStorage.clear());

describe('pairing phases', () => {
  it('pairs: options held, then registration and complete, then returns the token and device', async () => {
    const { f, ch } = await held([CH, { type: 'pair.done', token: 'tok', deviceId: 'dev-9' }]);
    expect(f.sent).toEqual([{ type: 'pair.options', code: '123456' }]);
    expect(f.isClosed()).toBe(false);
    const reg = vi.fn().mockResolvedValue(REG);
    const r = await completePairing('123456', ch, cdeps(reg));
    expect(r).toEqual({ token: 'tok', deviceId: 'dev-9' });
    expect(reg).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc' } });
    expect(f.sent[1]).toEqual({ type: 'pair.complete', code: '123456', deviceName: 'iPhone', webauthn: REG });
    expect(f.isClosed()).toBe(true);
    savePairing(r, 'iPhone');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
    expect(JSON.parse(localStorage.getItem(DEVICE_KEY)!)).toEqual({ id: 'dev-9', name: 'iPhone' });
  });

  it('calls startRegistration synchronously, before any socket await (iOS user activation)', async () => {
    const { ch } = await held([CH, { type: 'pair.done', token: 'tok', deviceId: 'd' }]);
    const reg = vi.fn().mockResolvedValue(REG);
    const p = completePairing('123456', ch, cdeps(reg));
    expect(reg).toHaveBeenCalledTimes(1);
    await p;
  });

  it('maps pair.error reasons to failures and closes the socket', async () => {
    for (const reason of ['invalid_code', 'expired', 'locked', 'no_window'] as const) {
      const f = fakeSocket([{ type: 'pair.error', reason }]);
      await expect(requestChallenge('000000', () => Promise.resolve(f.socket))).rejects.toMatchObject({ reason });
      expect(f.isClosed()).toBe(true);
    }
  });

  it('fails with webauthn_failed when the device check is refused, and with the daemon reason on complete', async () => {
    const a = await held([CH]);
    await expect(completePairing('123456', a.ch, cdeps(vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'))))).rejects.toMatchObject({ reason: 'webauthn_failed' });
    expect(a.f.isClosed()).toBe(true);
    const b = await held([CH, { type: 'pair.error', reason: 'expired' }]);
    await expect(completePairing('123456', b.ch, cdeps())).rejects.toMatchObject({ reason: 'expired' });
  });

  it('refuses an expired challenge without calling the device check', async () => {
    const { f, ch } = await held([CH]);
    const reg = vi.fn();
    await expect(completePairing('123456', ch, { ...cdeps(reg), now: () => Date.parse('2100-01-01') })).rejects.toMatchObject({ reason: 'expired' });
    expect(reg).not.toHaveBeenCalled(); expect(f.isClosed()).toBe(true);
  });

  it('fails with network when the socket cannot open or drops', async () => {
    await expect(requestChallenge('123456', () => Promise.reject(new Error('x')))).rejects.toMatchObject({ reason: 'network' });
    await expect(requestChallenge('123456', () => Promise.resolve(fakeSocket([]).socket))).rejects.toMatchObject({ reason: 'network' });
    const { ch } = await held([CH]);
    await expect(completePairing('123456', ch, cdeps())).rejects.toMatchObject({ reason: 'network' });
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

  it('asks the PC at the sixth digit, verifies from a second tap, keeps the code on error, then reaches the done step', async () => {
    const onContinue = vi.fn();
    const ch = { socket: { send: vi.fn(), receive: vi.fn(), close: vi.fn() }, options: {}, expiresAt: Date.now() + 60_000 };
    const request = vi.fn().mockRejectedValueOnce(new PairFailure('invalid_code')).mockResolvedValue(ch);
    const complete = vi.fn().mockResolvedValue({ token: 'tok', deviceId: 'd' });
    const onSaved = vi.fn();
    const enable = vi.fn().mockResolvedValue('granted');
    render(createElement(Pairing, { onContinue, onSaved, enable, request, complete, iosTab: false }));
    goToCode();
    const input = screen.getByLabelText(copy.pairing.codeLabel) as HTMLInputElement;
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(input, { target: { value: '12a34' } });
    expect(input.value).toBe('1234');
    expect(screen.getByRole('button', { name: copy.pairing.steps[2].button })).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '123456' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.pairing.errors.invalid_code);
    expect(input.value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: copy.pairing.steps[2].button }));
    const verify = await screen.findByRole('button', { name: copy.pairing.verify });
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(verify);
    expect(complete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Vous êtes connecté' })).toBeInTheDocument());
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
    expect(onSaved).toHaveBeenCalledTimes(1);
    // Step 4 waits for the PC's push key, then the tap asks permission and moves on only once granted.
    expect(screen.getByRole('button', { name: copy.notifications.waiting })).toBeDisabled();
    act(() => mobileStore.apply({ type: 'auth.ok', deviceId: 'd', deviceName: 'T', pcName: 'PC', vapidPublicKey: 'BKEY' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activer les notifications' }));
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({ vapidPublicKey: 'BKEY' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1), { timeout: 4000 }); // after the PC's refusal window
  });

  it('step 4: a refusal stays on the step with a message, and "Plus tard" moves on without asking', async () => {
    const onContinue = vi.fn();
    const enable = vi.fn().mockResolvedValue('denied');
    const ch = { socket: { send: vi.fn(), receive: vi.fn(), close: vi.fn() }, options: {}, expiresAt: Date.now() + 60_000 };
    render(createElement(Pairing, { onContinue, enable, request: vi.fn().mockResolvedValue(ch), complete: vi.fn().mockResolvedValue({ token: 'tok', deviceId: 'd' }), iosTab: false }));
    goToCode();
    fireEvent.change(screen.getByLabelText(copy.pairing.codeLabel), { target: { value: '123456' } });
    fireEvent.click(await screen.findByRole('button', { name: copy.pairing.verify }));
    await screen.findByRole('heading', { name: 'Vous êtes connecté' });
    act(() => mobileStore.apply({ type: 'auth.ok', deviceId: 'd', deviceName: 'T', pcName: 'PC', vapidPublicKey: 'BKEY' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activer les notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.notifications.denied);
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  const reachStep4 = async (enable: ReturnType<typeof vi.fn>) => {
    const ch = { socket: { send: vi.fn(), receive: vi.fn(), close: vi.fn() }, options: {}, expiresAt: Date.now() + 60_000 };
    render(createElement(Pairing, { onContinue: vi.fn(), enable: enable as never, request: vi.fn().mockResolvedValue(ch), complete: vi.fn().mockResolvedValue({ token: 'tok', deviceId: 'd' }), iosTab: false }));
    goToCode();
    fireEvent.change(screen.getByLabelText(copy.pairing.codeLabel), { target: { value: '123456' } });
    fireEvent.click(await screen.findByRole('button', { name: copy.pairing.verify }));
    await screen.findByRole('heading', { name: 'Vous êtes connecté' });
    act(() => mobileStore.apply({ type: 'auth.ok', deviceId: 'd', deviceName: 'T', pcName: 'PC', vapidPublicKey: 'BKEY' }));
  };

  it('step 4: a link that dropped before the tap is a failure with retry copy, not a success', async () => {
    const enable = vi.fn().mockImplementation(async (o: { send(m: unknown): boolean }) => (o.send({ type: 'push.subscribe' }) ? 'granted' : 'failed'));
    await reachStep4(enable);
    mobileStore.setLink('offline');
    fireEvent.click(screen.getByRole('button', { name: 'Activer les notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.notifications.failed);
    expect(screen.getByRole('button', { name: 'Activer les notifications' })).toBeEnabled();
  });

  it('step 4: an error reply from the PC to the subscription is a failure', async () => {
    const enable = vi.fn().mockImplementation(async () => { setTimeout(() => mobileStore.apply({ type: 'error', message: 'unsupported push service' }), 20); return 'granted'; });
    await reachStep4(enable);
    fireEvent.click(screen.getByRole('button', { name: 'Activer les notifications' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy.notifications.failed));
  });

  it('goes back to asking for a challenge when the held one fails, and clears the error when stepping back', async () => {
    const ch = { socket: { send: vi.fn(), receive: vi.fn(), close: vi.fn() }, options: {}, expiresAt: Date.now() + 60_000 };
    const request = vi.fn().mockResolvedValue(ch);
    const complete = vi.fn().mockRejectedValue(new PairFailure('expired'));
    render(createElement(Pairing, { onContinue: vi.fn(), request, complete, iosTab: false }));
    goToCode();
    fireEvent.change(screen.getByLabelText(copy.pairing.codeLabel), { target: { value: '123456' } });
    fireEvent.click(await screen.findByRole('button', { name: copy.pairing.verify }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.pairing.errors.expired);
    expect(screen.getByRole('button', { name: copy.pairing.steps[2].button })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: copy.pairing.back }));
    fireEvent.click(screen.getByRole('button', { name: copy.pairing.steps[1].button }));
    expect(screen.queryByRole('alert')?.textContent ?? '').toBe('');
  });
});
