import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, ServerMessage, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { SessionModel } from '../src/session/SessionModel';
import { forgetModels } from '../src/launch/useModels';

const CODEX = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'Latest workhorse model for coding and everyday work.', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium', isDefault: true },
  { id: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium' }
];

function fakeClient(modelSwitch = true) {
  const sent: ClientMessage[] = [];
  const fns = new Set<(m: ServerMessage) => void>();
  const machines = [{ id: 'local', daemon: { version: '1', install: 'npm', systemd: true, models: true, ...(modelSwitch ? { modelSwitch: true } : {}) } }];
  const client = {
    send: (m: ClientMessage) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; },
    fleet: { machines: () => machines, subscribe: () => () => {} }
  } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => { fns.forEach(fn => fn(m)); }) };
}

async function shown(session: Session, modelSwitch = true) {
  const env = fakeClient(modelSwitch);
  const notify = vi.fn();
  const view = render(<SessionModel client={env.client} session={session} notify={notify} />);
  const ask = env.sent.find((m): m is Extract<ClientMessage, { type: 'models.list' }> => m.type === 'models.list');
  if (ask) await env.emit({ type: 'models.listing', requestId: ask.requestId, tool: ask.tool, models: CODEX });
  return { ...env, notify, view, user: userEvent.setup() };
}
const codex = (extra: Partial<Session> = {}) => fakeSession('cx', { name: 'Iris', tool: 'codex', state: 'idle', model: 'gpt-6.1-sol', effort: 'medium', ...extra });
const chip = () => screen.getByRole('button', { name: /^Model and effort : / });
const menu = () => within(screen.getByRole('dialog', { name: 'Model and effort' }));

beforeEach(() => forgetModels());
afterEach(() => cleanup());

describe('a live session\'s model (#58 lot 2)', () => {
  it('the chip names the model and effort the agent runs; Apply asks the daemon for the pick', async () => {
    const { user, sent } = await shown(codex());
    expect(chip()).toHaveAccessibleName('Model and effort : GPT-6.1-Sol · Medium');
    await user.click(chip());
    expect(menu().getByRole('option', { name: /GPT-6.1-Sol/ })).toHaveTextContent('current');
    expect(menu().getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(menu().getByText('Iris restarts on the same conversation and keeps its context.')).toBeVisible();
    await user.click(menu().getByRole('option', { name: /GPT-6-Astra/ }));
    expect(screen.getByRole('dialog')).toBeVisible(); // picking keeps the menu open for the effort
    await user.click(menu().getByRole('button', { name: 'More effort' }));
    expect(within(menu().getByRole('group', { name: 'Effort' })).getByRole('status')).toHaveTextContent('High');
    await user.click(menu().getByRole('button', { name: 'Apply' }));
    expect(sent.filter(m => m.type === 'session.model')).toEqual([{ type: 'session.model', id: 'cx', model: 'gpt-6-astra', effort: 'high' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('while the agent works the change is scheduled, and the chip shows it for the next turn', async () => {
    const { user, sent, view, client, notify } = await shown(codex({ state: 'working' }));
    await user.click(chip());
    expect(menu().getByText('Iris is working: the change applies at the end of this turn.')).toBeVisible();
    await user.click(menu().getByRole('option', { name: /GPT-6-Astra/ }));
    await user.click(menu().getByRole('button', { name: 'Schedule' }));
    expect(sent.at(-1)).toEqual({ type: 'session.model', id: 'cx', model: 'gpt-6-astra', effort: 'medium' });
    view.rerender(<SessionModel client={client} session={codex({ state: 'working', modelNext: { model: 'gpt-6-astra', effort: 'medium' } })} notify={notify} />);
    expect(chip()).toHaveAccessibleName('Model and effort : GPT-6-Astra · Medium (next turn)');
    expect(screen.getByText('next turn')).toBeVisible();
  });

  it('the agent\'s default passes null; a refusal is told', async () => {
    const { user, sent, emit, notify } = await shown(codex({ model: 'gpt-6-astra', effort: 'high' }));
    await user.click(chip());
    await user.click(menu().getByRole('option', { name: /GPT-6.1-Sol/ }));
    await user.click(menu().getByRole('button', { name: 'Less effort' }));
    await user.click(menu().getByRole('button', { name: 'Apply' }));
    expect(sent.at(-1)).toEqual({ type: 'session.model', id: 'cx', model: null, effort: null });
    await emit({ type: 'error', id: 'cx', message: 'no conversation to resume', request: 'session.model' });
    expect(notify).toHaveBeenCalledWith('Model change refused: no conversation to resume');
  });

  it('no chip for an older daemon, a session started without Ledge or one that ended', async () => {
    await shown(codex(), false);
    expect(screen.queryByRole('button', { name: /Model and effort/ })).toBeNull();
    cleanup();
    await shown(codex({ source: 'hook_only' }));
    expect(screen.queryByRole('button', { name: /Model and effort/ })).toBeNull();
    cleanup();
    await shown(codex({ state: 'exited' }));
    expect(screen.queryByRole('button', { name: /Model and effort/ })).toBeNull();
  });
});
