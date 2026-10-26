import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ChatAction, ClientMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

const bridge = vi.hoisted(() => ({ focusOverlay: vi.fn(async () => {}), releaseFocus: vi.fn(async () => {}), focusTerminal: vi.fn(async (_t: string) => true) }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), ...bridge }));

let sent: ClientMessage[] = [];
const client = (): DaemonClient => ({ connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} });
const apply = (m: Parameters<typeof daemonStore.apply>[0]) => act(() => { daemonStore.apply(m); });
const actions: ChatAction[] = [
  { action: 'session.archive', args: { session: 'a' }, summary: 'Archiver **Otto**', vars: { session: 'Otto' }, risk: 'reversible', session: 'a' },
  { action: 'team.dissolve', args: { team: 't1' }, summary: 'Dissoudre l’équipe **qa**', vars: { team: 'qa' }, risk: 'destructive', team: 't1' }
];

function askAndAct(): string {
  render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a', { name: 'Otto', state: 'exited' })] }); });
  act(() => { fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); });
  const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
  fireEvent.change(input, { target: { value: 'range' } }); fireEvent.keyDown(input, { key: 'Enter' });
  const ask = sent.find(m => m.type === 'chat.ask') as Extract<ClientMessage, { type: 'chat.ask' }>;
  apply({ type: 'chat.done', qid: ask.qid, text: 'Voici.', at: new Date().toISOString(), actions });
  return ask.qid;
}
const card = () => screen.getByRole('region', { name: 'Plan of 2 actions' });

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent = []; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('the island\'s generic card (#94)', () => {
  it('its rows in the island\'s words, narrow; Apply all, confirmed, sends chat.act', () => {
    const qid = askAndAct();
    expect(card()).toHaveTextContent('Archive Otto');
    expect(card().querySelector('[data-action-side]')!.getAttribute('data-under')).toBe('true');
    fireEvent.click(within(card()).getByRole('button', { name: 'Apply all (2)…' }));
    fireEvent.click(within(card()).getByRole('button', { name: 'Apply the 2' }));
    expect(sent.filter(m => m.type === 'chat.act')).toEqual([{ type: 'chat.act', rid: expect.any(String), qid, rows: [0, 1], confirmed: true }]);
  });

  it('Ignore sends chat.ignore', () => {
    const qid = askAndAct();
    fireEvent.click(within(card()).getByRole('button', { name: 'Ignore' }));
    expect(sent.filter(m => m.type === 'chat.ignore')).toEqual([{ type: 'chat.ignore', qid }]);
  });

  it('Deny sends chat.act with deny for its row', () => {
    render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
    act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a', { name: 'Otto', state: 'idle' })] }); });
    act(() => { fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); });
    const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
    fireEvent.change(input, { target: { value: 'otto ?' } }); fireEvent.keyDown(input, { key: 'Enter' });
    const ask = sent.find(m => m.type === 'chat.ask') as Extract<ClientMessage, { type: 'chat.ask' }>;
    const decide: ChatAction = { action: 'session.decide', args: { session: 'a', decision: 'accept' }, summary: 'Accepter', vars: { session: 'Otto', decision: 'accept', kind: 'permission' }, risk: 'destructive', session: 'a', detail: 'npm test' };
    apply({ type: 'chat.done', qid: ask.qid, text: 'Voici.', at: new Date().toISOString(), actions: [decide] });
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposed action' })).getByRole('button', { name: 'Deny' }));
    expect(sent.filter(m => m.type === 'chat.act')).toEqual([{ type: 'chat.act', rid: expect.any(String), qid: ask.qid, rows: [0], deny: true }]);
  });
});
