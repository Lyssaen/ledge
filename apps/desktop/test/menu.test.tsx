import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { Menu, MenuItem } from '../src/shell/Menu';
import { useContextMenu, type ContextMenuState } from '../src/manage/useContextMenu';

// The external terminal's commands, watched: the session menu must never reach them.
const bridge = vi.hoisted(() => ({ openTerminal: vi.fn(async () => true), focusTerminal: vi.fn(async () => true) }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), ...bridge }));

function Harness({ onSelect }: { onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Menu open={open} onOpenChange={setOpen} label="Actions" className="assign-wrap" menuClassName="assign-menu" trigger={p => <button {...p}>Actions</button>}>
      {['Alpha', 'Beta', 'Gamma'].map(v => <MenuItem key={v} onSelect={() => onSelect(v)}>{v}</MenuItem>)}
    </Menu>
    <button>Elsewhere</button>
  </>;
}
const setup = () => { const onSelect = vi.fn(); render(<Harness onSelect={onSelect} />); return { onSelect, user: userEvent.setup(), trigger: screen.getByRole('button', { name: 'Actions' }) }; };

describe('Menu', () => {
  it('the trigger says it opens a menu; the menu opens on its first item; ↓ ↑ wrap, Home and End', async () => {
    const { user, trigger } = setup();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu'); expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{ArrowDown}'); expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}'); expect(screen.getByRole('menuitem', { name: 'Gamma' })).toHaveFocus();
    await user.keyboard('{Home}'); expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{End}'); expect(screen.getByRole('menuitem', { name: 'Gamma' })).toHaveFocus();
  });
  it('Escape closes it, goes no further and gives the focus back to its trigger', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    const onWindow = vi.fn(); window.addEventListener('keydown', onWindow);
    await user.keyboard('{Escape}');
    window.removeEventListener('keydown', onWindow);
    expect(onWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it('a choice closes it, gives the focus back, then acts; a mousedown outside closes it', async () => {
    const { user, trigger, onSelect } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith('Beta');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('Tab out of an open menu, or focusing a control outside, closes it and leaves the focus where it went', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.tab(); await user.tab();
    expect(screen.getByRole('menu')).toBeVisible();
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeVisible();
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });
  it('opens at a point, kept inside the window', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 90, width: 160, height: 90, toJSON() {} });
    try {
      render(<Menu open onOpenChange={() => {}} label="Session" className="ctx" menuClassName="ctx-menu" at={{ x: window.innerWidth - 5, y: window.innerHeight - 5 }} trigger={() => null}>
        <MenuItem onSelect={() => {}}>Archive</MenuItem><MenuItem onSelect={() => {}}>Delete</MenuItem>
      </Menu>);
      const menu = screen.getByRole('menu', { name: 'Session' });
      expect(menu.style.position).toBe('fixed');
      expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 160);
      expect(parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 90);
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    } finally { rect.mockRestore(); }
  });

  it('a contextmenu inside an open menu never shows the webview menu (the menu key sends it after the menu took the focus)', () => {
    render(<Menu open onOpenChange={() => {}} label="Session" className="ctx" menuClassName="ctx-menu" at={{ x: 10, y: 10 }} trigger={() => null}>
      <MenuItem onSelect={() => {}}>Archive</MenuItem>
    </Menu>);
    expect(fireEvent.contextMenu(screen.getByRole('menuitem', { name: 'Archive' }))).toBe(false);
  });
});

describe('the session menu', () => {
  it('the menu\'s « Terminal » opens the pane in Ledge, on the agent tab, offline too', () => {
    const client = { send: vi.fn(), fleet: null } as unknown as DaemonClient;
    const onShowTerminal = vi.fn();
    const live = fakeSession('local:otto', { name: 'Otto', state: 'working' });
    const lost = fakeSession('local:lost', { name: 'Lost', state: 'working', offline: true });
    const { result } = renderHook(() => useContextMenu({ client, sessions: [live, lost], archived: [], projects: [], onShowTerminal }));
    act(() => result.current.terminal(live));
    act(() => result.current.terminal(lost));
    expect(onShowTerminal.mock.calls).toEqual([['local:otto'], ['local:lost']]);
    expect(bridge.openTerminal).not.toHaveBeenCalled();
    expect(bridge.focusTerminal).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe('useContextMenu', () => {
  const client = { send: vi.fn(), fleet: null } as unknown as DaemonClient;
  const otto = fakeSession('local:otto', { name: 'Otto', state: 'working' });
  const nova = fakeSession('local:nova', { name: 'Nova', state: 'exited', archivedAt: '2026-10-18T10:00:00.000Z' });
  const ledge = { id: 'ledge', name: 'Ledge', color: 'green', repos: [] } as unknown as Parameters<typeof useContextMenu>[0]['projects'][number];
  const at = { x: 10, y: 20 };
  type Props = Parameters<typeof useContextMenu>[0];
  const hook = (props: Partial<Props> = {}) => renderHook((p: Props) => useContextMenu(p), {
    initialProps: { client, sessions: [otto], archived: [nova], projects: [ledge], onShowTerminal: vi.fn(), ...props }
  });

  it('open(id) is a session target; openOn holds any target; one at a time', () => {
    const { result } = hook();
    act(() => result.current.open('local:otto', at, null));
    expect(result.current.menu?.target).toEqual({ kind: 'session', id: 'local:otto' });
    expect(result.current.session?.id).toBe('local:otto');
    act(() => result.current.openOn({ kind: 'archives' }, at, null));
    expect(result.current.menu?.target).toEqual({ kind: 'archives' });
    expect(result.current.session).toBeNull();
  });

  it('closes when its target goes away', () => {
    const cases: Array<[Parameters<ContextMenuState['openOn']>[0], Partial<Props>]> = [
      [{ kind: 'project', id: 'ledge' }, { projects: [] }],
      [{ kind: 'archive', id: 'local:nova' }, { archived: [] }],
      [{ kind: 'session', id: 'local:otto' }, { sessions: [] }]
    ];
    for (const [target, gone] of cases) {
      const { result, rerender } = hook();
      act(() => result.current.openOn(target, at, null));
      expect(result.current.menu?.target).toEqual(target);
      rerender({ client, sessions: [otto], archived: [nova], projects: [ledge], onShowTerminal: vi.fn(), ...gone });
      expect(result.current.menu).toBeNull();
    }
  });
});
