import { describe, it, expect } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { Badge } from '../src/ui/Badge';
import { UiCopyProvider, useUiCopy } from '../src/i18n/copy';

describe('Badge', () => {
  it('labels a state from the app copy, a given label wins', () => {
    const { result } = renderHook(() => useUiCopy());
    const defaultCopy = result.current;
    const copy = { ...defaultCopy, stateLabel: { ...defaultCopy.stateLabel, approval: 'Your approval' } };
    render(<UiCopyProvider copy={copy}><Badge state="approval" /><Badge state="question" label="Hors ligne" /></UiCopyProvider>);
    expect(screen.getByText('Your approval')).toHaveAttribute('data-badge', 'approval');
    expect(screen.getByText('Hors ligne')).toHaveAttribute('data-badge', 'question');
  });
});
