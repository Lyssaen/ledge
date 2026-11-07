import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, ServerMessage, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { SessionBar, type SessionBarProps } from '../../src/session/SessionBar';
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

function shown(extra: Partial<Session> = {}, files: readonly ChangedFile[] = [], besideLink: Link | null = null, more: Partial<SessionBarProps> = {}) {
  const env = fakeClient();
  const notify = vi.fn(); const onChanges = vi.fn();
  const session = fakeSession('otto', { name: 'Otto', model: 'claude-sonnet-5-5', context: { at: T, used: 84000, window: 200000 }, branch: 'feat/x', state: 'working', ...extra });
  render(<SessionBar client={env.client} session={session} project="ledge" files={files} besideLink={besideLink} notify={notify} onChanges={onChanges} {...more} />);
  return { ...env, notify, onChanges, user: userEvent.setup() };
}
const bar = () => document.querySelector<HTMLElement>('.ide-bar')!;

beforeEach(() => { localStorage.setItem('desktop.lang', 'fr'); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('the IDE session tab\'s bottom bar (lot 2, task 6)', () => {
  it('model, context, branch, project and « Interrompre », which sends session.interrupt for its id', async () => {
    const { sent, user } = shown();
    expect(bar()).toHaveTextContent('Sonnet 5.5');
    // The machine cannot switch it: the name alone, no caret, no « Changer de modèle ».
    expect(screen.queryByTitle('Changer de modèle')).toBeNull();
    expect(bar().querySelector('.model-chip')).toBeNull();
    // The provider's logo before the name, as in the chip.
    expect(bar().querySelector('.ide-bar-mdl .logo')).toHaveAttribute('title', 'Anthropic');
    expect(bar().querySelector('.ide-bar-mdl .car')).toBeNull();
    expect(screen.getByText('42 %')).toBeVisible();
    expect(screen.getByTitle('Contexte : 84k / 200k')).toBeInTheDocument();
    expect(screen.getByTitle('Branche feat/x')).toHaveTextContent('feat/x');
    expect(screen.getByText('ledge')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Interrompre' }));
    expect(sent).toContainEqual({ type: 'session.interrupt', id: 'otto' });
  });

  it('the logo before the model is the model\'s provider, not the harness\'s; unknown to our set, the harness\'s', () => {
    const logo = () => bar().querySelector('.ide-bar-mdl .logo')!.getAttribute('title');
    shown({ tool: 'cursor', model: 'claude-opus-5-5' });
    expect(logo()).toBe('Anthropic');
    cleanup();
    shown({ tool: 'omp', model: 'gpt-6.1-sol' });
    expect(logo()).toBe('OpenAI');
    cleanup();
    shown({ tool: 'cursor', model: 'composer-1' });
    expect(logo()).toBe('Cursor');
    cleanup();
    shown({ tool: 'omp', model: 'gemini-3-pro' });
    expect(logo()).toBe('omp');
  });

  it('the context past the threshold is amber; unknown, it is not shown', () => {
    shown({ context: { at: T, used: 180000, window: 200000 } });
    expect(screen.getByText('90 %').closest('.ide-bar-ctx')).toHaveClass('amber');
    cleanup();
    shown({ context: undefined });
    expect(bar().querySelector('.ide-bar-ctx')).toBeNull();
  });

  it('no « Interrompre » when idle, archived, read only (hook_only), offline, or a native OMP session', () => {
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
    cleanup();
    // A native OMP session's stop is the reply's « Arrêter » (it gives the queue back): none in the bar.
    shown({ tool: 'omp', backend: 'omp-rpc' } as Partial<Session>);
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
    // The mockup's `ic.diff` at 13 px.
    expect(chip.querySelector('svg')).toHaveAttribute('width', '13');
    expect([...chip.querySelectorAll('svg path')].map(p => p.getAttribute('d'))).toEqual(['M8 3v8M4 7h8', 'M12 17h8', 'M18 4 6 20']);
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

/** The heading's content moved into the bar (lot 3 follow-up, option A): no heading row in an IDE tab. */
describe('the bar carries what the IDE tab\'s heading said', () => {
  const css = readFileSync(resolve(__dirname, '../../src/styles/ide.css'), 'utf8');
  /** The declarations of `selector` inside `@container (max-width: <w>px)`. */
  const inStep = (w: number) => new RegExp(`@container \\(max-width: ${w}px\\) \\{([^\\n]*)\\}`).exec(css)?.[1] ?? '';

  it('the terminal chip, mono and muted, right after the branch: only while the tab is on its Terminal view', () => {
    shown({}, [], null, { terminal: 'wsl' });
    const chip = bar().querySelector('.ide-bar-chip.tm')!;
    expect(chip).toHaveTextContent('wsl');
    expect(chip).toHaveClass('mono');
    expect(chip.previousElementSibling).toHaveClass('br');
    cleanup();
    shown({}, [], null, { terminal: null });
    expect(bar().querySelector('.ide-bar-chip.tm')).toBeNull();
    cleanup();
    shown();
    expect(bar().querySelector('.ide-bar-chip.tm')).toBeNull();
  });

  it('« N sous-agents »: a chip on the right, before « Interrompre » and « +N −N », with the pill\'s title; a click shows them', async () => {
    const onShowKids = vi.fn();
    const { user } = shown({}, [file('a.ts', 1, 0)], null, { kids: 3, onShowKids });
    const chip = screen.getByTitle('Voir les sous-agents dans la barre latérale');
    expect(chip.closest('.ide-bar-side')).not.toBeNull();
    expect(chip).toHaveTextContent('3 sous-agents');
    expect(chip.querySelector('svg')).not.toBeNull();
    // Before « Interrompre » and the changes.
    const side = [...bar().querySelector('.ide-bar-side')!.children];
    expect(side.indexOf(chip)).toBeLessThan(side.indexOf(screen.getByRole('button', { name: 'Interrompre' })));
    await user.click(chip);
    expect(onShowKids).toHaveBeenCalledTimes(1);
    cleanup();
    shown({}, [], null, { kids: 0, onShowKids });
    expect(screen.queryByTitle('Voir les sous-agents dans la barre latérale')).toBeNull();
  });

  it('the browser chip beside the subagents: the live dot or the browser icon, the captures\' count, the pill\'s titles; a click opens it', async () => {
    const onBrowser = vi.fn();
    const { user } = shown({}, [], null, { kids: 1, onShowKids: vi.fn(), browser: { pill: 'live', captures: 2 }, onBrowser });
    const chip = screen.getByTitle('Navigateur d’Otto, en direct · 2 captures');
    expect(chip.querySelector('.live-dot')).not.toBeNull();
    expect(chip).toHaveTextContent(/Navigateur/);
    expect(chip.querySelector('.tab-count')).toHaveTextContent('2');
    expect(chip.previousElementSibling).toHaveAttribute('title', 'Voir les sous-agents dans la barre latérale');
    await user.click(chip);
    expect(onBrowser).toHaveBeenCalledTimes(1);
    cleanup();
    shown({}, [], null, { browser: { pill: 'captures', captures: 4 }, onBrowser });
    const caps = screen.getByRole('button', { name: 'Navigateur, 4 captures' });
    expect(caps.querySelector('.live-dot')).toBeNull();
    expect(caps.querySelector('svg')).not.toBeNull();
    cleanup();
    shown({}, [], null, { browser: null, onBrowser });
    expect(bar().querySelector('.ide-bar-browser')).toBeNull();
  });

  it('a relief under way or failed: a status chip on the right, the handover\'s text, amber when failed; done, none', () => {
    shown({ handover: { state: 'briefing', at: T } } as Partial<Session>);
    const chip = bar().querySelector('.ide-bar-relief')!;
    expect(chip).toHaveTextContent('relève : bilan demandé');
    expect(chip).toHaveAttribute('role', 'status');
    // On the right, just before its side (out of it: the chip that gives way when the group narrows).
    expect(chip.nextElementSibling).toHaveClass('ide-bar-side');
    expect(chip).not.toHaveClass('amber');
    cleanup();
    shown({ handover: { state: 'failed', at: T, auto: true, reason: 'pas de bilan' } } as Partial<Session>);
    expect(bar().querySelector('.ide-bar-relief')).toHaveTextContent('relève échouée · par Ledge : pas de bilan');
    expect(bar().querySelector('.ide-bar-relief')).toHaveClass('amber');
    cleanup();
    shown({ handover: { state: 'done', at: T, to: 'local:nova', toName: 'Nova' } } as Partial<Session>);
    expect(bar().querySelector('.ide-bar-relief')).toBeNull();
  });

  it('narrow steps: under 560 px the chips keep their icon and count, no label; the terminal chip leaves with the branch at 400 px', () => {
    expect(inStep(560)).toMatch(/\.ide-bar-kids \.lbl/);
    expect(inStep(560)).toMatch(/\.ide-bar-browser \.lbl/);
    expect(inStep(400)).toMatch(/\.ide-bar-chip\.tm/);
    shown({}, [], null, { kids: 2, onShowKids: vi.fn(), browser: { pill: 'closed', captures: 1 }, onBrowser: vi.fn() });
    expect(bar().querySelector('.ide-bar-kids .lbl')).toHaveTextContent('sous-agents');
    expect(bar().querySelector('.ide-bar-kids .n')).toHaveTextContent('2');
    expect(bar().querySelector('.ide-bar-browser .lbl')).toHaveTextContent(/Navigateur/);
  });
});
