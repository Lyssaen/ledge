import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { TabMenu } from '../../src/ide/TabMenu';

afterEach(cleanup);

const T = '2026-11-06T10:00:00.000Z';
type Props = ComponentProps<typeof TabMenu>;

/** Otto's tab menu: on Terminal, alone in its group. */
function shown(extra: Partial<Props> = {}, session: Partial<Session> = {}) {
  const fns = { onSplit: vi.fn(), onClose: vi.fn(), onCloseOthers: vi.fn(), onDismiss: vi.fn(), onView: vi.fn(), onOpenSession: vi.fn() };
  render(<LangProvider lang="fr"><TabMenu at={{ x: 10, y: 10 }} tab={{ kind: 'session', ref: 'local:otto', view: 'terminal' }} name="Otto" terminal others={false}
    session={fakeSession('local:otto', { name: 'Otto', ...session })} {...fns} {...extra} /></LangProvider>);
  const menu = screen.getByRole('menu', { name: /Otto/ });
  return { ...fns, menu, user: userEvent.setup() };
}
/** What the menu's header says under the name. */
const lines = () => [...document.querySelectorAll('.session-menu-head small')].map(x => x.textContent);

/** Lot 3 follow-up (option A): what the IDE tab's heading row held that is not in the bar is in its tab's menu. */
describe('the session tab\'s menu carries what its heading said', () => {
  it('« Ouvrir dans un terminal externe » when the external terminal applies, absent otherwise', async () => {
    const onExternal = vi.fn();
    const { menu, user } = shown({ onExternal });
    await user.click(within(menu).getByRole('menuitem', { name: 'Ouvrir dans un terminal externe' }));
    expect(onExternal).toHaveBeenCalledTimes(1);
    cleanup();
    const again = shown();
    expect(within(again.menu).queryByRole('menuitem', { name: 'Ouvrir dans un terminal externe' })).toBeNull();
  });

  it('« Relevée par Nova » and « Relève de Mara » are entries that open the other session', async () => {
    const { menu, user, onOpenSession } = shown({}, { handover: { state: 'done', at: T, to: 'local:nova', toName: 'Nova' }, relieves: { id: 'local:mara', name: 'Mara', at: T } });
    await user.click(within(menu).getByRole('menuitem', { name: 'Relevée par Nova' }));
    expect(onOpenSession).toHaveBeenLastCalledWith('local:nova');
    cleanup();
    const again = shown({}, { relieves: { id: 'local:mara', name: 'Mara', at: T } });
    await again.user.click(within(again.menu).getByRole('menuitem', { name: 'Relève de Mara' }));
    expect(again.onOpenSession).toHaveBeenLastCalledWith('local:mara');
  });

  it('a relief under way or failed is a line under the header, not an entry', () => {
    shown({}, { handover: { state: 'launching', at: T } });
    expect(lines()).toEqual(['relève : lancement…']);
    expect(screen.queryByRole('menuitem', { name: /relève/i })).toBeNull();
    cleanup();
    shown({}, { handover: { state: 'failed', at: T, reason: 'pas de bilan' } });
    expect(lines()).toEqual(['relève échouée : pas de bilan']);
    expect(document.querySelector('.session-menu-head small')).toHaveClass('failed');
  });

  it('Story / Objectif: lines under the header, with the tags\' labels', () => {
    shown({ tags: { story: 'ST7-123', objectif: 'implementation' } });
    expect(lines()).toEqual(['Story : ST7-123', 'Objectif : Implémentation']);
    cleanup();
    shown({ tags: null });
    expect(lines()).toEqual([]);
  });

  it('a tab that is not a session\'s (Changes) has none of these', () => {
    shown({ tab: { kind: 'changes', ref: 'local:otto' }, onExternal: vi.fn(), tags: { story: 'ST7-1' } });
    expect(screen.queryByRole('menuitem', { name: 'Ouvrir dans un terminal externe' })).toBeNull();
    expect(lines()).toEqual([]);
  });
});
