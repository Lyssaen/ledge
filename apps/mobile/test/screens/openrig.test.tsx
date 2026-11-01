import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PhoneEscalation } from '@ledge/protocol';
import { Inbox } from '../../src/screens/Inbox';
import { EscalationPage, Rigs } from '../../src/screens/OpenRig';
import { setup } from './setup';
import { snapshot } from '../state/helpers';
const at = '2026-11-01T10:00:00.000Z';
const e: PhoneEscalation = { id: 'e1', source: 'rig', rigKey: 'abc', from: '@build', intent: 'decision', summary: 'Choisir', questions: [{ id: 'q1', question: 'Base ?', options: [{ id: 'x', label: 'SQLite' }, { id: 'y', label: 'Postgres' }] }, { id: 'q2', question: 'Cache ?', options: [{ id: 'a', label: 'Oui' }, { id: 'b', label: 'Non' }] }], createdAt: at, state: 'pending' };
function initial() { const m = snapshot([]); if (m.type !== 'snapshot') throw new Error(); return { ...m, daemon: { version: '1', name: 'PC', openrig: true as const }, rigs: [{ key: 'abc', name: 'factory', project: null, offProject: true, lifecycle: 'running' as const, kernel: false, seats: [], repos: 0 }], escalations: [e] }; }
describe('OpenRig screens', () => {
 it('shows and links a rig', () => { const t = setup(); t.deliver(initial()); render(<Rigs store={t.store} />); expect(screen.getByRole('link', { name: /factory/ })).toHaveAttribute('href', '#/rig/abc/seats'); });
 it('shows the pending escalation in À toi and filters it by source', () => { const t = setup(); t.deliver(initial()); render(<Inbox store={t.store} />); expect(screen.getByText(/1 décision\./)).toBeInTheDocument(); expect(screen.getByRole('link', { name: /Choisir/ })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Sessions' })); expect(screen.queryByRole('link', { name: /Choisir/ })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Via Ledge' })); expect(screen.getByRole('link', { name: /Choisir/ })).toBeInTheDocument(); });
 it('sends all answers together without a passkey', () => { const t = setup(); t.deliver(initial()); render(<EscalationPage store={t.store} id="e1" />); const send = screen.getByRole('button', { name: 'Envoyer la réponse' }); expect(send).toBeDisabled(); fireEvent.click(screen.getByLabelText('SQLite')); fireEvent.click(screen.getByLabelText('Oui')); fireEvent.click(send); expect(t.of('escalation.answer')).toMatchObject([{ id: 'e1', answers: { q1: 'x', q2: 'a' } }]); expect(t.of('confirm.prepare')).toEqual([]); });
});
