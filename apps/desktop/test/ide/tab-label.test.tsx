import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../../src/i18n/lang';
import { SessionTabLabel } from '../../src/ide/SessionTabLabel';
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
  it('a seat names its rig', () => {
    draw(<SessionTabLabel session={fakeSession('otto', { name: 'Otto', tool: 'omp', rig: { seat: 's', name: 'ledge-dev' } })} tab={{ kind: 'seat', ref: 'otto' }} title="Otto" />);
    expect(screen.getByText('ledge-dev')).toBeInTheDocument();
    expect(screen.getByTitle('omp')).toBeInTheDocument();
  });
  it('Cursor Agent has no logo', () => {
    const { container } = draw(<SessionTabLabel session={fakeSession('otto', { name: 'Otto', tool: 'cursor' })} tab={tab} title="Otto" />);
    expect(container.querySelector('.logo')).toBeNull();
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
