import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { LaunchCard } from '../src/chat/LaunchCard';
import { RelayCard, relayPill } from '../src/chat/RelayCard';

const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the build' };
const relay = { id: 'local:otto', name: 'Otto', tool: 'claude' as const, text: 'Run the tests' };
const otto = fakeSession('local:otto', { name: 'Otto', state: 'idle', project: 'ledge', branch: 'fix/build', machineId: 'local' });
const card = () => document.querySelector('section.ledge-card')!;

describe('LaunchCard', () => {
  it('a proposal shows the folder, the harness and the instruction, and starts on click', () => {
    const onLaunch = vi.fn();
    render(<LaunchCard proposal={proposal} busy={false} disabled={false} onLaunch={onLaunch} />);
    expect(screen.getByRole('region', { name: 'Proposed session' })).toHaveAttribute('data-launch-card', 'proposed');
    expect(card()).toHaveTextContent('ledge');
    expect(card()).toHaveTextContent('/w/ledge');
    expect(card()).toHaveTextContent('Claude Code · default');
    expect(card()).toHaveTextContent('Fix the build');
    expect(card()).toHaveTextContent('or rephrase your request');
    fireEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(onLaunch).toHaveBeenCalledOnce();
  });
  it('no instruction says so; busy and disabled block the button', () => {
    const { rerender } = render(<LaunchCard proposal={{ ...proposal, prompt: undefined }} busy disabled={false} onLaunch={vi.fn()} />);
    expect(card()).toHaveTextContent('None, empty session');
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    rerender(<LaunchCard proposal={proposal} busy={false} disabled onLaunch={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeDisabled();
  });
  it('a failure is a status, never an alert, with a retry', () => {
    render(<LaunchCard proposal={{ ...proposal, error: 'no such folder' }} busy={false} disabled={false} onLaunch={vi.fn()} />);
    expect(card()).toHaveAttribute('data-launch-card', 'failed');
    expect(screen.getByRole('status')).toHaveTextContent('Could not start: no such folder');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(card()).toHaveTextContent('or give me another folder');
  });
  it('launched: names the session when listed, no button', () => {
    const ari = fakeSession('local:ari', { name: 'Ari' });
    const { rerender } = render(<LaunchCard proposal={{ ...proposal, launchedId: 'local:ari' }} session={ari} busy={false} disabled={false} onLaunch={vi.fn()} />);
    expect(card()).toHaveAttribute('data-launch-card', 'launched');
    expect(card()).toHaveTextContent('Ari has started');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<LaunchCard proposal={{ ...proposal, launchedId: 'local:ari' }} busy={false} disabled={false} onLaunch={vi.fn()} />);
    expect(card()).toHaveTextContent('Session started');
  });
  it('speaks French with vouvoiement', () => {
    render(<LangProvider lang="fr"><LaunchCard proposal={proposal} busy={false} disabled={false} onLaunch={vi.fn()} /></LangProvider>);
    expect(screen.getByRole('button', { name: 'Lancer la session' })).toBeEnabled();
    expect(card()).toHaveTextContent('ou reformulez votre demande');
    expect(card()).toHaveTextContent('Claude Code · par défaut');
  });
});

describe('relayPill', () => {
  it('your turn, working, waiting for you, stopped', () => {
    expect(relayPill(otto)).toBe('yours');
    expect(relayPill({ ...otto, state: 'working' })).toBe('working');
    expect(relayPill({ ...otto, state: 'waiting_input' })).toBe('waiting');
    expect(relayPill({ ...otto, state: 'waiting_permission' })).toBe('waiting');
    expect(relayPill({ ...otto, state: 'exited' })).toBe('stopped');
    expect(relayPill(undefined)).toBe('stopped');
  });
});

describe('RelayCard', () => {
  it('proposed: the session, its state, the instruction, and Send', () => {
    const onSend = vi.fn();
    render(<RelayCard relay={relay} session={otto} busy={false} disabled={false} onSend={onSend} onCancel={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Instruction to send' })).toHaveAttribute('data-relay-card', 'proposed');
    expect(card()).toHaveTextContent('Claude Code · ledge fix/build');
    expect(card().querySelector('[data-pill]')).toHaveAttribute('data-pill', 'yours');
    expect(card().querySelector('[data-pill]')).toHaveTextContent('your turn');
    expect(card().querySelector('blockquote')).toHaveTextContent('Run the tests');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledOnce();
  });
  it('queued: says it will go when the session is done, and can be cancelled', () => {
    const onCancel = vi.fn();
    render(<RelayCard relay={{ ...relay, status: 'queued' }} session={{ ...otto, state: 'working' }} busy={false} disabled={false} onSend={vi.fn()} onCancel={onCancel} />);
    expect(card()).toHaveAttribute('data-relay-card', 'queued');
    expect(card()).toHaveTextContent("Otto is working; I'll send it as soon as it's done");
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it('sent: to whom and when', () => {
    const sentAt = '2026-10-15T09:41:00.000Z';
    render(<RelayCard relay={{ ...relay, status: 'sent', sentAt }} session={otto} busy={false} disabled={false} onSend={vi.fn()} onCancel={vi.fn()} />);
    const time = new Date(sentAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    expect(card()).toHaveTextContent(`Sent to Otto · ${time}`);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('failed: a status with a retry; a session that left the list is stopped', () => {
    render(<RelayCard relay={{ ...relay, error: 'pane gone' }} busy={false} disabled={false} onSend={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Could not send: pane gone');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(card().querySelector('[data-pill]')).toHaveTextContent('stopped');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
  it('speaks French with vouvoiement', () => {
    render(<LangProvider lang="fr"><RelayCard relay={relay} session={{ ...otto, state: 'waiting_input' }} busy={false} disabled={false} onSend={vi.fn()} onCancel={vi.fn()} /></LangProvider>);
    expect(card().querySelector('[data-pill]')).toHaveTextContent('attend votre réponse');
    expect(card()).toHaveTextContent('ou reformulez votre demande');
  });
});
