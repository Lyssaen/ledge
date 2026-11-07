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
    expect(a).not.toHaveClass('logo-bot');
    expect(b).toHaveAttribute('data-readonly', 'true'); expect(b).not.toHaveClass('logo-bot');
    expect(c).toHaveAttribute('data-tool', 'codex'); expect(c).toHaveAttribute('data-state', 'question'); expect(c).toHaveAttribute('data-frozen', 'true');
    expect(c).not.toHaveClass('logo-bot');
  });
  it('the logo mark keeps the same state and drops the mascot', () => {
    const parent = fakeSession('local:otto', { tool: 'codex', offline: true, state: 'waiting_permission' });
    render(<LangProvider lang="en">
      <SessionBot session={parent} size={32} mark="logo" />
      <SessionBot session={fakeSession('local:hook', { source: 'hook_only', tool: 'claude' })} size={32} mark="logo" />
      <HelperBot helper={{ id: 'h1', kind: 'Explore', task: 'Lire', state: 'waiting_input' }} parent={parent} size={24} mark="logo" />
    </LangProvider>);
    const [a, b, c] = [...document.querySelectorAll('.logo-bot')];
    expect(a).toHaveAttribute('data-tool', 'codex'); expect(a).toHaveAttribute('data-state', 'approval'); expect(a).toHaveAttribute('data-frozen', 'true');
    expect(b).toHaveAttribute('data-tool', 'claude'); expect(b).toHaveAttribute('data-readonly', 'true');
    expect(c).toHaveAttribute('data-tool', 'codex'); expect(c).toHaveAttribute('data-state', 'question'); expect(c).toHaveAttribute('data-frozen', 'true');
  });
  it('the badge says Offline over any state', () => {
    render(<LangProvider lang="en"><StateBadge state="approval" offline /><StateBadge state="question" /></LangProvider>);
    expect(screen.getByText('Offline')).toHaveAttribute('data-badge', 'readonly');
    expect(screen.getByText('Question')).toHaveAttribute('data-badge', 'question');
  });
});
