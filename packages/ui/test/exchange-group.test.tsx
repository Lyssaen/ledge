import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Exchange } from '@ledge/protocol';
import { ExchangeGroup } from '../src/chat/ledge/ExchangeGroup';
import { hhmm } from '../src/chat/ledge/threadModel';
import { Fr } from './ledge-thread-copy-fixture';

const local = (h: number, m: number) => new Date(2026, 9, 30, h, m).toISOString();
const xc = (id: string, at: string, from: string, to: string, kind: Exchange['kind'], text: string): Exchange =>
  ({ id, machine: 'local', rigId: 'factory', from, to, kind, text, at });
const three = [
  xc('x1', local(16, 36), 'orch-lead@factory', 'qa@factory', 'task', 'Vérifier la reprise après reboot sur deux rigs.'),
  xc('x2', local(16, 42), 'build@factory', 'review-a@factory', 'message', 'Candidat prêt sur feat/rigs.'),
  xc('x3', local(16, 42), 'review-a@factory', 'build@factory', 'handoff', 'Je relis, verdict dans 10 min.')
];

describe('ExchangeGroup', () => {
  it('folds and unfolds', () => {
    render(<Fr><ExchangeGroup rigName="factory" exchanges={three} missing={0} from={local(16, 36)} to={local(16, 42)} defaultOpen={false} /></Fr>);
    expect(screen.getByText('factory')).toBeVisible();
    expect(screen.getByText(/3 échanges entre agents/)).toBeVisible();
    expect(screen.getByText(/16:36 → 16:42/)).toBeVisible();
    expect(screen.queryByText('Candidat prêt sur feat/rigs.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voir' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Candidat prêt sur feat/rigs.')).toBeVisible();
    expect(screen.getByText(/· tâche · 16:36/)).toBeVisible();
    expect(screen.getByText(/· relève · 16:42/)).toBeVisible();
    expect(screen.getAllByText('orch-lead')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Replier' }));
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('opens by default and says what is no longer available', () => {
    render(<Fr><ExchangeGroup rigName="factory" exchanges={three.slice(0, 1)} missing={2} from={local(16, 36)} to={local(16, 42)} defaultOpen /></Fr>);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('2 échanges plus disponibles')).toBeVisible();
    expect(screen.getByText(/3 échanges entre agents/)).toBeVisible();
  });

  it('a group of one in one minute shows a single time', () => {
    render(<Fr><ExchangeGroup rigName="starter" exchanges={three.slice(0, 1)} missing={0} from={local(16, 31)} to={local(16, 31)} defaultOpen={false} /></Fr>);
    expect(screen.getByText(/1 échange · 16:31$/)).toBeVisible();
  });

  it('hhmm is the local hour and minute', () => {
    expect(hhmm(local(9, 5))).toBe('09:05');
  });
});
