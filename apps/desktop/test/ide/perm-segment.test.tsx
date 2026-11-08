import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../../src/i18n/lang';
import { PermSegment } from '../../src/ide/PermSegment';
import type { PermLevel } from '../../src/ide/rig/model';

afterEach(() => cleanup());

/** A parent that keeps the level, as a screen does. */
function Held({ start, onChange, off }: { start: PermLevel | null; onChange(l: PermLevel): void; off?: (l: PermLevel) => boolean }) {
  const [v, setV] = useState<PermLevel | null>(start);
  return <PermSegment value={v} label="Permissions" onChange={l => { setV(l); onChange(l); }} {...(off ? { levelOff: off } : {})} />;
}
const mount = (start: PermLevel | null, off?: (l: PermLevel) => boolean) => {
  const onChange = vi.fn();
  render(<LangProvider lang="fr"><Held start={start} onChange={onChange} {...(off ? { off } : {})} /></LangProvider>);
  return onChange;
};

describe('PermSegment', () => {
  it('is a radiogroup of the six levels, the chosen one checked and alone in the tab order, YOLO marked risky', () => {
    mount('standard');
    expect(screen.getByRole('radiogroup', { name: 'Permissions' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map(r => r.textContent)).toEqual(['Spec', 'Auto', 'Standard', 'Ouvert', 'YOLO', 'Verrouillé']);
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');
    expect(radios.filter(r => r.tabIndex === 0)).toEqual([screen.getByRole('radio', { name: 'Standard' })]);
    expect(screen.getByRole('radio', { name: 'YOLO' })).toHaveClass('risky');
  });

  it('the right arrow from Spec chooses Auto and moves the focus there; End chooses Verrouillé, Home Spec', async () => {
    const onChange = mount('spec');
    screen.getByRole('radio', { name: 'Spec' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('auto');
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('locked');
    expect(screen.getByRole('radio', { name: 'Verrouillé' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('spec');
  });

  it('the arrows wrap and skip a level that is off', async () => {
    const onChange = mount('auto', l => l === 'spec');
    screen.getByRole('radio', { name: 'Auto' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('locked');
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('auto');
    expect(screen.getByRole('radio', { name: 'Spec' })).toBeDisabled();
  });

  it('with no level known, the first level is the one in the tab order', () => {
    mount(null);
    expect(screen.getAllByRole('radio').filter(r => r.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    expect(screen.getByRole('radio', { name: 'Spec' }).tabIndex).toBe(0);
  });

  it('disabled: every level is off and nothing is sent', async () => {
    const onChange = vi.fn();
    render(<LangProvider lang="fr"><PermSegment value="spec" label="Permissions" disabled onChange={onChange} /></LangProvider>);
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
