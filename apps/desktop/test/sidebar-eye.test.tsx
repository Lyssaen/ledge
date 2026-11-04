import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, PROJECTS, TWO_PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await closeDaemons(); });

/** docs/mockups/ledge-projects-eye.html: the eye of « Projets » shows the projects with a live agent, or every project. */
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const PIM = fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working', lastActivityAt: ago(7), topic: 'Clarifier le menu' });
const MAX = fakeSession('max', { name: 'Max', cwd: '/w/ledge', state: 'idle', lastActivityAt: ago(12), topic: 'Relire la maquette' });
const REX = fakeSession('rex', { name: 'Rex', cwd: '/w/ledge', state: 'exited', lastActivityAt: ago(120), topic: 'Corriger l’alignement' });
const ZOE = fakeSession('zoe', { name: 'Zoe', cwd: '/w/pay', state: 'idle', lastActivityAt: ago(60), topic: 'Regarder l’umbrella' });
const EYE = 'Only projects with a live agent (H)';

const projectsBox = (side: ReturnType<typeof within>) => within(side.getByRole('region', { name: 'Projects' }));
const heads = () => [...document.querySelectorAll('.st-tree .st-project .st-main strong')].map(e => e.textContent);

describe('the eye of « Projets »', () => {
  it('pressed: the projects with a live agent (an idle one counts), their ended sessions folded, « +N projects » that releases it', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: [PIM, MAX, REX, ZOE] });
    const box = projectsBox(side);
    const eye = box.getByRole('button', { name: EYE });
    expect(eye).toHaveAttribute('aria-pressed', 'true');
    expect(eye).toHaveAttribute('title', EYE);
    // Docs has no session: out. Ledge's idle Max shows; only the ended Rex folds.
    expect(heads()).toEqual(['Ledge', 'Payment Service Platform Migration Europe']);
    expect(box.getByRole('button', { name: /^Max/ })).toBeVisible();
    expect(box.queryByRole('button', { name: /^Rex/ })).toBeNull();
    expect(box.getByRole('button', { name: '+1 finished' })).toBeVisible();
    const more = box.getByRole('button', { name: '+1 project with no live agent' });
    expect(more.closest('.st-row')).toHaveClass('st-more-projects');
    // It is the tree's last row, which the arrows reach.
    const rows = [...document.querySelectorAll<HTMLElement>('.st-tree [data-tree-key]')];
    expect(rows.at(-1)).toBe(more);
    await user.click(more);
    // Released: every project, the empty one with no chevron, every session open, the ended ones counted on their project.
    expect(eye).toHaveAttribute('aria-pressed', 'false');
    expect(heads()).toEqual(['Ledge', 'Payment Service Platform Migration Europe', 'Docs']);
    expect(box.getByRole('button', { name: /^Rex/ })).toBeVisible();
    expect(box.queryByRole('button', { name: /with no live agent/ })).toBeNull();
    expect(document.querySelector('.st-tree .st-project:last-of-type .st-chev')).toBeNull();
  });

  it('a project leaves when its last live agent ends or is archived, and comes back with a live one', async () => {
    const { d, side } = await boot({ projects: PROJECTS, sessions: [PIM, ZOE] });
    const box = projectsBox(side);
    await waitFor(() => expect(heads()).toEqual(['Ledge', 'Payment Service Platform Migration Europe']));
    d.upsert({ ...ZOE, state: 'exited', exitedAt: ago(0) });
    await waitFor(() => expect(heads()).toEqual(['Ledge']));
    expect(box.getByRole('button', { name: '+2 projects with no live agent' })).toBeVisible();
    d.upsert({ ...ZOE, state: 'working' });
    await waitFor(() => expect(heads()).toEqual(['Ledge', 'Payment Service Platform Migration Europe']));
    d.upsert({ ...ZOE, archivedAt: ago(0) });
    await waitFor(() => expect(heads()).toEqual(['Ledge']));
  });

  it('nobody live: « No live agent. », whose button shows every project; H presses the eye again', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: [PIM, REX] });
    const box = projectsBox(side);
    d.upsert({ ...PIM, state: 'exited', exitedAt: ago(0) });
    const empty = await waitFor(() => { const el = box.getByRole('status'); expect(el).toHaveTextContent('No live agent.'); return el; });
    expect(empty).toHaveClass('st-empty');
    expect(empty).toHaveTextContent('No live agent.No project has an agent running. H shows every project.Show every project');
    // The header keeps its eye, pressed.
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(empty).getByRole('button', { name: 'Show every project' }));
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'false');
    expect(heads()).toEqual(['Ledge', 'Payment Service Platform Migration Europe', 'Docs']);
    // H from the box's button, or from the eye, releases it too: that state has no tree to take the key (review).
    await user.click(box.getByRole('button', { name: EYE }));
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'true');
    within(box.getByRole('status')).getByRole('button', { name: 'Show every project' }).focus();
    await user.keyboard('h');
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'false');
    box.getByRole('button', { name: EYE }).focus();
    await user.keyboard('h');
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('h');
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'false');
    // H in the tree presses it again.
    box.getByRole('button', { name: /^Ledge/ }).focus();
    await user.keyboard('h');
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'true');
    expect(box.getByRole('status')).toHaveTextContent('No live agent.');
  });

  it('projects but no session: the header whole, « Create a session », « +2 projects » under it; released, every project (design-ux, 11:42Z)', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: [] });
    const box = projectsBox(side);
    // The projects come after the snapshot: until then the tree knows none.
    const more = await box.findByRole('button', { name: '+2 projects with no live agent' });
    const empty = box.getByRole('status');
    expect(empty).toHaveTextContent('No session yet.A session runs an agent in a folder or a project.Create a session');
    const header = empty.previousElementSibling as HTMLElement;
    expect(within(header).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([EYE, 'Group by branch (B)', 'Compact mode (D)', 'Fold all', 'New project']);
    expect(more).toHaveAttribute('tabindex', '0');
    // H from the box releases the eye, as its row would.
    within(empty).getByRole('button', { name: 'Create a session' }).focus();
    await user.keyboard('h');
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'false');
    expect(heads()).toEqual(['Ledge', 'Payment Service Platform Migration Europe']);
    expect(document.querySelectorAll('.st-tree .st-project .st-chev')).toHaveLength(0);
    expect(box.queryByRole('status')).toBeNull();
    await user.click(box.getByRole('button', { name: EYE }));
    await user.click(box.getByRole('button', { name: '+2 projects with no live agent' }));
    expect(box.getByRole('button', { name: EYE })).toHaveAttribute('aria-pressed', 'false');
  });

  it('its texts in French and English', async () => {
    const { fr } = await import('../src/i18n/fr');
    const { en } = await import('../src/i18n/en');
    expect([fr.side.hideDone, fr.side.moreProjects(1), fr.side.moreProjects(3), fr.side.empty.noActive, fr.side.empty.noActiveBody, fr.side.empty.showAll]).toEqual([
      'Seulement les projets avec un agent actif (H)', '+1 projet sans agent actif', '+3 projets sans agent actif', 'Aucun agent actif.',
      'Aucun projet n’a d’agent en marche. H affiche tous les projets.', 'Afficher tous les projets'
    ]);
    expect([en.side.hideDone, en.side.moreProjects(1), en.side.moreProjects(3), en.side.empty.noActive, en.side.empty.noActiveBody, en.side.empty.showAll]).toEqual([
      'Only projects with a live agent (H)', '+1 project with no live agent', '+3 projects with no live agent', 'No live agent.',
      'No project has an agent running. H shows every project.', 'Show every project'
    ]);
  });
});
