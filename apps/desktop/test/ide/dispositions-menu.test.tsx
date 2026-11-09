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

// The current disposition deleted (design-ux, 2026-11-09, card 1 of ledge-ide-layouts-palette.html): « Disposition » in grey,
// still a button; its tip only when no disposition is left.
it('with none shown: « Disposition », the tip only when no disposition is left', () => {
  const props = { current: null, onApply: vi.fn(), onSave: vi.fn(), onManage: vi.fn() };
  const one = { name: 'Revue', ws: { version: 1 as const, windows: ['main'], groups: [{ id: 'g1', window: 'main', tabs: [], active: 0, link: null }], focus: 'g1', next: 2 }, bottom: false, right: true, panel: [], shells: {} };
  const { container, rerender } = render(<DispositionsMenu {...props} list={[one]} />);
  const button = () => container.querySelector<HTMLButtonElement>('button.ide-lay')!;
  expect(button().classList.contains('none')).toBe(true);
  expect(button().hasAttribute('title')).toBe(false);
  rerender(<DispositionsMenu {...props} list={[]} />);
  expect(button().getAttribute('title')).toBeTruthy();
});
