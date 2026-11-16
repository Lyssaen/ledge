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
    await until(() => tui!.frame().includes('indisponible'));
    expect(tui.sentMobile()).toEqual([]);
  });

  it('keeps Réglages\' own back target, with or without a detour by the help', async () => {
    tui = await startTui({ mobile: online() });
    await open(tui);
    await tui.press('\x1b');
    await tui.press('\x1b');
    await until(() => tui!.frame().includes('Otto'));
    await open(tui);
    await tui.press('?');
    await tui.press('\x1b');
    await until(() => tui!.frame().includes('ACCÈS MOBILE'));
    await tui.press('\x1b');
    await until(() => tui!.frame().includes('Langue'));
    await tui.press('\x1b');
    await until(() => tui!.frame().includes('Otto') && !tui!.frame().includes('Langue'));
  }, 20_000);
});

/** The mobile state of an account with a working link, over `over`. */
const state = (over: Partial<MobileState> = {}): MobileState => ({ ...online(), relayUrl: 'https://app.kl-ledge.dev', devices: [], pairings: [], ...over } as MobileState);
const down = async (t: NonNullable<typeof tui>, n: number) => { for (let i = 0; i < n; i++) await t.press('j'); };

describe('Accès mobile › the access box', () => {
  it('shows the relay host only, the account and the state', async () => {
    tui = await startTui({ mobile: state() });
    await open(tui);
    const f = tui.frame();
    expect(f).toContain('app.kl-ledge.dev');
    expect(f).not.toContain('https://app.kl-ledge.dev');
    expect(f).toMatch(/@octocat\s+· se déconnecter/);
    expect(f).toContain('● Connecté au relais');
    expect(f).not.toContain('Taper dans les term.');
  });

  it('toggles Accès on ↵ and on space, keeping the relay', async () => {
    tui = await startTui({ mobile: state() });
    await open(tui);
    await tui.press('\r');
    await tui.press(' ');
    expect(tui.sentMobile()).toEqual([
      { type: 'mobile.set', enabled: false, relayUrl: 'https://app.kl-ledge.dev' },
      { type: 'mobile.set', enabled: false, relayUrl: 'https://app.kl-ledge.dev' }
    ]);
  });

  it('opens the relay field on ↵, refuses a path, keeps letters as text, and sends a good URL', async () => {
    tui = await startTui({ mobile: state() });
    await open(tui);
    await down(tui, 1);
    await tui.press('\r');
    await tui.press('\x15');
    await tui.stdin.write('http://relais.example/ledge');
    await until(() => tui!.frame().includes('http://relais.example/ledge'));
    await tui.press('\r');
    await until(() => tui!.frame().includes('Refusée : https://'));
    expect(tui.sentMobile()).toEqual([]);
    await tui.press('\x15');
    for (const k of ['L', 'x', 'r', 'y', 'n']) await tui.press(k);
    expect(tui.frame()).toContain('Lxryn');
    expect(tui.sentMobile()).toEqual([]);
    expect(tui.frame()).toContain('RÉGLAGES › ACCÈS MOBILE');
    await tui.press('\x15');
    await tui.stdin.write('https://relay.example');
    await until(() => tui!.frame().includes('https://relay.example'));
    await tui.press('\r');
    await until(() => tui!.sentMobile().length === 1);
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.set', enabled: true, relayUrl: 'https://relay.example' }]);
    await until(() => !tui!.frame().includes('enregistrer'));
  });

  it('cancels the relay field on esc without leaving the screen', async () => {
    tui = await startTui({ mobile: state() });
    await open(tui);
    await down(tui, 1);
    await tui.press('\r');
    await tui.press('\x1b');
    await until(() => !tui!.frame().includes('enregistrer'));
    expect(tui.frame()).toContain('ACCÈS MOBILE');
    expect(tui.sentMobile()).toEqual([]);
  });

  it('starts the sign-in from « Compte GitHub » when signed out', async () => {
    tui = await startTui({ mobile: state({ account: null, link: { state: 'off' } as MobileState['link'] }) });
    await open(tui);
    expect(tui.frame()).toContain('Se connecter avec GitHub');
    expect(tui.frame()).toContain('Pas encore connecté');
    await down(tui, 2);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signin' }]);
  });

  it('shows the device code while signing in, copies it with c, and cancels on esc', async () => {
    tui = await startTui({ mobile: state({ account: null, link: { state: 'off' } as MobileState['link'], signin: { userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresAt: at(14) } }) });
    await open(tui);
    const f = tui.frame();
    expect(f).toContain('github.com/login/device');
    expect(f).toContain('et saisis ce code : WDJB-MJHT');
    expect(f).toContain('expire dans 14 min');
    await tui.press('c');
    await until(() => tui!.frame().includes('Copié'));
    expect(tui.written()).toContain(`\x1b]52;c;${Buffer.from('WDJB-MJHT').toString('base64')}\x07`);
    await tui.press('\x1b');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signin.cancel' }]);
    expect(tui.frame()).toContain('ACCÈS MOBILE');
  });

  it('says why a sign-in ended, and ↵ starts it again', async () => {
    tui = await startTui({ mobile: state({ account: null, link: { state: 'off' } as MobileState['link'], signinError: 'expired' }) });
    await open(tui);
    expect(tui.frame()).toContain('Le code a expiré. Recommence la connexion.');
    await down(tui, 2);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signin' }]);
  });

  it('shows the refusal of an account and offers another one', async () => {
    tui = await startTui({ mobile: state({ account: null, link: { state: 'off' } as MobileState['link'], signinError: 'not_allowed' }) });
    await open(tui);
    expect(tui.frame()).toContain('Ce compte GitHub n’est pas autorisé sur ce relais.');
    expect(tui.frame()).toContain('Réessayer avec un autre compte');
    await down(tui, 2);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signin' }]);
  });

  it('says a PC signed out by the relay, and ↵ signs in again', async () => {
    tui = await startTui({ mobile: state({ account: { login: 'octocat', accountId: '1' }, link: { state: 'signed_out', reason: 'other_pc' } }) });
    await open(tui);
    expect(tui.frame()).toContain('Un compte n’a qu’un PC.');
    expect(tui.frame()).toContain('Se reconnecter');
    await down(tui, 2);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signin' }]);
  });

  it('signs out from the signed-in account on ↵', async () => {
    tui = await startTui({ mobile: state() });
    await open(tui);
    await down(tui, 2);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signout' }]);
  });

  it('counts the retry down when offline, and ↵ on État retries', async () => {
    tui = await startTui({ mobile: state({ link: { state: 'offline', retryAt: new Date(Date.now() + 12_000).toISOString(), error: 'ECONNREFUSED' } }) });
    await open(tui);
    expect(tui.frame()).toMatch(/Hors ligne · nouvel essai dans (11|12) s/);
    expect(tui.frame()).toContain('Le relais ne répond pas.');
    await down(tui, 3);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.retry' }]);
  });

  it('says Connexion… while connecting', async () => {
    tui = await startTui({ mobile: state({ link: { state: 'connecting' } }) });
    await open(tui);
    expect(tui.frame()).toContain('◌ Connexion…');
  });

  it('shows « Taper dans les term. » only when the daemon knows it, and toggles it', async () => {
    tui = await startTui({ mobile: state({ terminalInput: false }) });
    await open(tui);
    expect(tui.frame()).toContain('Taper dans les term.');
    await down(tui, 4);
    await tui.press(' ');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.terminal', input: true }]);
  });

  it('puts the rest out of reach when access is off: j stays on Accès', async () => {
    tui = await startTui({ mobile: state({ enabled: false, link: { state: 'off' } as MobileState['link'] }) });
    await open(tui);
    expect(tui.frame()).toContain('Désactivé');
    await down(tui, 2);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.set', enabled: true, relayUrl: 'https://app.kl-ledge.dev' }]);
  });

  it('shows the error of a service that did not start, and nothing else', async () => {
    tui = await startTui({ mobile: state({ link: { state: 'unavailable', error: 'EADDRINUSE 127.0.0.1:7781' } }) });
    await open(tui);
    expect(tui.frame()).toContain('L’accès mobile n’a pas démarré sur ce PC :');
    expect(tui.frame()).toContain('EADDRINUSE 127.0.0.1:7781');
    expect(tui.frame()).not.toContain('Compte GitHub');
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([]);
  });

  it('says the daemon is too old when it never spoke of mobile access', async () => {
    tui = await startTui();
    await tui.press(',');
    for (let i = 0; i < 4; i++) await tui.press('j');
    await tui.press('\r');
    expect(tui.frame()).toContain('trop ancien');
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([]);
    await tui.press('\x1b');
    await until(() => tui!.frame().includes('Langue'));
  });

  it('toasts instead of throwing when the daemon refuses to be sent to', async () => {
    tui = await startTui({ mobile: state() });
    await open(tui);
    tui.client.fleet!.sendMobile = () => { throw Object.assign(new Error('offline'), { name: 'DaemonOffline' }); };
    await tui.press('\r');
    await until(() => tui!.frame().includes('Le daemon local est hors ligne : rien n’a changé.'));
  });
});
