import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { DaemonClient } from '@ledge/fleet';
import type { TermStore } from '../../src/term/store';
import { TermStoreContext } from '../../src/term/useTerms';
import { LangProvider } from '../../src/i18n/lang';
import { ChangesTabLabel, SessionTabLabel } from '../../src/ide/SessionTabLabel';
import type { Tab } from '../../src/workspace/model';

afterEach(cleanup);

const tab: Tab = { kind: 'session', ref: 'otto' };
const draw = (ui: JSX.Element) => render(<LangProvider lang="fr">{ui}</LangProvider>);

describe('SessionTabLabel', () => {
  it('Claude working: the Anthropic logo, the name, the working dot', () => {
    const { container } = draw(<SessionTabLabel session={fakeSession('otto', { name: 'Otto', tool: 'claude', state: 'working' })} tab={tab} title="Otto" />);
    expect(screen.getByTitle('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('Otto')).toBeInTheDocument();
    expect(container.querySelector('.tab-dot.d-working')).not.toBeNull();
    expect(screen.queryByTitle('Vue terminal')).toBeNull();
  });
  it('the terminal view shows >_', () => {
    draw(<SessionTabLabel session={fakeSession('otto', { name: 'Otto', tool: 'claude' })} tab={{ ...tab, view: 'terminal' }} title="Otto" />);
    expect(screen.getByTitle('Vue terminal')).toHaveTextContent('>_');
  });
  it('the >_ says what the agent screen\'s footer said, gone from an IDE tab: its state and its tmux target', () => {
    const none: never[] = [];
    const client = { send: () => {}, onMessage: () => () => {}, fleet: { machines: () => none, subscribe: () => () => {} } } as unknown as DaemonClient;
    // No pseudo-terminal nor stream here (jsdom): the screen cannot be shown, read only.
    draw(<SessionTabLabel client={client} session={fakeSession('otto', { name: 'Otto', tool: 'claude' })} tab={{ ...tab, view: 'terminal' }} title="Otto" />);
    expect(screen.getByText('>_')).toHaveAttribute('title', 'Vue terminal · lecture seule');
  });
  it('on a subagent\'s page the screen is its parent\'s, read only: the >_ says so, not « attaché »', () => {
    // A machine that streams panes, and a store whose screen of Otto is made and attached.
    const streams = [{ id: 'local', daemon: { version: '1', install: 'npm', systemd: true, terminalStream: true } }];
    const client = { send: () => {}, onMessage: () => () => {}, fleet: { machines: () => streams, subscribe: () => () => {} } } as unknown as DaemonClient;
    const link = { state: 'attached', attempt: 0 }, surface = {};
    const store = { subscribe: () => () => {}, link: () => link, surface: () => surface, viewerOf: () => null } as unknown as TermStore;
    const otto = fakeSession('otto', { name: 'Otto', tool: 'claude' });
    const label = (helper?: { id: string }) => draw(<TermStoreContext.Provider value={store}>
      <SessionTabLabel client={client} session={otto} {...(helper && { helper })} tab={{ ...tab, view: 'terminal' }} title="Otto" />
    </TermStoreContext.Provider>);
    label();
    expect(screen.getByText('>_')).toHaveAttribute('title', 'Vue terminal · attaché · tmux · ledge-otto');
    cleanup();
    label({ id: 'h1' });
    expect(screen.getByText('>_')).toHaveAttribute('title', 'Vue terminal · lecture seule · tmux · ledge-otto');
  });
  it('a seat names its rig', () => {
    draw(<SessionTabLabel session={fakeSession('otto', { name: 'Otto', tool: 'omp', rig: { seat: 's', name: 'ledge-dev' } })} tab={{ kind: 'seat', ref: 'otto' }} title="Otto" />);
    expect(screen.getByText('ledge-dev')).toBeInTheDocument();
    expect(screen.getByTitle('omp')).toBeInTheDocument();
  });
  it('each tool its provider\'s real logo: Claude\'s spark in its orange, OpenAI\'s and Cursor\'s marks in currentColor, omp\'s π', () => {
    const logo = (tool: 'claude' | 'codex' | 'cursor' | 'omp', title: string) => {
      draw(<SessionTabLabel session={fakeSession('otto', { name: 'Otto', tool })} tab={tab} title="Otto" />);
      const el = screen.getByTitle(title);
      const path = el.querySelector('svg path')!;
      cleanup();
      return path;
    };
    expect(logo('claude', 'Anthropic')).toHaveAttribute('fill', '#D97757');
    expect(logo('codex', 'OpenAI').closest('svg')).toHaveAttribute('fill', 'currentColor');
    expect(logo('cursor', 'Cursor').closest('svg')).toHaveAttribute('fill', 'currentColor');
    expect(logo('omp', 'omp').getAttribute('fill')).toMatch(/^url\(#.+\)$/);
  });
  it('two omp logos on screen each point at their own gradient', () => {
    const { container } = draw(<>
      <SessionTabLabel session={fakeSession('a', { name: 'A', tool: 'omp' })} tab={tab} title="A" />
      <ChangesTabLabel session={fakeSession('b', { name: 'B', tool: 'omp' })} title="B" />
    </>);
    const ids = [...container.querySelectorAll('linearGradient')].map(g => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const fills = [...container.querySelectorAll('path[fill^="url("]')].map(p => p.getAttribute('fill'));
    expect(fills).toEqual(ids.map(id => `url(#${id})`));
  });
  it('an unknown session: the title alone, no dot', () => {
    const { container } = draw(<SessionTabLabel session={undefined} tab={tab} title="otto" />);
    expect(container).toHaveTextContent('otto');
    expect(container.querySelector('.tab-dot, .logo')).toBeNull();
  });
  it('the extras are aria-hidden: the accessible text is the title', () => {
    const { container } = draw(<SessionTabLabel session={fakeSession('otto', { name: 'Otto', tool: 'claude', rig: { seat: 's', name: 'ledge-dev' } })} tab={{ ...tab, view: 'terminal' }} title="Otto" />);
    for (const el of container.querySelectorAll('.logo, .tab-term, .tab-rig, .tab-dot')) expect(el.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('ChangesTabLabel', () => {
  it('the session\'s provider logo at 12 px, aria-hidden, then « Modifications · name »', () => {
    const { container } = draw(<ChangesTabLabel session={fakeSession('otto', { name: 'Otto', tool: 'codex' })} title="Modifications · Otto" />);
    const logo = screen.getByTitle('OpenAI');
    expect(logo.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(logo.querySelector('svg')).toHaveAttribute('width', '12');
    expect(container).toHaveTextContent('Modifications · Otto');
  });
  it('Cursor Agent has its logo; a session not known has none', () => {
    expect(draw(<ChangesTabLabel session={fakeSession('otto', { tool: 'cursor' })} title="x" />).container.querySelector('.logo')).toHaveAttribute('title', 'Cursor');
    expect(draw(<ChangesTabLabel session={undefined} title="y" />).container.querySelector('.logo')).toBeNull();
  });
});

describe('the tab name', () => {
  it('a long name ends in an ellipsis instead of widening the tab without limit (ide.css)', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles/ide.css'), 'utf8');
    const rule = /\.ide-tab \.tab-name\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/max-width:\s*220px/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });
});
