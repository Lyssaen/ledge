import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { boot, closeDaemons, listSessions, TWO_PROJECTS } from './helpers';
import { MESSAGES } from '../src/i18n/messages';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

/** The IDE's tab in front of its group (the old top bar named the place: the IDE's tabs do). */
const activeTab = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container')).find(t => t.getAttribute('aria-selected') === 'true');

describe('the sidebar shell', () => {
  it('has neither question field, New session button, brand nor search', async () => {
    const sessions = listSessions();
    const { side } = await boot({ projects: TWO_PROJECTS, sessions });
    expect(side.queryByRole('button', { name: /^New session N/ })).toBeNull();
    expect(document.querySelector('.st-brand')).toBeNull();
    // docs/mockups/ledge-sidebar-tidy.html, point 5: the « Ask Ledge… » field is gone; the entry (or /) opens Ledge's home.
    expect(side.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('[data-ask-input]')).toBeNull();
    expect(document.querySelector('.sidebar [data-brand]')).toBeNull();
    expect(side.queryByRole('button', { name: /Search/ })).toBeNull();
  });

  it('no project and no session: the Projects header keeps only + and the box offers « Create a session » (sidebar tidy, point 3)', async () => {
    const { side, user } = await boot({ projects: { projects: [], rules: [] }, sessions: [] });
    const box = side.getByRole('status');
    expect(box).toHaveTextContent('No session yet.A session runs an agent in a folder or a project.Create a session');
    expect(box).toHaveClass('st-empty');
    const header = box.previousElementSibling as HTMLElement;
    expect(within(header).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['New project']);
    await user.click(within(box).getByRole('button', { name: 'Create a session' }));
    expect(await screen.findByRole('dialog', { name: /New session/ })).toBeVisible();
  });

  it('the shortcuts tooltip shows on hover and on keyboard focus', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/sidebar.css'), 'utf8');
    expect(css).toMatch(/\.st-keys:hover \.st-keys-tip/);
    expect(css).toMatch(/\.st-keys:focus-within \.st-keys-tip/);
  });

  it('no shortcut reminder at the foot of the sidebar, in the overview or in a session: the ? holds them (#51)', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const reminder = () => {
      expect(document.querySelector('.st-hint')).toBeNull();
      for (const text of ['new session', 'move', 'fold', 'Ctrl ⇧ E']) expect(side.queryByText(text, { ignore: '.st-keys-tip *' })).toBeNull();
    };
    reminder();
    await user.click(side.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Nova'));
    reminder();
    expect(readFileSync(resolve(__dirname, '../src/styles/sidebar.css'), 'utf8')).not.toMatch(/st-hint/);
  });

  it('the sidebar keys join the shortcuts list: in the ? dialog, in English and in French (#51)', async () => {
    const sidebarRows = { en: [['← / →', 'Fold / unfold a project (sidebar)'], ['E', 'Archive the selected session'], ['H', 'Show / hide the finished sessions'], ['Ctrl ⇧ E', 'Focus the sidebar']], fr: [['← / →', 'Plier / déplier un projet (barre latérale)'], ['E', 'Archiver la session sélectionnée'], ['H', 'Afficher / masquer les sessions terminées'], ['Ctrl ⇧ E', 'Aller à la barre latérale']] } as const;
    for (const lang of ['en', 'fr'] as const) for (const row of sidebarRows[lang]) expect(MESSAGES[lang].shortcuts.rows).toContainEqual(row);
    const { user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    // The dialog's keys sit beside the action.
    for (const [keys, action] of sidebarRows.en) expect(within(dialog).getByText(action).parentElement!.querySelector('kbd')).toHaveTextContent(keys);
  });

});
