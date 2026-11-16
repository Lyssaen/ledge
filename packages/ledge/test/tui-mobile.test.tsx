import { afterEach, describe, expect, it } from 'vitest';
import type { MobileState } from '@ledge/protocol';
import { startTui } from './tui-fixture.js';
import { until } from './helpers.js';

const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
/** An online account with two linked devices and one pairing waiting for the user's comparison. */
const online = (): MobileState => ({
  enabled: true, relayUrl: 'https://relay.example', account: { login: 'octocat', accountId: '1' }, signin: null, signinError: null, link: { state: 'online' },
  devices: [
    { id: 'd1', label: 'iPhone · Safari', approvedAt: '2026-11-03T10:00:00.000Z', online: true },
    { id: 'd2', label: 'iPad · Safari', approvedAt: '2026-10-28T10:00:00.000Z', online: false }
  ],
  pairings: [{ id: 'p1', label: 'Pixel 8', code: 'ABCD-1234', expiresAt: at(5), state: 'confirm' }]
} as MobileState);

let tui: Awaited<ReturnType<typeof startTui>> | undefined;
afterEach(async () => { await tui?.cleanup(); tui = undefined; });

/** `,` then `j` four times: the « Accès mobile » row of Réglages, then ↵. */
async function open(t: NonNullable<typeof tui>) {
  await t.press(',');
  for (let i = 0; i < 4; i++) await t.press('j');
  await t.press('\r');
}

describe('Réglages › Accès mobile', () => {
  it('shows its row, summed up', async () => {
    tui = await startTui({ mobile: online() });
    await tui.press(',');
    await until(() => tui!.frame().includes('En ligne · 2 appareils · 1 demande'));
    expect(tui.frame()).toContain('Accès mobile');
  });

  it('opens its screen on ↵ and esc goes back to Réglages', async () => {
    tui = await startTui({ mobile: online() });
    await open(tui);
    expect(tui.frame()).toContain('RÉGLAGES › ACCÈS MOBILE');
    await tui.press('\x1b');
    await until(() => !tui!.frame().includes('ACCÈS MOBILE'));
    expect(tui.frame()).toContain('Accès mobile');
    expect(tui.frame()).toContain('Langue');
  });

  it('says the same in English', async () => {
    tui = await startTui({ mobile: online(), lang: 'en' });
    await tui.press(',');
    await until(() => tui!.frame().includes('Online · 2 devices · 1 request'));
    for (let i = 0; i < 4; i++) await tui.press('j');
    await tui.press('\r');
    expect(tui.frame()).toContain('SETTINGS › MOBILE ACCESS');
  });

  it('says « indisponible » for a daemon that says nothing of mobile access', async () => {
    tui = await startTui();
    await tui.press(',');
    expect(tui.frame()).toContain('indisponible');
    expect(tui.sentMobile()).toEqual([]);
  });
});
