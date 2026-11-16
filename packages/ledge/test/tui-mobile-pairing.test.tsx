import { afterEach, describe, expect, it } from 'vitest';
import type { MobileState } from '@ledge/protocol';
import { startTui } from './tui-fixture.js';
import { until } from './helpers.js';

const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const base = (over: Partial<MobileState> = {}): MobileState => ({
  enabled: true, relayUrl: 'https://relay.example', account: { login: 'octocat', accountId: '1' }, signin: null, signinError: null, link: { state: 'online' },
  devices: [], pairings: [{ id: 'p1', label: 'Pixel 8', code: '472 915 308', expiresAt: at(5), state: 'confirm' }], ...over
} as MobileState);
const iphone = { id: 'd1', label: 'iPhone', name: 'iPhone perso', approvedAt: '2026-11-03T10:00:00.000Z', online: false, lastSeenAt: '2026-11-10T10:00:00.000Z' };

let tui: Awaited<ReturnType<typeof startTui>> | undefined;
afterEach(async () => { await tui?.cleanup(); tui = undefined; });

describe('the pairing alert and « Lier un appareil »', () => {
  it('shows the alert line and the badge on the overview', async () => {
    tui = await startTui({ mobile: base() });
    await until(() => tui!.frame().includes('Pixel 8 demande à se lier à ton PC'));
    expect(tui.frame()).toContain('▯ 1');
    expect(tui.frame()).toMatch(/ L  lier/);
  });

  it('keeps the badge but not the alert line on the Mobile screen', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press(',');
    for (let i = 0; i < 4; i++) await tui.press('j');
    await tui.press('\r');
    await until(() => tui!.frame().includes('ACCÈS MOBILE'));
    expect(tui.frame()).not.toContain('demande à se lier à ton PC');
    expect(tui.frame()).toContain('▯ 1');
  });

  it('opens on L with the spaced code, and y approves', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('L');
    await until(() => tui!.frame().includes('LIER UN APPAREIL'));
    expect(tui.frame()).toContain('4 7 2 · 9 1 5 · 3 0 8');
    expect(tui.frame()).toMatch(/expire dans [45]:\d\d/);
    await tui.press('y');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.pairing.approve', id: 'p1' }]);
  });

  it('offers to replace the old device, ticked, and r unticks it', async () => {
    tui = await startTui({ mobile: base({ devices: [iphone], pairings: [{ id: 'p1', label: 'iPhone', code: '472 915 308', expiresAt: at(5), state: 'confirm' }] }) });
    await tui.press('L');
    await until(() => tui!.frame().includes('[x] Remplacer l’ancien « iPhone perso »'));
    await tui.press('y');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.pairing.approve', id: 'p1', replaces: 'd1' }]);
  });

  it('r unticks the replacement: y then sends no replaces', async () => {
    tui = await startTui({ mobile: base({ devices: [iphone], pairings: [{ id: 'p1', label: 'iPhone', code: '472 915 308', expiresAt: at(5), state: 'confirm' }] }) });
    await tui.press('L');
    await until(() => tui!.frame().includes('[x] Remplacer'));
    await tui.press('r');
    await until(() => tui!.frame().includes('[ ] Remplacer'));
    await tui.press('y');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.pairing.approve', id: 'p1' }]);
  });

  it('denies on n', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('L');
    await until(() => tui!.frame().includes('LIER UN APPAREIL'));
    await tui.press('n');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.pairing.deny', id: 'p1' }]);
  });

  it('follows the pairing: approved, linked, expired', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('L');
    await until(() => tui!.frame().includes('LIER UN APPAREIL'));
    const push = (state: string) => tui!.daemon.push({ type: 'mobile', state: base({ pairings: [{ id: 'p1', label: 'Pixel 8', code: '472 915 308', expiresAt: at(5), state } as never] }) });
    push('approved');
    await until(() => tui!.frame().includes('Approuvé sur ce PC.'));
    push('linked');
    await until(() => tui!.frame().includes('Pixel 8 est lié.'));
    push('expired');
    await until(() => tui!.frame().includes('La demande a expiré.'));
  });

  it('opens the oldest of two pairings', async () => {
    tui = await startTui({ mobile: base({ pairings: [
      { id: 'late', label: 'Late', code: '111 111 111', expiresAt: at(9), state: 'confirm' },
      { id: 'early', label: 'Early', code: '222 222 222', expiresAt: at(2), state: 'confirm' }] }) });
    await until(() => tui!.frame().includes('▯ 2'));
    await tui.press('L');
    await until(() => tui!.frame().includes('2 2 2 · 2 2 2 · 2 2 2'));
    await tui.press('y');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.pairing.approve', id: 'early' }]);
  });

  it('ignores L in the Ask composer', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('/');
    await tui.press('L');
    expect(tui.frame()).not.toContain('LIER UN APPAREIL');
    // The composer's own line holds the draft; the alert line and the key bar say « L » too, so they cannot tell.
    expect(tui.frame()).toMatch(/❯ L/);
    await tui.press('y');
    expect(tui.sentMobile()).toEqual([]);
  });

  it('closes on esc and the alert line stays', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('L');
    await until(() => tui!.frame().includes('LIER UN APPAREIL'));
    await tui.press('\x1b');
    await until(() => !tui!.frame().includes('LIER UN APPAREIL'));
    expect(tui.frame()).toContain('Pixel 8 demande à se lier à ton PC');
    expect(tui.frame()).toContain('À TOI');
  });

  it('gives approved the short body: no code, no countdown', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('L');
    await until(() => tui!.frame().includes('LIER UN APPAREIL'));
    tui.daemon.push({ type: 'mobile', state: base({ pairings: [{ id: 'p1', label: 'Pixel 8', code: '472 915 308', expiresAt: at(5), state: 'approved' }] }) });
    await until(() => tui!.frame().includes('Confirme maintenant sur Pixel 8.'));
    expect(tui.frame()).not.toContain('4 7 2');
    expect(tui.frame()).not.toContain('expire dans');
  });

  it('takes y and n before the screen: no session answer is sent', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('L');
    await until(() => tui!.frame().includes('LIER UN APPAREIL'));
    await tui.press('y');
    await tui.press('n');
    const sessionMsgs = () => tui!.daemon.received.filter(m => !m.type.startsWith('mobile.') && m.type.startsWith('session.'));
    expect(sessionMsgs()).toEqual([]);
    // Without the dialog the same key does answer the pending request (the control).
    await tui.press('\x1b');
    await until(() => !tui!.frame().includes('LIER UN APPAREIL'));
    await tui.press('y');
    await until(() => tui!.daemon.received.some(m => !m.type.startsWith('mobile.') && /session|decision|answer|approve/.test(m.type)));
  });

  it('sends one approval however many times y is pressed', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('L');
    await until(() => tui!.frame().includes('LIER UN APPAREIL'));
    await tui.press('y');
    await tui.press('y');
    await tui.press('n');
    expect(tui.sentMobile()).toHaveLength(1);
  });

  it('closes when the pairing leaves the state', async () => {
    tui = await startTui({ mobile: base() });
    await tui.press('L');
    await until(() => tui!.frame().includes('LIER UN APPAREIL'));
    tui.daemon.push({ type: 'mobile', state: base({ pairings: [] }) });
    await until(() => !tui!.frame().includes('LIER UN APPAREIL'));
  });

  it('counts down, and shows expired when the daemon says so', async () => {
    tui = await startTui({ mobile: base({ pairings: [{ id: 'p1', label: 'Pixel 8', code: '472 915 308', expiresAt: new Date(Date.now() + 61_500).toISOString(), state: 'confirm' }] }) });
    await tui.press('L');
    const left = () => /expire dans (\d+):(\d\d)/.exec(tui!.frame());
    await until(() => left() !== null);
    const first = Number(left()![1]) * 60 + Number(left()![2]);
    await until(() => { const m = left(); return m !== null && Number(m[1]) * 60 + Number(m[2]) < first; }, 3000);
    tui.daemon.push({ type: 'mobile', state: base({ pairings: [{ id: 'p1', label: 'Pixel 8', code: '472 915 308', expiresAt: at(-1), state: 'expired' }] }) });
    await until(() => tui!.frame().includes('La demande a expiré.'));
  });
});

