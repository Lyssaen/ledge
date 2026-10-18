import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, MenuItem } from '../src/shell/Menu';

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
});
