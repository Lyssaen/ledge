import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { initialNav, type NavAction, type NavState } from '../src/nav/state';
import { useKeys } from '../src/nav/useKeys';
import { ScreenKeysContext, useScreenKeys, type ScreenKeys } from '../src/nav/screenKeys';

const base = initialNav({ view: 'atelier', helpers: true, paused: false });
function Harness({ state, keys, dispatch }: { state: NavState; keys: ScreenKeys; dispatch: (a: NavAction) => void }) {
  useKeys(dispatch, { state, order: [], screen: keys });
  return <input aria-label="field" />;
}

describe('screen keys', () => {
  it('hands a key to the screen once the global guards pass; a key it declines stays global', () => {
    const handler = vi.fn((e: KeyboardEvent) => e.key === 'j');
    const dispatch = vi.fn();
    render(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
    expect(fireEvent.keyDown(document.body, { key: 'j' })).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'chat', open: true });
  });
  it('never while typing, under a dialog or with the chat open; Escape and Alt stay global', () => {
    const handler = vi.fn(() => true);
    const dispatch = vi.fn();
    const { rerender } = render(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
    screen.getByRole('textbox', { name: 'field' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    (document.activeElement as HTMLElement).blur();
    rerender(<Harness state={{ ...base, modal: { kind: 'shortcuts' } }} keys={{ current: handler }} dispatch={dispatch} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    rerender(<Harness state={{ ...base, chat: true }} keys={{ current: handler }} dispatch={dispatch} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    rerender(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: '1', altKey: true });
    expect(handler).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'escape' });
  });
  it('useScreenKeys registers while mounted and always calls the latest handler', () => {
    const keys: ScreenKeys = { current: null };
    function Screen({ answer }: { answer: boolean }) { useScreenKeys(() => answer); return null; }
    const { rerender, unmount } = render(<ScreenKeysContext.Provider value={keys}><Screen answer={false} /></ScreenKeysContext.Provider>);
    rerender(<ScreenKeysContext.Provider value={keys}><Screen answer={true} /></ScreenKeysContext.Provider>);
    expect(keys.current!(new KeyboardEvent('keydown', { key: 'x' }))).toBe(true);
    unmount();
    expect(keys.current).toBeNull();
  });
});
