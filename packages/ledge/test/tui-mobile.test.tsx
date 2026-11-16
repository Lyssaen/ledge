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
    // The cursor already sits on the account row, which the state asks about.
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
    // The cursor already sits on the account row, which the state asks about.
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signin' }]);
  });

  it('shows the refusal of an account and offers another one', async () => {
    tui = await startTui({ mobile: state({ account: null, link: { state: 'off' } as MobileState['link'], signinError: 'not_allowed' }) });
    await open(tui);
    expect(tui.frame()).toContain('Ce compte GitHub n’est pas autorisé sur ce relais.');
    expect(tui.frame()).toContain('Réessayer avec un autre compte');
    // The cursor already sits on the account row, which the state asks about.
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signin' }]);
  });

  it('says a PC signed out by the relay, and ↵ signs in again', async () => {
    tui = await startTui({ mobile: state({ account: { login: 'octocat', accountId: '1' }, link: { state: 'signed_out', reason: 'other_pc' } }) });
    await open(tui);
    expect(tui.frame()).toContain('Un compte n’a qu’un PC.');
    expect(tui.frame()).toContain('Se reconnecter');
    // The cursor already sits on the account row, which the state asks about.
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

  it('says the daemon is too old when the send throws DaemonOutdated', async () => {
    tui = await startTui({ mobile: state() });
    await open(tui);
    tui.client.fleet!.sendMobile = () => { throw Object.assign(new Error('old'), { name: 'DaemonOutdated' }); };
    await tui.press('\r');
    await until(() => tui!.frame().includes('trop ancien pour l’accès mobile'));
  });
});

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
/** Yesterday at noon, local time: « hier » at any hour of the run. */
const yesterdayNoon = () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(12, 0, 0, 0); return d.toISOString(); };
const two = (): MobileState['devices'] => [
  { id: 'd1', label: 'iPhone · Safari', name: 'iPhone perso', kind: 'phone', approvedAt: '2026-11-03T10:00:00.000Z', online: false, lastSeenAt: ago(2) },
  { id: 'd2', label: 'iPad · Safari', kind: 'tablet', approvedAt: '2026-10-28T10:00:00.000Z', online: false, lastSeenAt: yesterdayNoon() }
] as MobileState['devices'];
/** Opens the screen and moves the cursor `n` rows down from its first row. */
async function openAt(devices: MobileState['devices'], n: number, over: Partial<MobileState> = {}) {
  tui = await startTui({ mobile: state({ devices, ...over }) });
  await open(tui);
  await down(tui, n);
  return tui;
}

