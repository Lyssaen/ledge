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
    await tui.press('r');
    await until(() => tui!.frame().includes('[ ] Remplacer'));
    await tui.press('y');
    expect(tui.sentMobile()[1]).toEqual({ type: 'mobile.pairing.approve', id: 'p1' });
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
    expect(tui.frame()).toContain('L');
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
});
