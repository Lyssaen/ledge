import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { boot, closeDaemons, TWO_PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

describe('the session search', () => {
  it('filters as you type, walks with arrows and opens with Enter', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('pay');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([expect.stringContaining('Nova')]);
    await user.clear(screen.getByRole('combobox')); await user.keyboard('{ArrowDown}{Enter}');
    expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when nothing matches', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>}k{/Control}zzz');
    expect(screen.getByText('No session matches this search.')).toBeVisible();
  });

  it('shows Alt n on the first nine main agents', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>}k{/Control}');
    // Every fake session's title starts with « Otto », so pick the option by its own name line.
    const option = (name: string) => screen.getAllByRole('option').find(o => o.querySelector('strong')?.textContent?.startsWith(name))!;
    expect(option('Otto')).toHaveTextContent('Alt 1');
    expect(option('Nova')).toHaveTextContent('Alt 2');
    expect(option('Kit')).toHaveTextContent('Alt 3');
  });

  it('arrows stay within the list, hover selects, a click opens', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>}k{/Control}{ArrowUp}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]!.id);
    await user.hover(screen.getAllByRole('option')[1]!);
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getAllByRole('option')[1]!);
    expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
  });

  it('the shortcuts help lists the rows without Ctrl Alt N', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('?');
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Open Ledge chat')).toBeVisible();
    expect(dialog.textContent).not.toContain('Ctrl Alt N');
  });
});
