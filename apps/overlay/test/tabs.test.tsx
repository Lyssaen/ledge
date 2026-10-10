import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../src/ui/Tabs';

const TABS = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }] as const;
type V = (typeof TABS)[number]['value'];
const view = (value: V = 'a') => {
  const onChange = vi.fn<(v: V) => void>();
  render(<Tabs<V> id="t" label="Sections" value={value} tabs={TABS} onChange={onChange} />);
  return onChange;
};

describe('<Tabs>', () => {
  it('is a labelled tablist whose selected tab alone is in the tab order and points at its panel', () => {
    view('b');
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    const beta = screen.getByRole('tab', { name: 'Beta' });
    expect(beta).toHaveAttribute('aria-selected', 'true');
    expect(beta).toHaveAttribute('tabindex', '0');
    expect(beta).toHaveAttribute('id', 't-tab-b');
    expect(beta).toHaveAttribute('aria-controls', 't-panel-b');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
  });
  it('a click chooses a tab', () => {
    const onChange = view();
    fireEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });
  it('arrows move and wrap, Home and End jump; the newly chosen tab takes focus', () => {
    const onChange = view('a');
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Beta' }));
    fireEvent.keyDown(alpha, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(alpha, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Gamma' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(alpha, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(onChange).toHaveBeenCalledTimes(5);
  });
  it('other keys are left alone', () => {
    const onChange = view();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'Tab' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
