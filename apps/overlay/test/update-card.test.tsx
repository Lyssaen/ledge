import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LangProvider } from '../src/i18n/lang';
import { UpdateCard } from '../src/update/UpdateCard';

const r = (ui: React.ReactElement) => render(<LangProvider lang="fr">{ui}</LangProvider>);
const noop = () => {};

describe('UpdateCard', () => {
  it('offers the update with the notes and says sessions keep running', () => {
    const onUpdate = vi.fn();
    r(<UpdateCard view={{ kind: 'available', version: '0.3.0', current: '0.2.2', notes: ['Une', 'Deux'] }} sessions={4} onUpdate={onUpdate} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect(screen.getByText('Ledge 0.3.0 est disponible')).toBeTruthy();
    expect(screen.getByText(/Vos 4 sessions continuent/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });
  it('shows the failure, the exact command and retry', () => {
    r(<UpdateCard view={{ kind: 'failed', reason: 'npm-failed', detail: 'npm ERR! code EACCES', command: 'npm i -g @paradow/ledge@0.3.0' }} sessions={0} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect(screen.getByText(/n’a pas pu se mettre à jour/)).toBeTruthy();
    expect(screen.getByText('npm i -g @paradow/ledge@0.3.0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });
  it('names the sessions that did not come back', () => {
    r(<UpdateCard view={{ kind: 'failed', reason: 'sessions-lost', missing: ['Nova'] }} sessions={0} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect(screen.getByText('Manquantes : Nova')).toBeTruthy();
  });
  it('a clone gets the manual command and a disabled app button until the daemon catches up', () => {
    r(<UpdateCard view={{ kind: 'manual', version: '0.3.0', command: 'cd /c && git pull', canInstallApp: false }} sessions={0} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect((screen.getByRole('button', { name: 'Mettre à jour l’application' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('cd /c && git pull')).toBeTruthy();
  });
  it('renders the running steps as a list with progress', () => {
    r(<UpdateCard view={{ kind: 'running', steps: [{ key: 'daemon', status: 'done', meta: '0.3.0' }, { key: 'restart', status: 'done', meta: '4/4' }, { key: 'download', status: 'run', progress: 0.62 }, { key: 'install', status: 'todo' }] }} sessions={4} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62');
  });
  it('acknowledges the installed card and opens the notes', () => {
    const onAck = vi.fn(), onNotes = vi.fn();
    const { rerender } = r(<UpdateCard view={{ kind: 'updated', version: '0.3.0' }} sessions={0} onUpdate={noop} onLater={noop} onRetry={noop} onAck={onAck} onNotes={onNotes} />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onAck).toHaveBeenCalledOnce();
    rerender(<LangProvider lang="fr"><UpdateCard view={{ kind: 'available', version: '0.3.0', current: '0.2.2', notes: [] }} sessions={0} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={onNotes} /></LangProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Notes complètes' }));
    expect(onNotes).toHaveBeenCalledOnce();
  });
});
