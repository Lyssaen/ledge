import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, ModelChoice, ServerMessage } from '@ledge/protocol';
import { CardModelPick } from '../src/chat/CardModelPick';
import { NO_PICK, type ModelPick } from '../src/launch/model';
import { forgetModels } from '../src/launch/useModels';

const CODEX: ModelChoice[] = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'Latest workhorse model.', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
  { id: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Frontier intelligence.', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }
];
const CURSOR: ModelChoice[] = [
  { id: 'auto', label: 'Auto', isDefault: true },
  ...Array.from({ length: 24 }, (_, i) => ({ id: `opus-${i}`, label: `Opus ${i}`, description: i === 3 ? 'Careful, slow' : 'Fast' }))
];

function fakeClient() {
  const sent: ClientMessage[] = [];
  const fns = new Set<(m: ServerMessage) => void>();
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => { fns.forEach(fn => fn(m)); }) };
}

async function shown(tool: 'codex' | 'cursor', models: ModelChoice[], error?: string) {
  const env = fakeClient();
  const picks: ModelPick[] = [];
  function Host() {
    const [pick, setPick] = useState<ModelPick>(NO_PICK);
    return <CardModelPick client={env.client} machine="local" tool={tool} pick={pick} disabled={false} onPick={p => { picks.push(p); setPick(p); }} />;
  }
  render(<Host />);
  const ask = env.sent.find((m): m is Extract<ClientMessage, { type: 'models.list' }> => m.type === 'models.list')!;
  await env.emit({ type: 'models.listing', requestId: ask.requestId, tool: ask.tool, models, ...(error ? { error } : {}) });
  return { ...env, picks, user: userEvent.setup() };
}
const chip = () => screen.getByRole('button', { name: /^(Codex|Cursor Agent) model : / });
const menu = () => within(screen.getByRole('dialog'));

beforeEach(() => forgetModels());
afterEach(() => cleanup());

describe('the chat card\'s model chip (#62)', () => {
  it('is one chip, no native list; it names the default model and effort', async () => {
    await shown('codex', CODEX);
    expect(document.querySelector('select')).toBeNull();
    expect(chip()).toHaveAccessibleName('Codex model : GPT-6.1-Sol · Medium');
  });

  it('opens a searchable list; picking keeps it open, and the effort stepper sets the effort', async () => {
    const { user, picks } = await shown('codex', CODEX);
    await user.click(chip());
    expect(menu().getByRole('combobox')).toHaveFocus();
    await user.click(menu().getByRole('option', { name: /GPT-6-Astra/ }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(picks.at(-1)).toEqual({ model: 'gpt-6-astra', effort: null });
    await user.click(menu().getByRole('button', { name: 'More effort' }));
    expect(picks.at(-1)).toEqual({ model: 'gpt-6-astra', effort: 'high' });
    expect(chip()).toHaveAccessibleName('Codex model : GPT-6-Astra · High');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('searches the name, id and description; counts the results; takes an exact id as is, never an option', async () => {
    const { user, picks } = await shown('cursor', CURSOR);
    await user.click(chip());
    await user.type(menu().getByRole('combobox'), 'careful');
    expect(menu().getByRole('option', { name: /Opus 3/ })).toBeVisible();
    expect(menu().queryByRole('option', { name: /Opus 4/ })).toBeNull();
    expect(menu().getByText('1 of 25')).toBeVisible();
    await user.clear(menu().getByRole('combobox'));
    await user.type(menu().getByRole('combobox'), '-p');
    expect(menu().queryByText('Use as is')).toBeNull();
    await user.clear(menu().getByRole('combobox'));
    await user.type(menu().getByRole('combobox'), 'my-model{Enter}');
    expect(picks.at(-1)).toEqual({ model: 'my-model', effort: null });
    expect(chip()).toHaveAccessibleName('Cursor Agent model : my-model');
  });

  it('Cursor has no stepper: its effort is in the model name', async () => {
    const { user } = await shown('cursor', CURSOR);
    await user.click(chip());
    expect(menu().queryByRole('group', { name: 'Effort' })).toBeNull();
    expect(menu().getByText('Effort is in the model name')).toBeVisible();
  });

  it('is absent for a daemon too old to list models', async () => {
    await shown('codex', [], 'outdated');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
