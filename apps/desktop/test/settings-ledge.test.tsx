import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { BrainStatus, ClientMessage } from '@ledge/protocol';
import { boot, closeDaemons, recordToasts, TWO_PROJECTS, type MockDaemon } from './helpers';

let log: string[] = [];
beforeEach(() => { log = recordToasts(); localStorage.clear(); });
afterEach(async () => { vi.useRealTimers(); cleanup(); await closeDaemons(); });

type BrainSet = Extract<ClientMessage, { type: 'brain.set' }>;
const setsOf = (d: MockDaemon) => d.received.filter((m): m is BrainSet => m.type === 'brain.set');
const nav = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));

async function open(status?: BrainStatus) {
  const env = await boot({ projects: TWO_PROJECTS });
  if (status) env.d.push({ type: 'brain.status', status });
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(nav().getByRole('button', { name: /^Ledge/ }));
  await screen.findByRole('heading', { level: 1, name: 'Ledge' });
  return env;
}

describe('Settings › Ledge', () => {
  it('sits right after General', async () => {
    await open();
    expect(nav().getAllByRole('button').map(b => b.textContent).slice(1, 4)).toEqual(['General', 'Ledge', 'Appearance']);
  });

  it('toggles the brain and picks the tool (Claude Code, Codex, Cursor Agent only)', async () => {
    const { d, user } = await open({ state: 'off', tool: 'claude', enabled: false });
    const tools = within(screen.getByRole('radiogroup', { name: 'Tool' }));
    expect(tools.getAllByRole('radio').map(r => r.parentElement!.textContent)).toEqual(['Claude Code', 'Codex', 'Cursor Agent']);
    expect(screen.getByText(/at the next relief or start/)).toBeVisible();
    const sw = screen.getByRole('switch', { name: 'Ledge thinks continuously' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    await waitFor(() => expect(setsOf(d)).toEqual([{ type: 'brain.set', rid: expect.any(String), enabled: true }]));
    d.push({ type: 'brain.status', status: { state: 'starting', tool: 'claude', enabled: true } });
    await user.click(tools.getByRole('radio', { name: 'Codex' }));
    await waitFor(() => expect(setsOf(d)[1]).toEqual({ type: 'brain.set', rid: expect.any(String), enabled: true, tool: 'codex' }));
  });

  it('the tool change keeps the brain off when it is off', async () => {
    const { d, user } = await open({ state: 'off', tool: 'claude', enabled: false });
    await user.click(within(screen.getByRole('radiogroup', { name: 'Tool' })).getByRole('radio', { name: 'Cursor Agent' }));
    await waitFor(() => expect(setsOf(d)).toEqual([{ type: 'brain.set', rid: expect.any(String), enabled: false, tool: 'cursor' }]));
  });

  it('the status line follows brain.status', async () => {
    const { d } = await open({ state: 'on', tool: 'claude', enabled: true, contextPct: 34 });
    const line = () => document.querySelector('[data-brain-status]')!;
    expect(line()).toHaveTextContent('Running · 34 % of context');
    d.push({ type: 'brain.status', status: { state: 'on', tool: 'claude', enabled: true } });
    await waitFor(() => expect(line()).toHaveTextContent(/^Running$/));
    d.push({ type: 'brain.status', status: { state: 'starting', tool: 'claude', enabled: true } });
    await waitFor(() => expect(line()).toHaveTextContent('Starting…'));
    d.push({ type: 'brain.status', status: { state: 'off', tool: 'claude', enabled: false } });
    await waitFor(() => expect(line()).toHaveTextContent('Stopped'));
  });

  it('a down brain shows its reason and « Restart » sends enabled true', async () => {
    const { d, user } = await open({ state: 'down', tool: 'claude', enabled: true, reason: 'binaire absent' });
    expect(document.querySelector('[data-brain-status]')).toHaveTextContent('Down: binaire absent');
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(setsOf(d)).toEqual([{ type: 'brain.set', rid: expect.any(String), enabled: true }]));
  });

  it('a refused brain.set is said in a notice', async () => {
    const { d, user } = await open({ state: 'off', tool: 'claude', enabled: false });
    await user.click(screen.getByRole('switch', { name: 'Ledge thinks continuously' }));
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    d.push({ type: 'rig.result', rid: setsOf(d)[0]!.rid, ok: false, code: 'failed', reason: 'le binaire manque' });
    await waitFor(() => expect(log.some(x => x.includes('le binaire manque'))).toBe(true));
  });
});
