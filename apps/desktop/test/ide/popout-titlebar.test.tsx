import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const calls = vi.hoisted(() => ({ drag: [] as string[], maximize: [] as (string | undefined)[] }));
vi.mock('../../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/tauri/bridge')>()),
  startDraggingWindow: (label: string) => { calls.drag.push(label); },
  toggleMaximizeWindow: (label?: string) => { calls.maximize.push(label); }
}));
import { PopoutTitleBar } from '../../src/ide/PopoutTitleBar';

afterEach(() => { cleanup(); calls.drag.length = 0; calls.maximize.length = 0; });

// Lot 9, jde under Windows: a detached window would not move by its bar. Tauri's drag.js only ran in the popout's initial
// about:blank document, so the bar moves and maximises its own window, by label, from the main page (qitem c18a120e).
it('a left press on the bar moves its own window, a double press maximises it; its buttons and other buttons do not', () => {
  render(<PopoutTitleBar name="Nova · ledge" label="ide-w2" onClose={vi.fn()} />);
  const bar = screen.getByRole('group');
  expect(bar.querySelector('[data-tauri-drag-region]')).toBeNull();
  expect(bar.hasAttribute('data-tauri-drag-region')).toBe(false);
  fireEvent.mouseDown(screen.getByText('Nova · ledge'), { button: 0, detail: 1 });
  expect(calls.drag).toEqual(['ide-w2']);
  fireEvent.mouseDown(bar, { button: 0, detail: 2 });
  expect(calls.maximize).toEqual(['ide-w2']);
  fireEvent.mouseDown(bar, { button: 2, detail: 1 });
  for (const b of screen.getAllByRole('button')) fireEvent.mouseDown(b, { button: 0, detail: 1 });
  expect(calls.drag).toEqual(['ide-w2']);
  expect(calls.maximize).toEqual(['ide-w2']);
});

it('without its label yet, a press does nothing', () => {
  render(<PopoutTitleBar name="Nova" label={null} onClose={vi.fn()} />);
  fireEvent.mouseDown(screen.getByText('Nova'), { button: 0, detail: 1 });
  expect(calls.drag).toEqual([]);
});