describe('Accès mobile › the devices box', () => {
  it('lists the devices, counted, with glyph, name and hint', async () => {
    tui = await startTui({ mobile: state({ devices: two() }) });
    await open(tui);
    const f = tui.frame();
    expect(f).toContain('APPAREILS · 2');
    expect(f).toMatch(/▯ iPhone perso\s+iPhone · Safari · lié le 3 nov · vu il y a 2 min/);
    expect(f).toMatch(/▭ iPad · Safari\s+lié le 28 oct · vu hier/);
  });

  it('says the three lines of an empty box, with the relay host', async () => {
    tui = await startTui({ mobile: state({ relayUrl: 'https://relais.example' }) });
    await open(tui);
    expect(tui.frame()).toContain('Aucun appareil lié.');
    expect(tui.frame()).toContain('relais.example et connecte-toi');
    expect(tui.frame()).toContain('Un code s’affichera ici');
  });

  it('shows a waiting pairing, and ↵ on it opens the dialog', async () => {
    tui = await openAt(two(), 5, { pairings: online().pairings });
    expect(tui.frame()).toContain('! Pixel 8 demande l’accès');
    expect(tui.frame()).toContain('↵ comparer le code');
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([]);
  });

  it('renames on r then ↵, and keeps the field for an empty name', async () => {
    tui = await openAt(two(), 4);
    await tui.press('r');
    await until(() => tui!.frame().includes('Nom [ iPhone perso'));
    await tui.press('\x15');
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([]);
    expect(tui.frame()).toContain('enregistrer');
    await tui.stdin.write('Mon iPhone');
    await until(() => tui!.frame().includes('Mon iPhone'));
    await tui.press('\r');
    await until(() => tui!.sentMobile().length === 1);
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.device.rename', id: 'd1', name: 'Mon iPhone' }]);
  });

  it('cancels the rename on esc, and the letters go to the field', async () => {
    tui = await openAt(two(), 4);
    await tui.press('r');
    await tui.press('x');
    expect(tui.frame()).toContain('iPhone persox');
    await tui.press('\x1b');
    await until(() => !tui!.frame().includes('enregistrer'));
    expect(tui.sentMobile()).toEqual([]);
    expect(tui.frame()).toContain('ACCÈS MOBILE');
  });

  it('closes the rename field, sending nothing, when its device vanishes', async () => {
    tui = await openAt(two(), 4);
    await tui.press('r');
    tui.daemon.push({ type: 'mobile', state: state({ devices: two().slice(1) }) });
    await until(() => !tui!.frame().includes('enregistrer'));
    expect(tui.sentMobile()).toEqual([]);
  });

  it('revokes on x then y, and says so', async () => {
    tui = await openAt(two(), 5);
    await tui.press('x');
    await until(() => tui!.frame().includes('Révoquer iPad · Safari ? Il perd l’accès tout de suite.'));
    expect(tui.frame()).toContain('y / n');
    await tui.press('y');
    await until(() => tui!.frame().includes('iPad · Safari est révoqué.'));
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.device.revoke', id: 'd2' }]);
  });

  it('sends nothing on x then n, nor on x then esc', async () => {
    tui = await openAt(two(), 4);
    await tui.press('x');
    await tui.press('n');
    await until(() => !tui!.frame().includes('y / n'));
    await tui.press('x');
    await tui.press('\x1b');
    await until(() => !tui!.frame().includes('y / n'));
    expect(tui.sentMobile()).toEqual([]);
    expect(tui.frame()).toContain('ACCÈS MOBILE');
  });

  it('shows a recovery to acknowledge, and ↵ sends the ack', async () => {
    const d = two(); d[0] = { ...d[0]!, recovered: { at: ago(1), pending: true } } as never;
    tui = await openAt(d, 4);
    expect(tui.frame()).toContain('Reconnecté');
    // A name the user gave is said as written: only a model takes a capital at the start of the sentence.
    expect(tui.frame()).toContain('iPhone perso s’est reconnecté sans code');
    expect(tui.frame()).toContain('C’était bien moi');
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.device.ack', id: 'd1', what: 'recovered' }]);
  });

  it('shows a refused attempt to acknowledge, and ↵ sends the ack', async () => {
    const d = two(); d[0] = { ...d[0]!, refused: { at: new Date().toISOString() } } as never;
    tui = await openAt(d, 4);
    expect(tui.frame()).toContain('Tentative refusée');
    expect(tui.frame()).toMatch(/Aujourd’hui à \d\d:\d\d, un autre appareil/);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.device.ack', id: 'd1', what: 'refused' }]);
  });

  it('shows a blocked recovery first, and ↵ unblocks', async () => {
    tui = await openAt(two(), 4, { recovery: { blocked: { since: new Date().toISOString(), failures: 3 } } });
    expect(tui.frame()).toContain('⊘ Reconnexion par passkey bloquée : 3 vérifications');
    expect(tui.frame()).toContain('Débloquer');
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.recovery.unblock' }]);
  });

  it('dims the box when access is off, with its well, and gives the devices no cursor', async () => {
    tui = await startTui({ mobile: state({ enabled: false, devices: two(), link: { state: 'off' } as MobileState['link'] }) });
    await open(tui);
    expect(tui.frame()).toContain('Accès désactivé : tes appareils liés ne peuvent pas se connecter.');
    await down(tui, 4);
    await tui.press('x');
    await tui.press('r');
    expect(tui.frame()).not.toContain('Révoquer');
    expect(tui.frame()).not.toContain('Nom [');
    expect(tui.sentMobile()).toEqual([]);
  });

  it('keeps every line within 72 columns for a 40-character name, listed, renamed and revoked', async () => {
    const d = two(); d[0] = { ...d[0]!, name: 'N'.repeat(40) };
    tui = await startTui({ mobile: state({ devices: d }) });
    await tui.resize(72, 40);
    await open(tui);
    await down(tui, 4);
    const fits = () => {
      const lines = tui!.frame().split('\n');
      const box = lines.filter(l => l.startsWith('│') || l.startsWith('╭') || l.startsWith('╰'));
      expect(box.length).toBeGreaterThan(8);
      for (const l of lines) expect([...l].length).toBeLessThanOrEqual(72);
      for (const l of box) expect(l[71]).toMatch(/[│╮╯]/);
    };
    fits();
    await tui.press('r');
    await until(() => tui!.frame().includes('enregistrer'));
    fits();
    await tui.press('\x1b');
    await until(() => !tui!.frame().includes('enregistrer'));
    await tui.press('x');
    await until(() => tui!.frame().includes('y / n'));
    fits();
  });
});

