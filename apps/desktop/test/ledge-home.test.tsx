import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatTurn, ClientMessage, Role, Task, Team } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { mentionAt } from '../src/chat/LedgeHome';

const T0 = new Date().toISOString();
const team: Team = { id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'build', sessionId: 'otto' }, { role: 'review', sessionId: 'pim' }], createdAt: T0, updatedAt: T0 };
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', team: 'team-a1b2', state: 'open', at: T0, updatedAt: T0, log: [{ at: T0, by: 'Ledge', what: 'confiée à Otto' }], ...extra });
const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const point = () => within(screen.getByRole('region', { name: 'The point' }));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openHome() {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, sessions: [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', team: 'team-a1b2', role: 'build', pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } }),
    fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'review' })
  ] });
  await screen.findByRole('region', { name: 'The point' });
  return env;
}

describe('Ledge’s home view (ledge home spec)', () => {
  it('is where the app opens: header, tabs, « The point » built from the daemon’s state, the composer and its reminder', async () => {
    const { d } = await openHome();
    expect(home().getByText(/^Operator · sees 2 sessions, 0 teams, 1 machine · read only$/)).toBeVisible();
    expect(home().getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
    // What waits for the user, answerable in place.
    const yours = within(point().getByLabelText('Yours'));
    await yours.findByText('pnpm test');
    expect(yours.getByRole('button', { name: 'Yes' })).toBeVisible();
    d.push({ type: 'teams', teams: [team] });
    d.push({ type: 'task.updated', task: task('t000001', { state: 'done', result: 'fait' }) });
    d.push({ type: 'task.updated', task: task('t000002', { state: 'taken' }) });
    // A closed task Ledge gave is an item of « Yours » until put away.
    await yours.findByText(/Otto finished “Tâche t000001”/);
    const teams = within(point().getByLabelText('Teams'));
    expect(await teams.findByText('ledge-roles')).toBeVisible();
    expect(teams.getByText('1/2')).toBeVisible();
    const given = within(point().getByLabelText('Given by Ledge'));
    expect(given.getByText('Tâche t000002')).toBeVisible();
    expect(home().getByRole('tab', { name: 'Teams · 1' })).toBeVisible();
    expect(home().getByText('read only · nothing without your click')).toBeVisible();
    expect(home().getByRole('button', { name: 'Where is ledge-roles at?' })).toBeVisible();
  });

  it('« Dismiss » puts a closed Ledge task away; « See » opens it in the Tasks tab with its history', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'teams', teams: [team] });
    d.push({ type: 'task.updated', task: task('t000001', { state: 'done', result: 'fait' }) });
    const row = await point().findByText(/Otto finished “Tâche t000001”/);
    // The sidebar's « Yours » has it too.
    expect(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByText(/Otto finished “Tâche t000001”/)).toBeVisible();
    await user.click(within(row.closest('.lp-row') as HTMLElement).getByRole('button', { name: 'See' }));
    expect(home().getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true');
    const detail = await screen.findByRole('region', { name: 'Tâche t000001' });
    expect(within(detail).getByText('fait')).toBeVisible();
    expect(within(detail).getByText(/confiée à Otto/)).toBeVisible();
    await user.click(home().getByRole('tab', { name: 'Conversation' }));
    await user.click(within((await point().findByText(/Otto finished/)).closest('.lp-row') as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'task.cmd', rid: expect.any(String), by: 'ledge', op: 'seen', task: 't000001' }));
  });

  it('a team card launches its team and keeps the outcome; its task cards wait for it, then give and follow their task', async () => {
    const { d, user } = await openHome();
    await user.type(home().getByRole('textbox', { name: 'Ask Ledge' }), 'Monte une équipe{Enter}');
    await waitFor(() => expect(d.received.some(m => m.type === 'chat.ask')).toBe(true));
    const { qid } = d.received.find((m): m is Extract<ClientMessage, { type: 'chat.ask' }> => m.type === 'chat.ask')!;
    const proposed: ChatTurn = { qid, question: 'Monte une équipe', askedAt: T0, steps: [], answer: 'Une équipe.', answeredAt: T0,
      team: { cwd: '/w/ledge', project: 'ledge', projectName: 'Ledge', name: 'ledge-roles', seats: [{ role: 'build', label: 'Build', tool: 'claude', model: 'opus', autonomy: 'edits' }, { role: 'review', label: 'Relecteur', tool: 'codex', autonomy: 'auto' }] },
      tasks: [{ to: '@build', title: 'Implémenter les rôles' }] };
    d.push({ type: 'chat.history', turns: [proposed] });
    const card = await screen.findByRole('region', { name: 'Proposed team' });
    expect(within(card).getByText('new table in the Ledge room')).toBeVisible();
    expect(within(card).getByText('@review')).toBeVisible();
    expect(within(card).getByRole('note')).toHaveTextContent('@review will work without asking');
    const tasks = screen.getByRole('region', { name: 'Task to give' });
    expect(within(tasks).getByRole('button', { name: 'Give' })).toBeDisabled();
    expect(within(tasks).getByText('active once the team is launched')).toBeVisible();
    await user.click(within(card).getByRole('button', { name: /Launch the team/ }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.launch', rid: expect.any(String), qid }));
    const rid = (d.received.find(m => m.type === 'team.launch') as { rid: string }).rid;
    d.push({ type: 'team.launched', rid, team });
    d.push({ type: 'chat.history', turns: [{ ...proposed, team: { ...proposed.team!, teamId: team.id, launchedAt: T0 } }] });
    await within(card).findByText(/Team launched at/);
    expect(within(card).getByRole('button', { name: 'Open the table' })).toBeVisible();
    await user.click(within(tasks).getByRole('button', { name: 'Give' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'task.cmd', rid: expect.any(String), by: 'ledge', op: 'give', qid, row: 0 }));
    d.push({ type: 'chat.history', turns: [{ ...proposed, team: { ...proposed.team!, teamId: team.id, launchedAt: T0 }, tasks: [{ ...proposed.tasks![0]!, taskId: 't91b0d4', ownerName: 'Otto', state: 'taken', givenAt: T0 }] }] });
    expect(await within(tasks).findByText(/Given to Otto · t91b0d4 · taken/)).toBeVisible();
  });

  it('@ and # complete a session and a team in the composer', () => {
    expect(mentionAt('ask @ot')).toEqual({ sigil: '@', query: 'ot', start: 4 });
    expect(mentionAt('#led')).toEqual({ sigil: '#', query: 'led', start: 0 });
    expect(mentionAt('mail a@b')).toBeNull();
    expect(mentionAt('done ')).toBeNull();
  });
});

