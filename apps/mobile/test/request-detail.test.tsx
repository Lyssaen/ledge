import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Session } from '@ledge/protocol';
import { RequestDetail } from '../src/screens/RequestDetail';
import { QuestionForm } from '../src/screens/QuestionForm';
import { mobileStore } from '../src/state/store';

beforeEach(() => { localStorage.clear(); mobileStore.reset(); mobileStore.setLink('connecting'); });
const show = () => render(<RequestDetail sessionId="s" pendingId="p" onReconnect={() => {}} />);

describe('RequestDetail with no matching request', () => {
  it('shows a neutral loading state while the first snapshot is awaited', () => {
    show();
    expect(screen.getByText('Chargement de la demande…')).toBeInTheDocument();
    expect(screen.queryByText(/n’attend plus/)).toBeNull();
  });
  it('says the request is gone once a snapshot without it has arrived', () => {
    show();
    act(() => { mobileStore.apply({ type: 'snapshot', sessions: [] }); mobileStore.setLink('online'); });
    expect(screen.getByRole('heading', { name: 'Déjà traitée sur le PC' })).toBeInTheDocument();
    expect(screen.getByText('Cette demande a été résolue ailleurs. Aucune nouvelle décision n’a été envoyée.')).toBeInTheDocument();
  });
  it('stays neutral while connecting, whatever the cache says', () => {
    show();
    act(() => mobileStore.apply({ type: 'snapshot', sessions: [] }));
    expect(screen.getByText('Chargement de la demande…')).toBeInTheDocument();
    expect(screen.queryByText('Déjà traitée sur le PC')).toBeNull();
  });
  it('does not assert it was handled when offline on a stale cache', () => {
    show();
    act(() => { mobileStore.apply({ type: 'snapshot', sessions: [] }); mobileStore.setLink('offline'); });
    expect(screen.queryByText('Déjà traitée sur le PC')).toBeNull();
    expect(screen.getByText(/dernier état connu/)).toBeInTheDocument();
  });
});

describe('RequestDetail of a low-risk permission', () => {
  const waiting = (text: string, riskReason: 'read_only_command' | 'edit_inside_folder', tool = 'Bash'): Session => ({
    id: 's', name: 'Kai', tool: 'claude', cwd: '/w/site', project: 'site', title: 'Kai', tmuxSession: 'ledge-s', state: 'waiting_permission', helpers: [],
    startedAt: '2026-10-14T10:00:00Z', lastActivityAt: '2026-10-14T10:00:00Z', source: 'launcher',
    pending: { id: 'p', version: 1, since: '2026-10-14T10:00:00Z', kind: 'permission', text, tool, source: 'hook', risk: 'low', riskReason }
  } as Session);
  it('a read-only command shows no consequence at all', () => {
    show();
    act(() => { mobileStore.apply({ type: 'snapshot', sessions: [waiting('ls', 'read_only_command')] }); mobileStore.setLink('online'); });
    expect(screen.getByText('ls')).toBeInTheDocument();
    expect(screen.queryByText(/script de test/)).toBeNull();
    expect(screen.queryByText(/accéder au réseau/)).toBeNull();
  });
  it('an edit inside the folder says the file there will change, nothing about tests or the network', () => {
    show();
    act(() => { mobileStore.apply({ type: 'snapshot', sessions: [waiting('/w/site/a.ts', 'edit_inside_folder', 'Edit')] }); mobileStore.setLink('online'); });
    expect(screen.getByText('Modification dans le projet')).toBeInTheDocument();
    expect(screen.queryByText(/script de test/)).toBeNull();
  });
});

describe('QuestionForm free answer field', () => {
  it('has no "send" Return key: Return inserts a newline on iOS, it must not look like it sends', () => {
    render(<QuestionForm options={['A', 'B']} value={2} onChange={() => {}} botName="Kai" other={{ text: '', onText: () => {}, problem: 'empty' }} />);
    expect(screen.getByRole('textbox').getAttribute('enterkeyhint')).toBeNull();
  });
});
