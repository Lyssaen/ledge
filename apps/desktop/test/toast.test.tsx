import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toast, recordToastsForTests, useToast } from '../src/shell/Toast';

let api: ReturnType<typeof useToast>;
function Harness() {
  api = useToast();
  return <Toast notice={api.notice} action={api.action} onAction={api.undo} />;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('toast', () => {
  it('an action toast shows its button for its own duration and runs once', () => {
    const history = recordToastsForTests();
    render(<Harness />);
    const run = vi.fn();
    act(() => api.notify('Wren est archivé.', { label: 'Annuler', run, ms: 8000 }));
    expect(history).toEqual(['Wren est archivé.']);
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.getByRole('button', { name: /^Annuler/ })).toBeVisible();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.queryByRole('button', { name: /^Annuler/ })).toBeNull();
    expect(screen.queryByText('Wren est archivé.')).toBeNull();
    expect(run).not.toHaveBeenCalled();

    act(() => api.notify('Wren est archivé.', { label: 'Annuler', run, ms: 8000 }));
    fireEvent.click(screen.getByRole('button', { name: /^Annuler/ }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Wren est archivé.')).toBeNull();
  });

  it('undo() runs the visible action once and says whether there was one; a plain toast stays at 6 s', () => {
    render(<Harness />);
    const run = vi.fn();
    let ran = true;
    act(() => { ran = api.undo(); });
    expect(ran).toBe(false);
    act(() => api.notify('Fait.'));
    act(() => { ran = api.undo(); });
    expect(ran).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
    act(() => { vi.advanceTimersByTime(5900); });
    expect(screen.getByText('Fait.')).toBeVisible();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('Fait.')).toBeNull();

    act(() => api.notify('Archivé.', { label: 'Annuler', run }));
    act(() => { ran = api.undo(); });
    expect(ran).toBe(true);
    act(() => { ran = api.undo(); });
    expect(ran).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
