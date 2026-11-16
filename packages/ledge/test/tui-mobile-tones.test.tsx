import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileState } from '@ledge/protocol';
import { PALETTES } from '../src/tui/theme.js';
import { startTui } from './tui-fixture.js';
import { until } from './helpers.js';

// Colours in the frames: chalk reads it when first loaded, so before the imports.
vi.hoisted(() => { process.env.FORCE_COLOR = '3'; process.env.COLORTERM = 'truecolor'; });

/** The truecolor sequence Ink writes for a text colour. */
const fgOf = (hex: string) => `\u001b[38;2;${hex.slice(1).match(/../g)!.map(x => parseInt(x, 16)).join(';')}m`;
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const P = PALETTES.dark;
const state = (): MobileState => ({
  enabled: true, relayUrl: 'https://relay.example', account: { login: 'octocat', accountId: '1' }, signin: null, signinError: null, link: { state: 'online' },
  devices: [{ id: 'd1', label: 'iPhone', approvedAt: '2026-11-03T10:00:00.000Z', online: true }], pairings: []
} as MobileState);

let tui: Awaited<ReturnType<typeof startTui>> | undefined;
afterEach(async () => { await tui?.cleanup(); tui = undefined; });

describe('mobile access tones, as the mockup draws them', () => {
  it('toasts a recovered device in the yellow of information, not in green', async () => {
    tui = await startTui({ mobile: state(), theme: 'dark' });
    tui.daemon.push({ type: 'mobile.recovery', event: 'recovered', id: 'd1', at: new Date().toISOString() } as never);
    await until(() => strip(tui!.frame()).includes('L’iPhone s’est reconnecté avec sa passkey'));
    expect(tui.frame()).toContain(`${fgOf(P.yellow)}L’iPhone s’est reconnecté avec sa passkey`);
  });

  it('draws the Réglages summary with a green mark and the text in fg', async () => {
    tui = await startTui({ mobile: state(), theme: 'dark' });
    await tui.press(',');
    await until(() => strip(tui!.frame()).includes('En ligne · 1 appareil'));
    expect(tui.frame()).toContain(`${fgOf(P.green)}● `);
    expect(tui.frame()).toContain(`${fgOf(P.fg)}En ligne · 1 appareil`);
  });
});
