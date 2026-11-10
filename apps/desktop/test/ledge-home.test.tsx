import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatTurn, ClientMessage, Task } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { mentionAt } from '../src/chat/LedgeHome';

const T0 = new Date().toISOString();
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'open', at: T0, updatedAt: T0, log: [{ at: T0, by: 'Ledge', what: 'confiée à Otto' }], ...extra });
const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const point = () => within(screen.getByRole('region', { name: 'The point' }));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openHome(opts: Partial<Pick<Parameters<typeof boot>[0] & object, 'machines' | 'projects'>> = {}) {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, ...opts, sessions: [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } }),
    fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working' })
  ] });
  await screen.findByRole('region', { name: 'The point' });
  return env;
}

describe('Ledge’s home view (ledge home spec)', () => {

  it('@ completes a session in the composer', () => {
    expect(mentionAt('ask @ot')).toEqual({ query: 'ot', start: 4 });
    expect(mentionAt('#led')).toBeNull();
    expect(mentionAt('mail a@b')).toBeNull();
    expect(mentionAt('done ')).toBeNull();
  });
});
