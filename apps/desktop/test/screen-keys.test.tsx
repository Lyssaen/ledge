import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { initialNav, type NavAction, type NavState } from '../src/nav/state';
import { useKeys } from '../src/nav/useKeys';
import { ScreenKeysContext, useScreenKeys, type ScreenKeys } from '../src/nav/screenKeys';
import { TabPlaceContext } from '../src/workspace/tabPlace';

const base = initialNav({ view: 'atelier', helpers: true, paused: false });
function Harness({ state, keys, dispatch }: { state: NavState; keys: ScreenKeys; dispatch: (a: NavAction) => void }) {
  useKeys(dispatch, { state, order: [], screen: keys, undo: () => false });
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
    expect(dispatch).toHaveBeenCalledWith({ type: 'ledge' });
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
    fireEvent.keyDown(document.body, { key: '1', altKey: true });
    expect(handler).not.toHaveBeenCalled();
  });
  it('Escape goes to the screen after a dialog and the chat, before navigation; a screen that takes it keeps the place', () => {
    const handler = vi.fn((e: KeyboardEvent) => e.key === 'Escape');
    const dispatch = vi.fn();
    const { rerender } = render(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    screen.getByRole('textbox', { name: 'field' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(handler).toHaveBeenCalledTimes(2);                                   // the screen decides, even while typing
    (document.activeElement as HTMLElement).blur();
    rerender(<Harness state={{ ...base, modal: { kind: 'shortcuts' } }} keys={{ current: handler }} dispatch={dispatch} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    rerender(<Harness state={{ ...base, chat: true }} keys={{ current: handler }} dispatch={dispatch} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls).toEqual([[{ type: 'escape' }], [{ type: 'escape' }]]);
  });
  it('a screen that declines Escape lets navigation have it', () => {
    const dispatch = vi.fn();
    render(<Harness state={base} keys={{ current: () => false }} dispatch={dispatch} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'escape' });
  });
  it('Ctrl K still opens the search while typing, under a dialog or with the chat open; J reaches the screen again once they close', () => {
    const handler = vi.fn((e: KeyboardEvent) => e.key === 'j');
    const dispatch = vi.fn();
    const search = { type: 'modal', modal: { kind: 'search' } };
    const { rerender } = render(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
    screen.getByRole('textbox', { name: 'field' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'k', ctrlKey: true });
    expect(dispatch).toHaveBeenLastCalledWith(search);
    (document.activeElement as HTMLElement).blur();
    rerender(<Harness state={{ ...base, modal: { kind: 'shortcuts' } }} keys={{ current: handler }} dispatch={dispatch} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(dispatch).toHaveBeenLastCalledWith(search);
    rerender(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);         // the dialog closed
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(handler).toHaveBeenCalledTimes(1);
    rerender(<Harness state={{ ...base, chat: true }} keys={{ current: handler }} dispatch={dispatch} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(dispatch).toHaveBeenLastCalledWith(search);
    expect(handler).toHaveBeenCalledTimes(1);
    rerender(<Harness state={{ ...base, chat: false }} keys={{ current: handler }} dispatch={dispatch} />);   // the chat closed
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(3);
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

describe('screen keys inside IDE tabs', () => {
  const place = (key: string, active: boolean) => ({ key, group: 'g1', visible: active, active });
  function Screen({ handler }: { handler: () => boolean }) { useScreenKeys(handler); return null; }
  function Two({ keys, a, b, ha, hb }: { keys: ScreenKeys; a: boolean; b: boolean; ha: () => boolean; hb: () => boolean }) {
    return (
      <ScreenKeysContext.Provider value={keys}>
        <TabPlaceContext.Provider value={place('a', a)}><Screen handler={ha} /></TabPlaceContext.Provider>
        <TabPlaceContext.Provider value={place('b', b)}><Screen handler={hb} /></TabPlaceContext.Provider>
      </ScreenKeysContext.Provider>
    );
  }
  const call = (keys: ScreenKeys) => keys.current?.(new KeyboardEvent('keydown', { key: 'j' }));

  it('only the active tab\'s screen is registered, and the registration follows the active tab', () => {
    const keys: ScreenKeys = { current: null };
    const ha = vi.fn(() => true), hb = vi.fn(() => true);
    const { rerender } = render(<Two keys={keys} a b={false} ha={ha} hb={hb} />);
    call(keys);
    expect([ha.mock.calls.length, hb.mock.calls.length]).toEqual([1, 0]);
    rerender(<Two keys={keys} a={false} b ha={ha} hb={hb} />);
    call(keys);
    expect([ha.mock.calls.length, hb.mock.calls.length]).toEqual([1, 1]);
    rerender(<Two keys={keys} a b={false} ha={ha} hb={hb} />);
    call(keys);
    expect([ha.mock.calls.length, hb.mock.calls.length]).toEqual([2, 1]);
    rerender(<Two keys={keys} a={false} b={false} ha={ha} hb={hb} />);
    expect(keys.current).toBeNull();
  });
  it('without a place the last mounted screen wins, as ever', () => {
    const keys: ScreenKeys = { current: null };
    const ha = vi.fn(() => true), hb = vi.fn(() => true);
    render(<ScreenKeysContext.Provider value={keys}><Screen handler={ha} /><Screen handler={hb} /></ScreenKeysContext.Provider>);
    call(keys);
    expect([ha.mock.calls.length, hb.mock.calls.length]).toEqual([0, 1]);
  });
});
