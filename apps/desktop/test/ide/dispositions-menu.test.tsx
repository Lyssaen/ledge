import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DispositionsMenu } from '../../src/ide/DispositionsMenu';

afterEach(cleanup);

// Review lot 10, N1: the palette's « Enregistrer la disposition… » opens the menu by bumping `saveAsk`; the status bar mounted
// again later finds that count and must not open it by itself.
it('opens on a new save ask only, not on the count it finds when it mounts', () => {
  const props = { list: [], current: null, onApply: vi.fn(), onSave: vi.fn(), onManage: vi.fn() };
  const { rerender } = render(<DispositionsMenu {...props} saveAsk={3} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  rerender(<DispositionsMenu {...props} saveAsk={4} />);
  expect(screen.getByRole('textbox')).toBeTruthy();
});
