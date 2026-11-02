import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TeamsEngine } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { Teams } from '../src/settings/Teams';
import type { SettingsContext } from '../src/settings/SettingsPage';
import { SECTIONS } from '../src/nav/state';
import { machine } from './fleet-helpers';

afterEach(cleanup);

type State = { engine: TeamsEngine; openrigAvailable: boolean; running: boolean } | null;
function show(teamsEngine: State, opts: { result?: { ok: boolean; reason?: string; peers?: { machine: string; ok: boolean; reason?: string }[] }; throws?: string; localUp?: boolean; lang?: 'fr' | 'en' } = {}) {
  const calls: TeamsEngine[] = []; const saved: string[] = [];
  const fleet = { async setTeamsEngine(e: TeamsEngine) { calls.push(e); if (opts.throws) throw Object.assign(new Error(opts.throws), { name: opts.throws }); return opts.result ?? { ok: true }; } };
  const ctx = { fleet, teamsEngine, machines: [machine('local', { ready: opts.localUp ?? true }), machine('legion', { label: 'legion', ready: true })], saved: (w: string) => saved.push(w), notify() {} } as unknown as SettingsContext;
  render(<LangProvider lang={opts.lang ?? 'fr'}><Teams ctx={ctx} /></LangProvider>);
  return { calls, saved, user: userEvent.setup() };
}
const ledge = () => screen.getByRole('radio', { name: 'Ledge' });
const openrig = () => screen.getByRole('radio', { name: 'OpenRig' });

describe('Settings › Équipes', () => {
  it('the section exists, and the page lists it', () => {
    expect(SECTIONS).toContain('teams');
    show({ engine: 'ledge', openrigAvailable: true, running: false });
    expect(screen.getByRole('radiogroup', { name: 'Moteur d’équipes' })).toBeVisible();
    expect(ledge()).toBeChecked(); expect(openrig()).not.toBeChecked();
    expect(ledge()).toBeEnabled(); expect(openrig()).toBeEnabled();
  });
  it('OpenRig is greyed, with its reason, when it is installed nowhere', () => {
    show({ engine: 'ledge', openrigAvailable: false, running: false });
    expect(openrig()).toBeDisabled(); expect(ledge()).toBeEnabled();
    expect(screen.getByText(/OpenRig n’est installé sur aucune machine/)).toBeVisible();
  });
  it('both choices are greyed while a team runs, with the reason', () => {
    show({ engine: 'openrig', openrigAvailable: true, running: true });
    expect(ledge()).toBeDisabled(); expect(openrig()).toBeDisabled();
    expect(screen.getByText(/Une équipe tourne : arrête-la pour changer de moteur/)).toBeVisible();
  });
  it('a click on OpenRig calls setTeamsEngine and says it saved', async () => {
    const { calls, saved, user } = show({ engine: 'ledge', openrigAvailable: true, running: false });
    await user.click(openrig());
    expect(calls).toEqual(['openrig']);
    await waitFor(() => expect(saved).toEqual(['Moteur d’équipes : OpenRig']));
  });
  it('a refusal is shown as the daemon said it, and nothing is saved', async () => {
    const { saved, user } = show({ engine: 'ledge', openrigAvailable: true, running: false }, { result: { ok: false, reason: 'rig introuvable' } });
    await user.click(openrig());
    expect(await screen.findByRole('alert')).toHaveTextContent('rig introuvable');
    expect(saved).toEqual([]);
  });
  it('the fleet\'s codes are said in words: offline, and a daemon that did not answer', async () => {
    const { user } = show({ engine: 'ledge', openrigAvailable: true, running: false }, { result: { ok: false, reason: 'timeout' } });
    await user.click(openrig());
    expect(await screen.findByRole('alert')).toHaveTextContent('Le daemon n’a pas répondu.');
    cleanup();
    const second = show({ engine: 'ledge', openrigAvailable: true, running: false }, { result: { ok: false, reason: 'offline' } });
    await second.user.click(openrig());
    expect(await screen.findByRole('alert')).toHaveTextContent('Le daemon local est hors ligne');
  });
  it('saved here, a machine that refused the engine is named with its reason', async () => {
    const { saved, user } = show({ engine: 'ledge', openrigAvailable: true, running: false },
      { result: { ok: true, peers: [{ machine: 'legion', ok: false, reason: 'une équipe Ledge tourne' }, { machine: 'mac', ok: true }] } });
    await user.click(openrig());
    await waitFor(() => expect(saved).toEqual(['Moteur d’équipes : OpenRig']));
    expect(await screen.findByRole('alert')).toHaveTextContent('Changé ici, mais pas sur legion : une équipe Ledge tourne.');
  });
  it('in English the hint has no space before its colon', () => {
    show({ engine: 'ledge', openrigAvailable: true, running: false }, { lang: 'en' });
    expect(screen.getByText(/Ledge: Ledge’s own teams/)).toBeVisible();
    expect(screen.queryByText(/Ledge : /)).toBeNull();
  });
  it('an outdated daemon (no teams.engine) shows the outdated state; a daemon that turns out outdated on click says so', async () => {
    show(null);
    expect(screen.getByRole('status')).toHaveTextContent('trop ancien');
    cleanup();
    const { user } = show({ engine: 'ledge', openrigAvailable: true, running: false }, { throws: 'DaemonOutdated' });
    await user.click(openrig());
    expect(await screen.findByRole('alert')).toHaveTextContent('trop ancien');
  });
});
