import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Bot } from '../src/bots/Bot';
import { createI18n, type UiCopy } from '../src/i18n/lang';

const copy = (s: string): UiCopy => ({ botLabel: { starting: s, working: s, approval: s, question: s, idle: s, done: s, error: s, readonly: s }, botReadOnly: `${s}-ro`, botNotLive: `${s}-frozen`, residentName: s, residentOffline: s });
const i18n = createI18n({ langs: ['fr', 'en'] as const, messages: { fr: copy('fr'), en: copy('en') }, fallback: 'fr', prefix: 'ledge', uiCopy: m => m });
beforeEach(() => localStorage.clear());

describe('mascot labels', () => {
  it('outside a provider the bot reads the stored language, as the island always did', () => {
    localStorage.setItem('ledge.lang', 'en');
    const { container } = render(<Bot tool="claude" state="question" pose={1} size={32} theme="dark" seed="s1" readOnly />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Claude Code · en · en-ro');
  });
  it('inside a provider the provider wins', () => {
    localStorage.setItem('ledge.lang', 'en');
    const { container } = render(<i18n.LangProvider lang="fr"><Bot tool="codex" state="working" pose={2} size={32} theme="light" seed="s2" frozen /></i18n.LangProvider>);
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Codex · fr · fr-frozen');
  });
});