describe('Accès mobile › where the cursor opens', () => {
  it('on the account when it needs a sign-in', async () => {
    tui = await startTui({ mobile: state({ account: null, link: { state: 'off' } as MobileState['link'] }) });
    await open(tui);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.signin' }]);
  });

  it('on État when offline, and on Accès otherwise', async () => {
    tui = await startTui({ mobile: state({ link: { state: 'offline', retryAt: at(1), error: 'x' } }) });
    await open(tui);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.retry' }]);
    await tui.cleanup();
    tui = await startTui({ mobile: state() });
    await open(tui);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.set', enabled: false, relayUrl: 'https://app.kl-ledge.dev' }]);
  });

  it('stays on Accès with a blocked recovery or a pairing waiting', async () => {
    tui = await startTui({ mobile: state({ devices: two(), pairings: online().pairings, recovery: { blocked: { since: ago(5), failures: 3 } } }) });
    await open(tui);
    await tui.press('\r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.set', enabled: false, relayUrl: 'https://app.kl-ledge.dev' }]);
  });
});

describe('Accès mobile › the cursor stays on its row', () => {
  it('keeps the account row when the sign-in ends, so ↵ never toggles access', async () => {
    const flow = { userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresAt: at(14) };
    tui = await startTui({ mobile: state({ account: null, link: { state: 'off' } as MobileState['link'], signin: flow }) });
    await open(tui);
    tui.daemon.push({ type: 'mobile', state: state() });
    await until(() => tui!.frame().includes('@octocat'));
    await tui.press('\r');
    expect(tui.sentMobile().some(m => m.type === 'mobile.set')).toBe(false);
  });
});