describe('recovery toasts and daemon refusals', () => {
  const devices = () => base({ pairings: [], devices: [{ ...iphone, name: undefined }] } as Partial<MobileState>);
  const recovery = (event: string) => ({ type: 'mobile.recovery', event, id: 'd1', at: new Date().toISOString() }) as never;

  it('toasts a recovered device', async () => {
    tui = await startTui({ mobile: devices() });
    tui.daemon.push(recovery('recovered'));
    await until(() => tui!.frame().includes('L’iPhone s’est reconnecté avec sa passkey'));
  });

  it('toasts a refused recovery', async () => {
    tui = await startTui({ mobile: devices() });
    tui.daemon.push(recovery('refused'));
    await until(() => tui!.frame().includes('Reconnexion avec la passkey de l’iPhone refusée'));
  });

  it('shows no toast for a blocked recovery', async () => {
    tui = await startTui({ mobile: devices() });
    tui.daemon.push({ type: 'mobile.recovery', event: 'blocked', at: new Date().toISOString() } as never);
    await new Promise(r => setTimeout(r, 200));
    expect(tui.frame()).not.toContain('passkey');
  });

  it('toasts the message of a refused mobile command', async () => {
    tui = await startTui({ mobile: devices() });
    tui.daemon.push({ type: 'error', request: 'mobile.set', message: 'Relay URL refused' } as never);
    await until(() => tui!.frame().includes('Relay URL refused'));
  });
});
