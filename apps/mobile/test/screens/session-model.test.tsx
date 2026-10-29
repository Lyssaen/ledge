import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PhoneServerMessage } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { SessionModelChip, SessionModelNote } from '../../src/screens/SessionModel';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const claude = [
  { id: 'opus', label: 'Opus', efforts: ['low', 'medium', 'high'] },
  { id: 'sonnet', label: 'Sonnet', isDefault: true, efforts: ['low', 'medium', 'high'] }
];
const withModels = (s: ReturnType<typeof session>[], models = true): PhoneServerMessage => {
  const m = snapshot(s) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  return models ? { ...m, daemon: { ...m.daemon!, models: true } } : m;
};

function opened(extra: Partial<ReturnType<typeof session>> = {}, listing: { tool: string; models: typeof claude; error?: true } = { tool: 'claude', models: claude }) {
  const t = setup();
  const s = session('a', { name: 'Cleo', model: 'opus', effort: 'high', canSwitch: true, ...extra });
  t.deliver(withModels([s]));
  t.deliver({ type: 'models.listing', ...listing } as PhoneServerMessage);
  const view = render(<><SessionModelChip store={t.store} session={s} /><SessionModelNote store={t.store} session={s} /></>);
  return { t, s, view };
}
const openSheet = () => { fireEvent.click(screen.getByRole('button', { name: /Modèle et effort :/ })); return within(screen.getByRole('dialog')); };

describe('the model chip', () => {
  it('no chip without daemon.models', () => {
    const t = setup();
    const s = session('a', { canSwitch: true });
    t.deliver(withModels([s], false));
    render(<SessionModelChip store={t.store} session={s} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('no chip when canSwitch is absent', () => {
    opened({ canSwitch: undefined });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('chip shows Opus · Élevé', () => {
    opened();
    expect(screen.getByRole('button', { name: 'Modèle et effort : Opus · Élevé' })).toHaveTextContent('Opus · Élevé');
  });

  it('chip shows the next pick and au prochain tour', () => {
    opened({ state: 'working', modelNext: { model: 'sonnet', effort: 'medium' } });
    const chip = screen.getByRole('button', { name: /Modèle et effort/ });
    expect(chip).toHaveTextContent('Sonnet · Moyen');
    expect(chip).toHaveTextContent('au prochain tour');
  });

  it('opening the sheet asks the models of the tool', () => {
    const { t } = opened();
    openSheet();
    expect(t.of('models.list')).toEqual([{ type: 'models.list', tool: 'claude' }]);
  });

  it('Appliquer is disabled while the pick equals what runs', () => {
    opened();
    const sheet = openSheet();
    expect(sheet.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
    fireEvent.click(sheet.getByRole('button', { name: /Sonnet/ }));
    expect(sheet.getByRole('button', { name: 'Appliquer' })).toBeEnabled();
    fireEvent.click(sheet.getByRole('button', { name: /Opus/ }));
    expect(sheet.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
  });

  it('nothing is sent by picking, only by Appliquer', () => {
    const { t } = opened();
    const sheet = openSheet();
    fireEvent.click(sheet.getByRole('button', { name: /Sonnet/ }));
    expect(t.of('session.model')).toEqual([]);
  });

  it('Appliquer sends changeModel with the pick', () => {
    const { t } = opened();
    const sheet = openSheet();
    fireEvent.click(sheet.getByRole('button', { name: /Sonnet/ }));
    fireEvent.click(sheet.getByRole('radio', { name: 'Moyen' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Appliquer' }));
    expect(t.of('session.model')).toMatchObject([{ id: 'a', model: 'sonnet', effort: 'medium' }]);
  });

  it('choosing Par défaut sends null', () => {
    const { t } = opened({ effort: undefined });
    const sheet = openSheet();
    fireEvent.click(sheet.getByRole('button', { name: /Par défaut/ }));
    fireEvent.click(sheet.getByRole('button', { name: 'Appliquer' }));
    expect(t.of('session.model')).toMatchObject([{ id: 'a', model: null, effort: null }]);
  });

  it('the sheet closes once the change is applied', async () => {
    const { t } = opened();
    const sheet = openSheet();
    fireEvent.click(sheet.getByRole('button', { name: /Sonnet/ }));
    fireEvent.click(sheet.getByRole('button', { name: 'Appliquer' }));
    const sent = t.of('session.model')[0] as { op: string };
    await act(async () => { t.deliver({ type: 'operation.result', op: sent.op, status: 'applied' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a refusal stays in the sheet, in words', async () => {
    const { t } = opened();
    const sheet = openSheet();
    fireEvent.click(sheet.getByRole('button', { name: /Sonnet/ }));
    fireEvent.click(sheet.getByRole('button', { name: 'Appliquer' }));
    const sent = t.of('session.model')[0] as { op: string };
    await act(async () => { t.deliver({ type: 'operation.result', op: sent.op, status: 'rejected', reason: 'not_launched' }); });
    expect(screen.getByRole('alert')).toHaveTextContent('pas lancé par Ledge');
  });

  it('effort control hidden for cursor', () => {
    opened({ tool: 'cursor', model: 'auto', effort: undefined }, { tool: 'cursor', models: [{ id: 'auto', label: 'Auto', efforts: ['low'] }] });
    const sheet = openSheet();
    expect(sheet.queryByText('Effort')).toBeNull();
    expect(sheet.queryByRole('radio')).toBeNull();
  });

  it('Annuler le changement sends what runs', () => {
    const { t } = opened({ state: 'working', modelNext: { model: 'sonnet', effort: 'low' } });
    const sheet = openSheet();
    fireEvent.click(sheet.getByRole('button', { name: 'Annuler le changement' }));
    expect(t.of('session.model')).toMatchObject([{ id: 'a', model: 'opus', effort: 'high' }]);
  });

  it('no Annuler le changement without a change waiting', () => {
    opened();
    expect(openSheet().queryByRole('button', { name: 'Annuler le changement' })).toBeNull();
  });

  it('a list error still shows Par défaut and the running model', () => {
    opened({}, { tool: 'claude', models: [], error: true });
    const sheet = openSheet();
    expect(sheet.getByText('Liste des modèles indisponible')).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: /Par défaut/ })).toBeInTheDocument();
    const running = sheet.getByRole('button', { name: /opus/ });
    expect(running).toHaveTextContent('actuel');
  });

  it('the note says the agent works when it does', () => {
    opened({ state: 'working' });
    expect(openSheet().getByText('Cleo travaille : le changement attendra la fin de son tour.')).toBeInTheDocument();
  });

  it('a late failure shows its line', () => {
    const { t } = opened();
    act(() => t.deliver({ type: 'session.model.failed', id: 'a', reason: 'restart_failed' }));
    expect(screen.getByText('Changement de modèle non appliqué : le redémarrage a échoué')).toBeInTheDocument();
  });
});
