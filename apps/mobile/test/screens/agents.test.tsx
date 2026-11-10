import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BROADCAST_SESSIONS_MAX } from '@ledge/protocol';
import { Agents } from '../../src/screens/Agents';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

describe('the agents', () => {
  it('groups the sessions by repository, each row opening its thread', () => {
    const t = setup();
    t.deliver(snapshot([
      session('a', { name: 'Kai', topic: 'Inbox', repo: 'ledge', branch: 'feat/x', state: 'working' }),
      session('b', { name: 'Ada', topic: 'Relais', repo: 'relay', unread: true }),
      session('c', { name: 'Zoé', topic: 'Tests', repo: 'ledge', state: 'waiting_permission', pending: pending({ key: 'kc', text: 'pnpm test' }) })
    ]));
    render(<Agents store={t.store} />);
    expect(screen.getByText('3 sessions · 2 projets sur ce PC')).toBeInTheDocument();
    const ledge = screen.getByRole('region', { name: 'ledge' });
    expect(within(ledge).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['#/thread/a', '#/thread/c']);
    expect(within(ledge).getByText('Au travail')).toBeInTheDocument();
    expect(within(ledge).getByText('Ton accord')).toBeInTheDocument();
    const relay = screen.getByRole('region', { name: 'relay' });
    expect(within(relay).getByText('● Non lu')).toBeInTheDocument();
    expect(within(relay).getByText('Disponible')).toBeInTheDocument();
  });

  it('two groups with the same name (a repository and a project both « ledge ») are both drawn, each with its own key', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = setup();
    t.deliver(snapshot([
      session('a', { name: 'Kai', repo: 'ledge' }),
      session('b', { name: 'Ada', project: 'ledge' })
    ]));
    render(<Agents store={t.store} />);
    expect(screen.getAllByRole('region', { name: 'ledge' })).toHaveLength(2);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    errors.mockRestore();
  });

  it('says when no session runs', () => {
    const t = setup();
    t.deliver(snapshot([]));
    render(<Agents store={t.store} />);
    expect(screen.getByText('Aucune session sur ce PC')).toBeInTheDocument();
  });

  it('says the list is the last known state once the link is lost', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    render(<Agents store={t.store} />);
    act(() => t.set('pc_offline'));
    // The banner is the shell's (shell/Shell.tsx, LinkStrip); the list says when its state was received.
    expect(screen.getByText(/^Dernier état connu · \d\d:\d\d$/)).toBeInTheDocument();
  });

  describe('the progress of a checklist', () => {
    const withPlan = () => snapshot([
      session('a', { name: 'Kai', topic: 'Inbox', checklist: { done: 3, total: 7, current: 'Ajout du test' } }),
      session('b', { name: 'Ada', topic: 'Relais', checklist: { done: 7, total: 7 } }),
      session('c', { name: 'Zoé', topic: 'Tests' })
    ]);
    const deliver = (flag: boolean) => {
      const t = setup();
      const m = withPlan();
      if (m.type === 'snapshot' && flag) m.daemon = { ...m.daemon, checklist: true };
      t.deliver(m);
      render(<Agents store={t.store} />);
    };

    it('shows done/total, its label and the current task when the PC sends checklists', () => {
      deliver(true);
      expect(screen.getByText('3/7')).toBeInTheDocument();
      expect(screen.getByLabelText('3 sur 7 tâches faites')).toBeInTheDocument();
      expect(screen.getByText('Ajout du test')).toBeInTheDocument();
    });

    it('all done: 7/7 and no current line; no checklist: nothing', () => {
      deliver(true);
      expect(screen.getByText('7/7')).toBeInTheDocument();
      expect(screen.getAllByLabelText(/tâches faites/)).toHaveLength(2);
      expect(screen.getAllByText(/\d\/\d/)).toHaveLength(2);
    });

    it('shows nothing from a PC without the flag', () => {
      deliver(false);
      expect(screen.queryByText('3/7')).toBeNull();
      expect(screen.queryByLabelText(/tâches faites/)).toBeNull();
      expect(screen.queryByText('Ajout du test')).toBeNull();
    });
  });

  describe('write to the group', () => {
    /** The PC's snapshot, from a daemon that takes a broadcast unless `flag` is false. */
    const deliver = (sessions: Parameters<typeof snapshot>[0], flag = true) => {
      const t = setup();
      const m = snapshot(sessions);
      if (m.type === 'snapshot' && flag) m.daemon = { ...m.daemon, broadcast: true };
      t.deliver(m);
      render(<Agents store={t.store} />);
      return t;
    };
    const two = () => deliver([session('a', { name: 'Kai', repo: 'ledge' }), session('c', { name: 'Zoé', repo: 'ledge' }), session('b', { name: 'Ada', repo: 'relay' })]);

    it('a PC that does not take a broadcast: no « Écrire au groupe »', () => {
      deliver([session('a', { name: 'Kai', repo: 'ledge' }), session('c', { name: 'Zoé', repo: 'ledge' })], false);
      expect(screen.queryByRole('button', { name: 'Écrire au groupe' })).toBeNull();
    });

    it('sends to the live sessions only; a group with none has no button', async () => {
      const t = deliver([session('a', { name: 'Kai', repo: 'ledge', state: 'exited' }), session('c', { name: 'Zoé', repo: 'ledge' }), session('b', { name: 'Ada', repo: 'relay', state: 'exited' })]);
      expect(within(screen.getByRole('region', { name: 'relay' })).queryByRole('button', { name: 'Écrire au groupe' })).toBeNull();
      const ledge = within(screen.getByRole('region', { name: 'ledge' }));
      fireEvent.click(ledge.getByRole('button', { name: 'Écrire au groupe' }));
      fireEvent.change(ledge.getByRole('textbox'), { target: { value: 'Salut' } });
      fireEvent.click(ledge.getByRole('button', { name: 'Envoyer' }));
      expect(t.of('session.broadcast')).toMatchObject([{ sessions: ['c'] }]);
    });

    it('more live sessions than one broadcast takes: refused in words, nothing sent, nothing cut', () => {
      const many = Array.from({ length: BROADCAST_SESSIONS_MAX + 1 }, (_, i) => session(`s${i}`, { name: `S${i}`, repo: 'ledge' }));
      const t = deliver(many);
      const ledge = within(screen.getByRole('region', { name: 'ledge' }));
      fireEvent.click(ledge.getByRole('button', { name: 'Écrire au groupe' }));
      fireEvent.change(ledge.getByRole('textbox'), { target: { value: 'Salut' } });
      fireEvent.click(ledge.getByRole('button', { name: 'Envoyer' }));
      expect(t.of('session.broadcast')).toEqual([]);
      expect(ledge.getByRole('status')).toHaveTextContent(`${BROADCAST_SESSIONS_MAX + 1} sessions dans ce groupe, ${BROADCAST_SESSIONS_MAX} au plus`);
    });

    it('the head of a group opens a field; sending sends the ids of the group and shows who got it and who did not', async () => {
      const t = two();
      const ledge = within(screen.getByRole('region', { name: 'ledge' }));
      fireEvent.click(ledge.getByRole('button', { name: 'Écrire au groupe' }));
      fireEvent.change(ledge.getByRole('textbox'), { target: { value: 'Pause café' } });
      fireEvent.click(ledge.getByRole('button', { name: 'Envoyer' }));
      const [m] = t.of('session.broadcast');
      expect(m).toMatchObject({ type: 'session.broadcast', sessions: ['a', 'c'], text: 'Pause café' });
      await act(async () => { t.deliver({ type: 'operation.result', op: m!.op, status: 'received' }); });
      await act(async () => { t.deliver({ type: 'operation.result', op: m!.op, status: 'applied', sent: ['Kai'], refused: [{ name: 'Zoé', reason: "Zoé s'est terminée" }] }); });
      expect(await screen.findByText(/Envoyé à Kai/)).toBeInTheDocument();
      expect(screen.getByText(/Zoé s'est terminée/)).toBeInTheDocument();
    });

    it('cancelling closes the field and sends nothing', () => {
      const t = two();
      const ledge = within(screen.getByRole('region', { name: 'ledge' }));
      fireEvent.click(ledge.getByRole('button', { name: 'Écrire au groupe' }));
      fireEvent.click(ledge.getByRole('button', { name: 'Annuler' }));
      expect(ledge.queryByRole('textbox')).toBeNull();
      expect(t.of('session.broadcast')).toEqual([]);
    });

    it('an empty text cannot be sent', () => {
      const t = two();
      const ledge = within(screen.getByRole('region', { name: 'ledge' }));
      fireEvent.click(ledge.getByRole('button', { name: 'Écrire au groupe' }));
      expect(ledge.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
      expect(t.of('session.broadcast')).toEqual([]);
    });
  });
});