describe('Accès mobile › as the mockup draws it at 72 columns', () => {
  const flowless = { account: null, link: { state: 'off' } as MobileState['link'] };

  it('keeps the label and the margin of a row whose hint is cut, with « … » before the right margin', async () => {
    tui = await startTui({ mobile: state({ ...flowless, devices: two() }) });
    await tui.resize(72, 40);
    await open(tui);
    const f = tui.frame();
    expect(f).toContain('│ État                  ○ Pas encore connecté  démarre une fois le co… │');
    expect(f).not.toContain('connecté         confirmé');
  });

  it('shows « Pas encore connecté » alone when another PC signed this one out', async () => {
    tui = await startTui({ mobile: state({ account: null, link: { state: 'signed_out', reason: 'other_pc' } as MobileState['link'], devices: two() }) });
    await tui.resize(72, 40);
    await open(tui);
    expect(tui.frame()).toMatch(/État\s+○ Pas encore connecté\s+│/);
    expect(tui.frame()).not.toContain('démarre une fois');
  });

  it('cuts a text that fills the box before its right margin, as in the mockup', async () => {
    tui = await startTui({ mobile: state({ account: null, link: { state: 'off' } as MobileState['link'], signinError: 'not_allowed', devices: two() }) });
    await tui.resize(72, 40);
    await open(tui);
    expect(tui.frame()).toContain('│                       Ce compte GitHub n’est pas autorisé sur ce re… │');
  });

  it('keeps « esc retour » on the key bar: the screen leaves « ? aide » out', async () => {
    tui = await startTui({ mobile: state({ devices: two() }) });
    await tui.resize(72, 40);
    await open(tui);
    const bar = tui.frame().split('\n').find(l => l.includes('naviguer'))!;
    expect(bar).toContain('j k  naviguer   ↵  ouvrir   r  renommer   x  révoquer   esc  retour');
    expect(bar).not.toContain('aide');
  });

  it('puts the rename keys right after the field', async () => {
    tui = await openAt(two(), 4);
    await tui.press('r');
    await until(() => tui!.frame().includes('Nom ['));
    expect(tui.frame()).toMatch(/Nom \[ iPhone perso\s{11}\]  ↵ enregistrer  esc annuler/);
  });
});

describe('Réglages › the Accès mobile row as the mockup draws it', () => {
  it('ends the selected row with ↵ and offers ↵ ouvrir on the key bar only there', async () => {
    tui = await startTui({ mobile: state({ devices: two() }) });
    await tui.press(',');
    expect(tui.frame()).not.toMatch(/↵\s+ouvrir/);
    await down(tui, 4);
    expect(tui.frame()).toMatch(/Accès mobile\s+● En ligne · 2 appareils\s+↵/);
    expect(tui.frame()).toMatch(/← →\s+changer\s+(L\s+lier\s+)?↵\s+ouvrir\s+esc\s+retour/);
  });
});

describe('Accès mobile › a field or a question holds the keys only while it is drawn', () => {
  it('lets esc leave once access is turned off elsewhere under an open rename field', async () => {
    tui = await openAt(two(), 4);
    await tui.press('r');
    await until(() => tui!.frame().includes('Nom ['));
    tui.daemon.push({ type: 'mobile', state: state({ enabled: false, devices: two(), link: { state: 'off' } as MobileState['link'] }) });
    await until(() => tui!.frame().includes('Accès désactivé'));
    await tui.press('\x1b');
    await until(() => tui!.frame().includes('Langue'));
    await tui.press('\x1b');
    await until(() => !tui!.frame().includes('Langue'));
    expect(tui.sentMobile()).toEqual([]);
  });

  it('lets the keys through once the service stops under an open relay field', async () => {
    tui = await startTui({ mobile: state() });
    await open(tui);
    await down(tui, 1);
    await tui.press('\r');
    await until(() => tui!.frame().includes('enregistrer'));
    tui.daemon.push({ type: 'mobile', state: state({ link: { state: 'unavailable', error: 'EADDRINUSE' } }) });
    await until(() => tui!.frame().includes('EADDRINUSE'));
    await tui.press('\x1b');
    await until(() => tui!.frame().includes('Langue'));
  });

  it('drops an open revoke question when access is turned off: y then sends nothing', async () => {
    tui = await openAt(two(), 5);
    await tui.press('x');
    await until(() => tui!.frame().includes('y / n'));
    tui.daemon.push({ type: 'mobile', state: state({ enabled: false, devices: two(), link: { state: 'off' } as MobileState['link'] }) });
    await until(() => tui!.frame().includes('Accès désactivé'));
    await tui.press('y');
    tui.daemon.push({ type: 'mobile', state: state({ devices: two() }) });
    await until(() => tui!.frame().includes('iPad · Safari'));
    expect(tui.frame()).not.toContain('y / n');
    await tui.press('y');
    expect(tui.sentMobile()).toEqual([]);
  });

  it('never takes ctrl+c, even with a field open', async () => {
    tui = await startTui({ mobile: state({ devices: two() }) });
    await tui.press('/');
    await tui.stdin.write('brouillon');
    await until(() => tui!.frame().includes('brouillon'));
    // A draft keeps the field on esc: tab leaves it for the conversation, where the global keys work.
    await tui.press('\t');
    await open(tui);
    await down(tui, 4);
    await tui.press('r');
    await until(() => tui!.frame().includes('Nom ['));
    await tui.press('\x03');
    await until(() => tui!.frame().includes('Brouillon en cours'));
  });
});

