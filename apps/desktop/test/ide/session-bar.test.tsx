import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, ServerMessage, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { SessionBar } from '../../src/session/SessionBar';
import type { ChangedFile } from '../../src/session/changedFiles';
import type { Link } from '../../src/workspace/model';

/** A client without the model switch: the bar names the model as text. */
function fakeClient() {
  const sent: ClientMessage[] = [];
  const fns = new Set<(m: ServerMessage) => void>();
  const machines = [{ id: 'local', daemon: { version: '1', install: 'npm', systemd: true } }];
  const client = {
    send: (m: ClientMessage) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; },
    fleet: { machines: () => machines, subscribe: () => () => {}, contextNear: () => 0.8 }
  } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => { fns.forEach(fn => fn(m)); }) };
}

const T = '2026-11-06T10:00:00.000Z';
const file = (path: string, plus: number, minus: number): ChangedFile => ({ path, shown: path, change: 'edit', plus, minus, cut: false, touches: [] });

function shown(extra: Partial<Session> = {}, files: readonly ChangedFile[] = [], besideLink: Link | null = null) {
  const env = fakeClient();
  const notify = vi.fn(); const onChanges = vi.fn();
  const session = fakeSession('otto', { name: 'Otto', model: 'claude-sonnet-5-5', context: { at: T, used: 84000, window: 200000 }, branch: 'feat/x', state: 'working', ...extra });
  render(<SessionBar client={env.client} session={session} project="ledge" files={files} besideLink={besideLink} notify={notify} onChanges={onChanges} />);
  return { ...env, notify, onChanges, user: userEvent.setup() };
}
const bar = () => document.querySelector<HTMLElement>('.ide-bar')!;

beforeEach(() => { localStorage.setItem('desktop.lang', 'fr'); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('the IDE session tab\'s bottom bar (lot 2, task 6)', () => {
  it('model, context, branch, project and « Interrompre », which sends session.interrupt for its id', async () => {
    const { sent, user } = shown();
    expect(bar()).toHaveTextContent('Sonnet 5.5');
    expect(screen.getByTitle('Changer de modèle')).toHaveTextContent('Sonnet 5.5');
    expect(screen.getByText('42 %')).toBeVisible();
    expect(screen.getByTitle('Contexte : 84k / 200k')).toBeInTheDocument();
    expect(screen.getByTitle('Branche feat/x')).toHaveTextContent('feat/x');
    expect(screen.getByText('ledge')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Interrompre' }));
    expect(sent).toContainEqual({ type: 'session.interrupt', id: 'otto' });
  });

  it('the context past the threshold is amber; unknown, it is not shown', () => {
    shown({ context: { at: T, used: 180000, window: 200000 } });
    expect(screen.getByText('90 %').closest('.ide-bar-ctx')).toHaveClass('amber');
    cleanup();
    shown({ context: undefined });
    expect(bar().querySelector('.ide-bar-ctx')).toBeNull();
  });

  it('no « Interrompre » when idle, archived, or read only (hook_only)', () => {
    shown({ state: 'idle' });
    expect(screen.queryByRole('button', { name: 'Interrompre' })).toBeNull();
    cleanup();
    shown({ archivedAt: new Date().toISOString() });
    expect(screen.queryByRole('button', { name: 'Interrompre' })).toBeNull();
    cleanup();
    shown({ source: 'hook_only' });
    expect(screen.queryByRole('button', { name: 'Interrompre' })).toBeNull();
    cleanup();
    shown({ offline: true });
    expect(screen.queryByRole('button', { name: 'Interrompre' })).toBeNull();
  });

  it('a refused interrupt is said in a toast', () => {
    const { emit, notify } = shown();
    emit({ type: 'error', message: 'pas de tmux', request: 'session.interrupt', id: 'other' } as ServerMessage);
    expect(notify).not.toHaveBeenCalled();
    emit({ type: 'error', message: 'pas de tmux', request: 'session.interrupt', id: 'otto' } as ServerMessage);
    expect(notify).toHaveBeenCalledWith('Interruption de Otto refusée : pas de tmux');
  });

  it('« +N −N »: the sums, the title, a click calls onChanges; `on` with its colour when the Changes are beside', async () => {
    const { onChanges, user } = shown({}, [file('a.ts', 3, 1), file('b.ts', 0, 4)]);
    const chip = screen.getByTitle('Modifications : 2 fichiers · à côté, dans un groupe lié');
    expect(chip).toHaveTextContent('+3−5');
    expect(chip).not.toHaveClass('on');
    await user.click(chip);
    expect(onChanges).toHaveBeenCalledTimes(1);
    cleanup();
    shown({}, [file('a.ts', 3, 1)], 'teal');
    expect(screen.getByTitle('Modifications : 1 fichier · à côté, dans un groupe lié')).toHaveClass('on');
    expect(bar().querySelector('.dchip .lk-teal')).not.toBeNull();
  });

  it('a nil term is not written; no files, no chip', () => {
    shown({}, [file('a.ts', 2, 0)]);
    expect(bar().querySelector('.dchip')).toHaveTextContent(/^\+2$/);
    cleanup();
    shown({}, []);
    expect(bar().querySelector('.dchip')).toBeNull();
  });

  it('never a usage limit', () => {
    shown();
    expect(bar().querySelector('.ufoot, .usage-footer, .workspace-footer')).toBeNull();
    expect(bar()).not.toHaveTextContent(/limite|usage/i);
  });
});