// #97: the catalog of « Teams », read from a simulated `roles.listing` for the folder asked.
const REPO = '/w/ledge';
const repoRole = (id: string, extra: Partial<Role> = {}): Role => ({ id, label: id.toUpperCase(), prompt: '', source: 'repo', path: `${REPO}/.ledge/roles/${id}.md`, ...extra });
const LISTING = {
  roles: [
    repoRole('build', { label: 'Builder', tool: 'claude', model: 'opus', effort: 'high', autonomy: 'edits', prompt: '## Rôle\n\nTu implémentes **une** étape à la fois.' }),
    repoRole('qa', { label: 'QA', tool: 'claude', model: 'sonnet', autonomy: 'auto' }),
    repoRole('review', { label: 'Relecteur', tool: 'codex', model: 'gpt-5.5', autonomy: 'ask', shadows: '/h/.ledge/roles/review.md', prompt: 'Tu relis sans modifier.' }),
    { id: 'lead', label: 'Lead', prompt: 'Tu découpes.', source: 'home' as const, path: '/h/.ledge/roles/lead.md' }
  ],
  templates: [{ id: 'workshop', name: 'workshop', source: 'repo' as const, path: `${REPO}/.ledge/teams/workshop.yaml`, seats: [{ role: 'lead' }, { role: 'build' }, { role: 'review', model: 'gpt-5.5-mini' }, { role: 'qa' }] }],
  problems: [{ path: `${REPO}/.ledge/roles/Design.md`, reason: 'invalid file name' }, { path: `${REPO}/.ledge/teams/audit.yaml`, reason: 'a role twice in one team' }]
};
const HOME_ONLY = { roles: [LISTING.roles[3]!], templates: [], problems: [] };
/** Answers every `roles.list`: the repository's catalog for /w/ledge, `~/.ledge`'s alone without a folder. */
function answerRoles(d: Awaited<ReturnType<typeof boot>>['d'], listing: typeof LISTING = LISTING) {
  d.onMessage(m => { if (m.type === 'roles.list') d.push({ type: 'roles.listing', requestId: m.requestId, ...(m.cwd === REPO ? listing : HOME_ONLY) }); });
}
const lastRolesList = (d: Awaited<ReturnType<typeof boot>>['d']) => d.received.filter(m => m.type === 'roles.list').at(-1);
const tabs = () => within(home().getByRole('tablist', { name: 'Team views' }));