describe('Accès mobile › with the local daemon down', () => {
  it('says the daemon is offline, not too old, when it never spoke of mobile access and is not connected', async () => {
    tui = await startTui();
    await tui.daemon.close();
    await until(() => tui!.client.status() !== 'open');
    await open(tui);
    await until(() => tui!.frame().includes('Le daemon local est hors ligne.'));
    expect(tui.frame()).not.toContain('trop ancien');
  });

  it('says it in English too', async () => {
    tui = await startTui({ lang: 'en' });
    await tui.daemon.close();
    await until(() => tui!.client.status() !== 'open');
    await open(tui);
    await until(() => tui!.frame().includes('The local daemon is offline.'));
  });
});

describe('Accès mobile › the cursor after its row vanishes', () => {
  it('lands on the neighbouring device after revoking the last one, not on Accès', async () => {
    tui = await openAt(two(), 5);
    await tui.press('x');
    await tui.press('y');
    tui.daemon.push({ type: 'mobile', state: state({ devices: two().slice(0, 1) }) });
    await until(() => tui!.frame().includes('APPAREILS · 1'));
    await tui.press('\r');
    await tui.press('r');
    expect(tui.sentMobile()).toEqual([{ type: 'mobile.device.revoke', id: 'd2' }]);
    await until(() => tui!.frame().includes('Nom [ iPhone perso'));
  });

  it('lands on the next device after revoking the first one', async () => {
    tui = await openAt(two(), 4);
    tui.daemon.push({ type: 'mobile', state: state({ devices: two().slice(1) }) });
    await until(() => tui!.frame().includes('APPAREILS · 1'));
    await tui.press('\r');
    await tui.press('r');
    expect(tui.sentMobile()).toEqual([]);
    await until(() => tui!.frame().includes('Nom [ iPad · Safari'));
  });
});

describe('Accès mobile › minors of the final review', () => {
  it('lands back on the « Accès mobile » row of Réglages after esc', async () => {
    tui = await startTui({ mobile: state({ devices: two() }) });
    await open(tui);
    await until(() => tui!.frame().includes('ACCÈS MOBILE'));
    await tui.press('\x1b');
    await until(() => tui!.frame().includes('Langue'));
    expect(tui.frame()).toMatch(/Accès mobile\s+● En ligne · 2 appareils\s+↵/);
  });

  it('draws its marks in ASCII when the terminal asks for it', async () => {
    tui = await startTui({ ascii: true, mobile: state({ devices: two(), pairings: online().pairings, recovery: { blocked: { since: ago(5), failures: 3 } } }) });
    await tui.press(',');
    await until(() => tui!.frame().includes('* En ligne · 2 appareils · 1 demande'));
    await down(tui, 4);
    await tui.press('\r');
    await until(() => tui!.frame().includes('ACCÈS MOBILE'));
    const f = tui.frame();
    expect(f).toContain('* Activé');
    expect(f).toContain('* Connecté au relais');
    expect(f).toContain('x Reconnexion par passkey bloquée');
    expect(f).toContain('! Pixel 8 demande l’accès');
    expect(f).not.toMatch(/[●○◌⊘]/);
  });

  it('keeps « L lier » off the key bar while a field has the keys', async () => {
    tui = await startTui({ mobile: online() });
    await until(() => /L\s+lier/.test(tui!.frame()));
    await tui.press('/');
    await until(() => tui!.frame().includes('QUESTION'));
    expect(tui.frame()).not.toMatch(/L\s+lier/);
  });
});
