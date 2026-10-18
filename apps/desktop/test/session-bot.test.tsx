import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { HelperBot, SessionBot, StateBadge } from '../src/shell/SessionBot';

describe('the shared session bot and badge', () => {
  it("a session's bot: frozen offline, read-only for hook_only; a helper's bot borrows its parent's tool", () => {
    const parent = fakeSession('local:otto', { tool: 'codex', offline: true, state: 'waiting_permission' });
    render(<LangProvider lang="en">
      <SessionBot session={parent} size={32} />
      <SessionBot session={fakeSession('local:hook', { source: 'hook_only' })} size={32} />
      <HelperBot helper={{ id: 'h1', kind: 'Explore', task: 'Lire', state: 'waiting_input' }} parent={parent} size={24} />
    </LangProvider>);
    const [a, b, c] = [...document.querySelectorAll('[data-frozen]')];
    expect(a).toHaveAttribute('data-frozen', 'true'); expect(a).toHaveAttribute('data-state', 'approval');
    expect(b).toHaveAttribute('data-readonly', 'true');
    expect(c).toHaveAttribute('data-tool', 'codex'); expect(c).toHaveAttribute('data-state', 'question'); expect(c).toHaveAttribute('data-frozen', 'true');
  });
  it('the badge says Offline over any state', () => {
    render(<LangProvider lang="en"><StateBadge state="approval" offline /><StateBadge state="question" /></LangProvider>);
    expect(screen.getByText('Offline')).toHaveAttribute('data-badge', 'readonly');
    expect(screen.getByText('Question')).toHaveAttribute('data-badge', 'question');
  });
});
