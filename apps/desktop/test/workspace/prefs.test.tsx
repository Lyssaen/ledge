import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { loadSettings } from '../../src/settings/lazy';
import { loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { boot, closeDaemons, recordToasts, savedNotices, TWO_PROJECTS } from '../helpers';

let log: string[] = [];
beforeEach(async () => { log = recordToasts(); localStorage.clear(); await loadChat(); });
afterEach(async () => { await closeDaemons(); });

// Lot 12b: the IDE is the only interface; its switch is gone from Settings › General.
describe('Settings › General without the IDE switch', () => {
  it('has no « IDE interface (preview) » row; « Resume open sessions at start » is always there', async () => {
    await Promise.all([loadSettings(), loadIde()]);
    const env = await boot({ projects: TWO_PROJECTS, machines: [{ id: 'local', label: 'Local' }] });
    await env.user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    expect(screen.queryByRole('switch', { name: 'IDE interface (preview)' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'On start, resume the open sessions' })).toBeInTheDocument();
    expect(savedNotices(log)).toEqual([]);
  });
});