describe('« Teams »: the catalog of templates, roles and skipped files (#97)', () => {
  it('reads the atelier’s project by default and lists the roles by source; a role shows its defaults, autonomy, file, shadow and instructions', async () => {
    const { d, user } = await openHome();
    answerRoles(d);
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'roles.list', cwd: REPO, requestId: expect.any(String) }));
    await user.click(await tabs().findByRole('tab', { name: 'Roles · 4' }));
    expect(home().getByRole('button', { name: /Folder Ledge \/w\/ledge/ })).toBeVisible();
    const listBox = home().getByRole('group', { name: 'Roles' });
    const list = within(listBox);
    const ids = () => [...listBox.querySelectorAll('[data-role]')].map(x => x.getAttribute('data-role'));
    expect(list.getByText('Repository · .ledge/roles')).toBeVisible();
    expect(list.getByText('Personal · ~/.ledge/roles')).toBeVisible();
    expect(ids()).toEqual(['build', 'qa', 'review', 'lead']);
    expect(list.getByText(/Claude Code · opus · high · in 1 template · held by Otto/)).toBeVisible();
    // The first role is shown: its defaults, the flag its autonomy adds, its instructions in Markdown with their count.
    const build = within(home().getByRole('region', { name: '@build' }));
    expect(build.getByText('Claude Code: --permission-mode acceptEdits')).toBeVisible();
    expect(build.getByText(REPO + '/.ledge/roles/build.md')).toBeVisible();
    expect(build.getByRole('heading', { name: 'Rôle' })).toBeVisible();
    expect(build.getByText('une').tagName).toBe('STRONG');
    expect(build.getByText(`${LISTING.roles[0]!.prompt.length} / 8000`)).toBeVisible();
    expect(build.getByText('Otto')).toBeVisible();
    // The filter, then the role that hides a personal one.
    await user.type(home().getByRole('searchbox', { name: 'Filter the roles' }), 'relec');
    expect(ids()).toEqual(['review']);
    const review = within(home().getByRole('region', { name: '@review' }));
    expect(review.getByText('/h/.ledge/roles/review.md')).toBeVisible();
    expect(review.getByText(/Replaces/)).toBeVisible();
    expect(review.getByText('nothing added: the agent asks before acting')).toBeVisible();
    // Copy says it; « See the template » goes to the template.
    await user.click(review.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText(`Path copied: ${REPO}/.ledge/roles/review.md`)).toBeVisible();
    await user.click(review.getByRole('button', { name: 'See the template' }));
    expect(tabs().getByRole('tab', { name: 'Templates · 1' })).toHaveAttribute('aria-selected', 'true');
    const tpl = within(home().getByRole('region', { name: 'workshop' }));
    // What the template changes of the role's defaults, apart; the seat that works without asking.
    const row = tpl.getByRole('button', { name: '@review' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('gpt-5.5-mini')).toHaveClass('over');
    expect(within(row).getByText('Codex · gpt-5.5')).toHaveClass('def');
    expect(tpl.getByRole('note')).toHaveTextContent('@qa works without asking');
    await user.click(tpl.getByRole('button', { name: '@lead' }));
    expect(home().getByRole('region', { name: '@lead' })).toBeVisible();
  });

  it('another folder, « Personal only » included, is read again and remembered; the skipped files have their view', async () => {
    const { d, user } = await openHome();
    answerRoles(d);
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(await tabs().findByRole('tab', { name: 'Roles · 4' }));
    await user.click(home().getByRole('button', { name: /2 files not read/ }));
    const skipped = within(home().getByRole('region', { name: 'Skipped files' }));
    expect(skipped.getByText(`${REPO}/.ledge/roles/Design.md`)).toBeVisible();
    expect(skipped.getByText('a role twice in one team')).toBeVisible();
    await user.click(home().getByRole('button', { name: /^Folder/ }));
    expect([...screen.getByRole('menu', { name: 'The folder whose catalog is read' }).children].every(x => x.getAttribute('role') === 'menuitem')).toBe(true);
    // The rule the choice follows: visible at the popup's foot, outside the menu, and describing it.
    expect(screen.getByText('The repository wins over ~/.ledge for the same id.')).toBeVisible();
    expect(screen.getByRole('menu', { name: 'The folder whose catalog is read' })).not.toContainElement(screen.getByText('The repository wins over ~/.ledge for the same id.'));
    expect(screen.getByRole('menu', { name: 'The folder whose catalog is read' })).toHaveAccessibleDescription('The repository wins over ~/.ledge for the same id.');
    await user.click(screen.getByRole('menuitem', { name: /Personal only/ }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'roles.list', requestId: expect.any(String) }));
    expect(await tabs().findByRole('tab', { name: 'Roles · 1' })).toBeVisible();
    expect(home().queryByRole('button', { name: /files not read/ })).toBeNull();
    expect(home().getByRole('region', { name: '@lead' })).toBeVisible();
    // A folder without a project launches no team.
    expect(home().getByRole('button', { name: 'Set up a team…' })).toBeDisabled();
    expect(localStorage.getItem('desktop.catalog.scope')).toBe('""');
  });

  it('« Start a session » and « Launch this team… » open the existing forms filled in', async () => {
    const { d, user } = await openHome();
    answerRoles(d);
    d.onMessage(m => { if (m.type === 'team.launch') d.push({ type: 'team.launched', rid: m.rid, team: { ...team, id: 'team-e5f6', name: 'workshop' } }); });
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(await tabs().findByRole('tab', { name: 'Roles · 4' }));
    await user.click(within(home().getByRole('region', { name: '@build' })).getByRole('button', { name: 'Start a session' }));
    const form = await screen.findByRole('dialog', { name: 'New session' });
    expect(within(form).getByRole('note')).toHaveTextContent('Role@buildBuilder');
    await user.type(within(form).getByRole('textbox', { name: /instruction/i }), 'Implémente l’étape 2');
    await user.click(within(form).getByRole('button', { name: /^Launch/ }));
    await waitFor(() => expect(d.received).toContainEqual(expect.objectContaining({ type: 'session.launch', tool: 'claude', cwd: REPO, role: 'build', model: 'opus', effort: 'high' })));
    await user.keyboard('{Escape}');
    await user.click(tabs().getByRole('tab', { name: 'Templates · 1' }));
    await user.click(within(home().getByRole('region', { name: 'workshop' })).getByRole('button', { name: 'Launch this team…' }));
    const teamForm = await screen.findByRole('dialog', { name: 'New team · Ledge' });
    expect(await within(teamForm).findByRole('combobox', { name: 'Template' })).toHaveValue('workshop');
    await user.click(within(teamForm).getByRole('button', { name: 'Launch the team' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.launch', rid: expect.any(String), cwd: REPO, name: 'workshop', template: 'workshop' }));
  });

  it('« Open » shows the file beside the detail, read without a session: a role in the Markdown reader, a template as YAML', async () => {
    const { d, user } = await openHome();
    answerRoles(d);
    d.documents.set(`${REPO}/.ledge/roles/build.md`, '---\nlabel: Builder\n---\n# Builder\n\nTu **implémentes**.');
    d.documents.set(`${REPO}/.ledge/teams/workshop.yaml`, 'name: workshop\nseats:\n  - role: lead\n');
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(await tabs().findByRole('tab', { name: 'Roles · 4' }));
    await user.click(within(home().getByRole('region', { name: '@build' })).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'document.read', requestId: expect.any(String), path: `${REPO}/.ledge/roles/build.md` }));
    const reader = within(await home().findByRole('complementary', { name: 'File build.md' }));
    expect(await reader.findByRole('heading', { name: 'Builder' })).toBeVisible();
    expect(reader.getByText('implémentes').tagName).toBe('STRONG');
    await user.click(reader.getByRole('button', { name: 'Close' }));
    expect(home().queryByRole('complementary', { name: 'File build.md' })).toBeNull();
    await user.click(tabs().getByRole('tab', { name: 'Templates · 1' }));
    await user.click(within(home().getByRole('region', { name: 'workshop' })).getByRole('button', { name: 'Open' }));
    const yaml = within(await home().findByRole('complementary', { name: 'File workshop.yaml' }));
    expect((await yaml.findByText(/name: workshop/)).closest('pre')).not.toBeNull();
  });

  it('« Open » on a template, with a daemon that reads no YAML yet, says so and how to do without', async () => {
    const { d, user } = await openHome();
    answerRoles(d);
    d.documentErrors.set(`${REPO}/.ledge/teams/workshop.yaml`, 'unsupported_type');
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(await tabs().findByRole('tab', { name: 'Templates · 1' }));
    await user.click(within(home().getByRole('region', { name: 'workshop' })).getByRole('button', { name: 'Open' }));
    const reader = within(await home().findByRole('complementary', { name: 'File workshop.yaml' }));
    expect(await reader.findByText('This daemon does not read templates yet: update Ledge on this machine, or copy the path.')).toBeVisible();
  });

  it('a live team leads to its template and each @role in the catalog of its folder', async () => {
    const { d, user } = await openHome();
    answerRoles(d);
    d.push({ type: 'teams', teams: [{ ...team, template: 'workshop' }] });
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    const live = within((await home().findByText('ledge-roles')).closest('.home-team') as HTMLElement);
    await user.click(live.getByRole('button', { name: 'workshop' }));
    expect(tabs().getByRole('tab', { name: /^Templates/ })).toHaveAttribute('aria-selected', 'true');
    expect(await home().findByRole('region', { name: 'workshop' })).toBeVisible();
    // Teams born of the template.
    expect(within(home().getByRole('region', { name: 'workshop' })).getByText('ledge-roles')).toBeVisible();
    await user.click(tabs().getByRole('tab', { name: /^Live/ }));
    await user.click(within((home().getByText('ledge-roles')).closest('.home-team') as HTMLElement).getByRole('button', { name: '@review' }));
    expect(await home().findByRole('region', { name: '@review' })).toBeVisible();
  });

  it('a @role the folder does not have is said unknown, never shown as another one (Gus)', async () => {
    const { d, user } = await openHome();
    answerRoles(d);
    d.push({ type: 'teams', teams: [{ ...team, seats: [...team.seats, { role: 'ghost', sessionId: null }] }] });
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(within((await home().findByText('ledge-roles')).closest('.home-team') as HTMLElement).getByRole('button', { name: '@ghost' }));
    expect(await home().findByText('@ghost: role unknown in this folder.')).toBeVisible();
    expect(home().queryByRole('region', { name: '@build' })).toBeNull();
  });

  it('a daemon that does not answer is not an empty folder: it is said, and « Retry » reads again (Gus)', async () => {
    const { d, user } = await openHome();
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(tabs().getByRole('tab', { name: 'Roles' }));
    const alert = await home().findByRole('alert', {}, { timeout: 8000 });
    expect(alert).toHaveTextContent('The daemon did not answer: this folder’s catalog could not be read.');
    expect(home().queryByText('No role in this folder.')).toBeNull();
    answerRoles(d);
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await tabs().findByRole('tab', { name: 'Roles · 4' })).toBeVisible();
    expect(home().getByRole('region', { name: '@build' })).toBeVisible();
  }, 30_000);

  it('a role naming an effort without a model keeps its effort in the form (Gus)', async () => {
    const { d, user } = await openHome();
    answerRoles(d, { ...LISTING, roles: [repoRole('build', { label: 'Builder', tool: 'claude', effort: 'high' })] });
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(await tabs().findByRole('tab', { name: 'Roles · 1' }));
    await user.click(within(home().getByRole('region', { name: '@build' })).getByRole('button', { name: 'Start a session' }));
    const form = await screen.findByRole('dialog', { name: 'New session' });
    await user.type(within(form).getByRole('textbox', { name: /instruction/i }), 'Étape 3');
    await user.click(within(form).getByRole('button', { name: /^Launch/ }));
    await waitFor(() => expect(d.received).toContainEqual(expect.objectContaining({ type: 'session.launch', role: 'build', effort: 'high' })));
  });

  it('« Set up a team… » opens the team form on seats chosen one by one, its role ticked (Gus)', async () => {
    const { d, user } = await openHome();
    answerRoles(d);
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(await tabs().findByRole('tab', { name: 'Roles · 4' }));
    await user.click(within(home().getByRole('region', { name: '@build' })).getByRole('button', { name: 'Set up a team…' }));
    const form = await screen.findByRole('dialog', { name: 'New team · Ledge' });
    expect(await within(form).findByRole('combobox', { name: 'Template' })).toHaveValue('');
    expect(within(form).getByRole('checkbox', { name: /@build/ })).toBeChecked();
    expect(within(form).getByRole('checkbox', { name: /@qa/ })).not.toBeChecked();
  });

  it('the session open in the atelier wins over the folder remembered; the folder chosen is read again at the next opening (Gus)', async () => {
    const { d, user, side } = await openHome();
    answerRoles(d);
    // Remembered: « Personal only »; the tab reads it back once reopened.
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await user.click(await tabs().findByRole('tab', { name: 'Roles · 4' }));
    await user.click(home().getByRole('button', { name: /^Folder/ }));
    await user.click(screen.getByRole('menuitem', { name: /Personal only/ }));
    await user.click(home().getByRole('tab', { name: 'Conversation' }));
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await waitFor(() => expect(lastRolesList(d)).toEqual({ type: 'roles.list', requestId: expect.any(String) }));
    await user.click(tabs().getByRole('tab', { name: 'Roles · 1' }));
    expect(home().getByRole('button', { name: /^Folder Personal only/ })).toBeVisible();
    // Otto's page open in the atelier, then Ledge: its folder is read, not the one remembered.
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await screen.findByRole('textbox', { name: 'Reply to the agent' });
    await user.click(side.getByRole('button', { name: 'Home: Ledge, the operator' }));
    await user.click(home().getByRole('tab', { name: /^Teams/ }));
    await waitFor(() => expect(lastRolesList(d)).toEqual({ type: 'roles.list', cwd: REPO, requestId: expect.any(String) }));
  });
});
