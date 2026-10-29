import { copy } from '../../src/copy';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PhoneCatalog, PhoneSeatModel, PhoneServerMessage, PhoneTeam } from '@ledge/protocol';
import { describe, expect, it, vi } from 'vitest';
import { SeatModelSheet } from '../../src/screens/SeatModel';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const HASH = 'a'.repeat(16);
const claude = [
  { id: 'opus', label: 'Opus', efforts: ['low', 'medium', 'high'] },
  { id: 'sonnet', label: 'Sonnet', isDefault: true, efforts: ['low', 'medium', 'high'] }
];
const catalog = (): PhoneCatalog => ({
  projects: ['ledge'],
  roles: [
    { id: 'leader', label: 'Chef d’équipe', prompt: 'x', scope: 'home', project: null, hash: HASH, tool: 'claude', model: 'opus', effort: 'high', autonomy: 'ask' },
    { id: 'dev', label: 'Développeur', prompt: 'x', scope: 'home', project: null, hash: HASH, tool: 'claude', model: 'sonnet', autonomy: 'ask' },
    { id: 'reviewer', label: 'Relecteur', prompt: 'x', scope: 'home', project: null, hash: HASH, tool: 'claude', model: 'haiku', autonomy: 'ask' }
  ],
  templates: [], problems: []
});
const team = (): PhoneTeam => ({
  id: 'team-a1b2', name: 'Revue', project: 'ledge', state: 'active', done: 0, given: 0,
  seats: [{ role: 'leader', sessionId: 's1' }, { role: 'dev', sessionId: 's2', model: 'sonnet', effort: 'low' }, { role: 'reviewer', sessionId: null }]
});

function opened(role: string, { s1 = {}, s2 = {}, confirm = true }: { s1?: object; s2?: object; confirm?: boolean } = {}) {
  const t = setup();
  const base = snapshot([session('s1', { name: 'Otto', canSwitch: true, model: 'opus', effort: 'high', ...s1 }), session('s2', { name: 'Bram', canSwitch: true, ...s2 })], 'PC', undefined, { confirm, chat: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  t.deliver({ ...base, daemon: { ...base.daemon!, models: true } });
  act(() => {
    t.deliver({ type: 'teams.catalog', catalog: catalog() });
    t.deliver({ type: 'teams', teams: [team()] });
    t.deliver({ type: 'models.listing', tool: 'claude', models: claude } as PhoneServerMessage);
  });
  const onClose = vi.fn();
  render(<SeatModelSheet store={t.store} team={team()} role={role} onClose={onClose} />);
  const teamOp = vi.spyOn(t.store, 'teamOp').mockResolvedValue({ status: 'applied' });
  return { ...t, teamOp, onClose };
}
const apply = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Appliquer' })); }); };
const pickSonnet = () => fireEvent.click(screen.getByRole('button', { name: /Sonnet/ }));
const result = (models?: PhoneSeatModel[]) => ({ status: 'applied' as const, ...(models ? { models } : {}) });

describe('the seat model sheet', () => {
  it('shows the tool read-only, with the restart warning only when the seat is held', () => {
    opened('leader');
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('changer redémarre le siège')).toBeInTheDocument();
  });

  it('a free seat has no restart warning and says au prochain démarrage du siège', () => {
    opened('reviewer');
    expect(screen.queryByText('changer redémarre le siège')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent('au prochain démarrage du siège');
  });

  it('asks the models of the seat tool', () => {
    const t = opened('leader');
    expect(t.of('models.list')).toEqual([{ type: 'models.list', tool: 'claude' }]);
  });

  it('held and can switch, working: the note says it waits for the end of the turn', () => {
    opened('leader', { s1: { state: 'working' } });
    const d = screen.getByRole('dialog');
    expect(d).toHaveTextContent('Enregistré sur le siège pour ses prochains démarrages.');
    expect(d).toHaveTextContent('Appliqué aussi tout de suite à Otto, sur la même conversation : il travaille, ce sera à la fin de ce tour.');
    expect(d).toHaveTextContent('Votre passkey confirme le changement.');
    expect(d).toHaveTextContent('Otto redémarre sur la même conversation.');
  });

  it('held and can switch, idle: the note says it applies right away', () => {
    opened('leader', { s1: { state: 'waiting_input' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('Appliqué aussi tout de suite à Otto, sur la même conversation.');
  });

  it('Appliquer composes the team with the seat\'s new model and effort, other seats unchanged', async () => {
    const t = opened('leader');
    pickSonnet();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Moyen' }));
    await apply();
    expect(t.teamOp).toHaveBeenCalledTimes(1);
    expect(t.teamOp.mock.calls[0]![0]).toStrictEqual({
      type: 'team.compose', team: 'team-a1b2',
      seats: [{ role: 'leader', model: 'sonnet', effort: 'medium' }, { role: 'dev', model: 'sonnet', effort: 'low' }, { role: 'reviewer' }]
    });
  });

  it('applied outcome reads Enregistré ; appliqué à Otto', async () => {
    const t = opened('leader');
    t.teamOp.mockResolvedValueOnce(result([{ role: 'leader', session: 's1', status: 'applied' }]));
    pickSonnet(); await apply();
    expect(screen.getByText('Enregistré ; appliqué à Otto')).toBeInTheDocument();
  });

  it('scheduled reads … à la fin de son tour', async () => {
    const t = opened('leader');
    t.teamOp.mockResolvedValueOnce(result([{ role: 'leader', session: 's1', status: 'scheduled' }]));
    pickSonnet(); await apply();
    expect(screen.getByText('Enregistré ; appliqué à Otto à la fin de son tour')).toBeInTheDocument();
  });

  it('refused restart_failed reads Enregistré sur le siège ; pas appliqué à Otto : le redémarrage a échoué', async () => {
    const t = opened('leader');
    t.teamOp.mockResolvedValueOnce(result([{ role: 'leader', session: 's1', status: 'refused', reason: 'restart_failed' }]));
    pickSonnet(); await apply();
    expect(screen.getByText('Enregistré sur le siège ; pas appliqué à Otto : le redémarrage a échoué')).toBeInTheDocument();
  });

  it('refused not_launched reads Enregistré · au prochain démarrage du siège', async () => {
    const t = opened('leader');
    t.teamOp.mockResolvedValueOnce(result([{ role: 'leader', session: 's1', status: 'refused', reason: 'not_launched' }]));
    pickSonnet(); await apply();
    expect(screen.getByText('Enregistré · au prochain démarrage du siège')).toBeInTheDocument();
  });

  it('free seat says au prochain démarrage du siège once saved', async () => {
    opened('reviewer');
    pickSonnet(); await apply();
    expect(screen.getByText('Enregistré · au prochain démarrage du siège')).toBeInTheDocument();
  });

  it('a seat held by a session that cannot switch says au prochain démarrage du siège', async () => {
    opened('leader', { s1: { canSwitch: undefined } });
    pickSonnet(); await apply();
    expect(screen.getByText('Enregistré · au prochain démarrage du siège')).toBeInTheDocument();
  });

  it('a held seat that can switch and has no entry reads plain Enregistré', async () => {
    opened('leader');
    pickSonnet(); await apply();
    expect(screen.getByText('Enregistré')).toBeInTheDocument();
  });

  it('a cancelled passkey says so and keeps the sheet', async () => {
    const t = opened('leader');
    t.teamOp.mockResolvedValueOnce({ status: 'cancelled' });
    pickSonnet(); await apply();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.confirm.cancelled);
  });
});
