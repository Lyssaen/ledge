import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PhoneEscalation, PhoneRig } from '@ledge/protocol';
import { Inbox } from '../../src/screens/Inbox';
import { Agents } from '../../src/screens/Agents';
import { EscalationPage, LedgeThread, NewRig, RigPage, Rigs } from '../../src/screens/OpenRig';
import { setup } from './setup';
import { snapshot } from '../state/helpers';
const at = '2026-11-01T10:00:00.000Z';
const e: PhoneEscalation = { id: 'e1', source: 'rig', rigKey: 'abc', from: '@build', intent: 'decision', summary: 'Choisir', questions: [{ id: 'q1', question: 'Base ?', options: [{ id: 'x', label: 'SQLite' }, { id: 'y', label: 'Postgres' }] }, { id: 'q2', question: 'Cache ?', options: [{ id: 'a', label: 'Oui' }, { id: 'b', label: 'Non' }] }], createdAt: at, state: 'pending' };
function initial() { const m = snapshot([]); if (m.type !== 'snapshot') throw new Error(); return { ...m, daemon: { version: '1', name: 'PC', openrig: true as const }, rigs: [{ key: 'abc', name: 'factory', project: null, offProject: true, lifecycle: 'running' as const, kernel: false, seats: [] as PhoneRig['seats'], repos: 0 }], escalations: [e] }; }
describe('OpenRig screens', () => {
 it('shows and links a rig', () => { const t = setup(); t.deliver(initial()); render(<Rigs store={t.store} />); expect(screen.getByRole('link', { name: /factory/ })).toHaveAttribute('href', '#/rig/abc/seats'); });
 it('shows the pending escalation in À toi and filters it by source', () => { const t = setup(); t.deliver(initial()); render(<Inbox store={t.store} />); expect(screen.getByText(/1 décision\./)).toBeInTheDocument(); expect(screen.getByRole('link', { name: /Choisir/ })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Sessions' })); expect(screen.queryByRole('link', { name: /Choisir/ })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Via Ledge' })); expect(screen.getByRole('link', { name: /Choisir/ })).toBeInTheDocument(); });
 it('opens Le point and asks Ledge to summarize the day', () => { const t = setup(); t.deliver(initial()); render(<LedgeThread store={t.store} />); fireEvent.click(screen.getByRole('button', { name: 'Tranché 0' })); expect(screen.getByRole('dialog', { name: 'Le point' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Résumer la journée' })); expect(t.of('ledge.say')).toMatchObject([{ text: 'Résume ma journée.' }]); });
 it('lists a configured project with no active session', () => { const t = setup(); t.deliver({ ...initial(), projects: [{ id: 'website', name: 'Website', hasLocalRepo: true }] }); render(<Agents store={t.store} />); expect(screen.getByRole('region', { name: 'Website' })).toBeInTheDocument(); });
 it('offers a project even when it has no active rig', () => { const t = setup(); t.deliver({ ...initial(), projects: [{ id: 'website', name: 'Website', hasLocalRepo: true }] }); render(<NewRig store={t.store} />); expect(screen.getByRole('option', { name: 'Website' })).toHaveValue('website'); });
 it('sends a free-text ask and shows a recorded option label', () => {
   const t = setup(); const free = { ...e, questions: [], source: 'ask' as const }; t.deliver({ ...initial(), escalations: [free] });
   const view = render(<EscalationPage store={t.store} id="e1" />); fireEvent.change(screen.getByLabelText('Votre réponse'), { target: { value: 'Continuer' } }); fireEvent.click(screen.getByRole('button', { name: 'Envoyer la réponse' }));
   expect(t.of('escalation.answer')).toMatchObject([{ answers: { text: 'Continuer' } }]); view.unmount();
   const recorded: PhoneEscalation = { ...e, state: 'answered', answer: { by: 'user', answers: { q1: 'x' }, at } }; t.deliver({ type: 'escalation.updated', escalation: recorded });
   render(<EscalationPage store={t.store} id="e1" />); expect(screen.getByText(/SQLite/)).toBeInTheDocument();
 });
 it('shows seat states, requests exchanges and handles a removed rig', () => {
   const t = setup(); const snap = initial(); snap.rigs[0]!.seats = [{ ref: 's', address: '@build', name: 'build', runtime: 'codex', state: 'attention', contextPct: 74 }];
   t.deliver(snap); const view = render(<RigPage store={t.store} rigKey="abc" view="seats" />);
   expect(screen.getByText('attention')).toBeInTheDocument(); expect(screen.getByRole('progressbar')).toHaveValue(74); view.rerender(<RigPage store={t.store} rigKey="abc" view="exchanges" />);
   expect(t.of('rig.exchanges.request')).toMatchObject([{ key: 'abc' }]); act(() => t.deliver({ type: 'rig.removed', key: 'abc' })); expect(screen.getByText('Ce rig est arrêté')).toBeInTheDocument();
 });
 it('sends all answers together without a passkey', () => { const t = setup(); t.deliver(initial()); render(<EscalationPage store={t.store} id="e1" />); const send = screen.getByRole('button', { name: 'Envoyer la réponse' }); expect(send).toBeDisabled(); fireEvent.click(screen.getByLabelText('SQLite')); fireEvent.click(screen.getByLabelText('Oui')); fireEvent.click(send); expect(t.of('escalation.answer')).toMatchObject([{ id: 'e1', answers: { q1: 'x', q2: 'a' } }]); expect(t.of('confirm.prepare')).toEqual([]); });
});
