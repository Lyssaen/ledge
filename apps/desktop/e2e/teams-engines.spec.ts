// Lot G, task 1 (spec §6.7): the two-seat team scenario end to end, once per engine, against the fake daemon. A lead (claude) and a
// reviewer (codex) get « Ajoute un README »; the team shows once in each place, its exchanges reach the thread in order, the result
// reaches « Your turn », and the tech room names the engine (never the other one's). The lead's questions: one settled by the brain leaves no card, one left
// pending leaves exactly one. Settings › Teams: OpenRig greyed when absent, no switch while a team runs.
import type { OpenRigStatus, Rig, RigSpecInfo, Role } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import type { Page } from '@playwright/test';

const ABSENT: OpenRigStatus = { machine: 'local', state: 'absent', install: 'npm i -g @openrig/cli' };
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };
const role = (id: string, label: string): Role => ({ id, label, prompt: '', source: 'repo', path: `/w/ledge/.ledge/roles/${id}.md` });
/** /w/ledge's roles, no template: the form picks its seats one by one. */
const ROLES = { '/w/ledge': { roles: [role('leader', 'Lead'), role('review', 'Review')], templates: [], problems: [] } };
const KERNEL: Rig = { id: 'r-kernel', name: 'openrig-kernel', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: true, repos: [],
  seats: [{ ref: 'operator@kernel', address: '@operator', name: 'operator', runtime: 'claude-code', state: 'working' }] };
const README_SPEC: RigSpecInfo = { id: 'readme', name: 'readme', summary: 'a lead and a reviewer', source: 'library',
  seats: [{ address: '@leader', member: 'leader', pod: 'dev', runtime: 'claude-code', model: 'opus' }, { address: '@review', member: 'review', pod: 'dev', runtime: 'codex', model: 'gpt-5.5' }] };

const home = (page: Page) => page.locator('section.ledge-home');
const yours = (page: Page) => page.locator('aside.sidebar section.st-attn');
const sideTeams = (page: Page) => page.locator('section[aria-label="Teams"]');

/** « Launch a team » of the Ledge screen's Teams tab, in Ledge mode: the team form with its objective, two seats, the lead on Claude
 *  and the reviewer on Codex. */
async function launchLedgeTeam(page: Page) {
  await home(page).getByRole('tab', { name: /^Teams/ }).click();
  await home(page).getByRole('button', { name: 'Launch a team', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New team · Ledge' });
  await form.getByRole('checkbox', { name: /@leader/ }).check();
  await form.getByRole('checkbox', { name: /@review/ }).check();
  await form.getByLabel('Agent of @review').selectOption('codex');
  await form.getByLabel('Team name').fill('readme');
  await form.getByLabel('Objective').fill('Ajoute un README');
  await form.getByRole('button', { name: 'Launch the team' }).click();
  await expect(form).toHaveCount(0);
}

/** The team once on each screen: one row of the sidebar's Teams, one office of the Bureaux (with the engine's tech room), one card
 *  of the Teams tab. Returns that card. */
async function teamOnceEverywhere(page: Page, engine: 'Ledge' | 'OpenRig') {
  await expect(sideTeams(page).getByRole('treeitem', { name: /readme/ })).toHaveCount(1);
  await page.locator('aside.sidebar').getByRole('button', { name: /^Atelier/ }).click();
  const floor = page.locator('.bureaux-floor');
  await expect(floor.locator('.bureaux-plate', { hasText: /^readme · / })).toHaveCount(1);
  await expect(floor.locator('.bureaux-plate', { hasText: /^readme · / })).toHaveText('readme · 2');
  await expect(floor.locator('.bureaux-plate', { hasText: `Teams · ${engine}` })).toHaveCount(1);
  // Never the other engine's tech room.
  await expect(floor.locator('.bureaux-plate', { hasText: `Teams · ${engine === 'Ledge' ? 'OpenRig' : 'Ledge'}` })).toHaveCount(0);
  await page.keyboard.press('/');
  await home(page).getByRole('tab', { name: 'Teams · 1' }).click();
  const card = home(page).getByRole('article', { name: 'readme' });
  await expect(card).toHaveCount(1);
  return card;
}

/** The thread of the Ledge screen: the team's exchanges in one group, in the order they happened. */
async function exchangesInOrder(page: Page, lines: RegExp[]) {
  await home(page).getByRole('tab', { name: 'Conversation' }).click();
  const group = home(page).locator('.lt-group', { hasText: 'readme' });
  await expect(group).toHaveCount(1);
  await expect(group.locator('.lt-exchange')).toHaveText(lines);
}

test('Ledge engine: a two-seat team with its objective, once on every screen, its exchanges in order, its result in « Your turn »', async ({ page }) => {
  const daemon = await fakeDaemon(page, [], { projects: twoProjects, teamsEngine: 'ledge', openrig: ABSENT, roles: ROLES });
  await page.goto('/');
  await launchLedgeTeam(page);
  expect(daemon.received.find(m => m.type === 'team.launch')).toMatchObject({ cwd: '/w/ledge', name: 'readme',
    seats: [{ role: 'leader', tool: 'claude' }, { role: 'review', tool: 'codex' }], objective: { goal: 'Ajoute un README' } });
  const card = await teamOnceEverywhere(page, 'Ledge');
  // A Ledge team's own: the field that writes to the whole team.
  await expect(card.getByRole('textbox', { name: 'Write to the whole team…' })).toBeVisible();
  // The objective's hand-over, the lead's task to @review, its done, then the lead's done to Ledge.
  await exchangesInOrder(page, [/^Ledge → Otto · task .*Ajoute un README$/, /^Otto → Pim · task .*Relis le README$/, /^Pim → Otto · task .*Relis le README — Relu, rien à redire$/, /^Otto → Ledge · task .*Ajoute un README — README ajouté et relu$/]);
  await expect(yours(page).locator('.st-task')).toHaveText([/Otto finished “Ajoute un README”.*Ledge’s task/]);
  // Nothing was asked of the user on the way.
  await expect(yours(page).locator('.st-esc, .st-decision')).toHaveCount(0);
});

test('Ledge engine: the lead’s question settled by the brain leaves no card; the one left pending leaves exactly one', async ({ page }) => {
  await fakeDaemon(page, [], { projects: twoProjects, teamsEngine: 'ledge', openrig: ABSENT, roles: ROLES,
    teamScript: { asks: [{ title: 'Quel titre pour le README ?', settled: true }, { title: 'Publier le README sur le site ?', settled: false }] } });
  await page.goto('/');
  await launchLedgeTeam(page);
  // The script asks in order, the settled question first: once the objective is done, both are known.
  await expect(yours(page).locator('.st-task')).toHaveText([/Otto finished “Ajoute un README”/]);
  const cards = yours(page).locator('.st-esc');
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('data-escalation', /^task-/);
  await expect(cards).toContainText('Publier le README sur le site ?');
  await expect(cards).toContainText('readme');
  // The decision task behind it is its mirror, not a second card; the settled one left nothing.
  await expect(yours(page).locator('.st-decision')).toHaveCount(0);
  await expect(yours(page)).not.toContainText('Quel titre pour le README ?');
});

test('OpenRig engine: the same team by plan gives the same screens, its exchanges in order, and OpenRig’s tech room', async ({ page }) => {
  const daemon = await fakeDaemon(page, [], { projects: twoProjects, teamsEngine: 'openrig', openrig: RUNNING, rigs: [KERNEL], specs: [README_SPEC] });
  await page.goto('/');
  await home(page).getByRole('tab', { name: /^Teams/ }).click();
  await home(page).getByRole('button', { name: 'Launch a team', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New team' });
  await dialog.getByLabel('Goal given to the lead').fill('Ajoute un README');
  await dialog.locator('label.chip', { hasText: /^Ledge$/ }).click();
  await dialog.getByRole('button', { name: 'Change' }).click();
  await dialog.getByRole('button', { name: /^readme/ }).click();
  await dialog.getByRole('button', { name: /^Launch the team/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(daemon.received.find(m => m.type === 'rig.prepare')).toMatchObject({ spec: 'readme', goal: 'Ajoute un README', where: { kind: 'project', projectId: 'ledge' } });
  const card = await teamOnceEverywhere(page, 'OpenRig');
  // OpenRig's words on an OpenRig rig (its spec), nothing of Ledge's own teams: no template, no field to the whole team, no
  // Ledge tech room (above), no Ledge task in « Your turn ».
  await expect(card).toContainText('spec readme');
  await expect(card).not.toContainText('template');
  await expect(card.getByRole('textbox', { name: 'Write to the whole team…' })).toHaveCount(0);
  await exchangesInOrder(page, [/^leader → @review · task .*Relis le README$/, /^review → @leader · message .*README relu$/, /^leader → @review · message .*README commité$/]);
  await expect(yours(page).locator('.st-task')).toHaveCount(0);
  // No Ledge team nor task went to the daemon.
  expect(daemon.received.some(m => m.type === 'team.launch')).toBe(false);
  expect(daemon.received.some(m => m.type === 'task.cmd' && m.op !== 'list')).toBe(false);
});

test('Settings › Teams: OpenRig greyed while it is installed nowhere', async ({ page }) => {
  await fakeDaemon(page, [], { projects: twoProjects, teamsEngine: 'ledge', openrig: ABSENT });
  await page.goto('/');
  await expect(page.locator('aside.sidebar').getByText(/\d+ active/).first()).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Teams/ }).click();
  await expect(page.getByRole('radio', { name: 'Ledge' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'OpenRig' })).toBeDisabled();
  await expect(page.getByText('OpenRig is not installed on any machine')).toBeVisible();
});

test('Settings › Teams: no switch while a Ledge team runs; asked anyway, the front shows the daemon’s refusal', async ({ page }) => {
  const daemon = await fakeDaemon(page, [], { projects: twoProjects, teamsEngine: 'ledge', openrig: RUNNING, roles: ROLES });
  await page.goto('/');
  await launchLedgeTeam(page);
  await expect(sideTeams(page).getByRole('treeitem', { name: /readme/ })).toHaveCount(1);
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Teams/ }).click();
  await expect(page.getByRole('radio', { name: 'OpenRig' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Ledge' })).toBeDisabled();
  await expect(page.getByText('A team is running: stop it to change engines')).toBeVisible();
  // A front that has not heard of the team yet (a stale `running: false`) may still ask: the daemon refuses, with its reason.
  daemon.push({ type: 'teams.engine', engine: 'ledge', openrigAvailable: true, running: false });
  await page.getByRole('radiogroup', { name: 'Team engine' }).getByText('OpenRig', { exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('une équipe Ledge tourne : mets-la au repos ou dissous-la avant de changer de moteur');
  await expect(page.getByRole('radio', { name: 'Ledge' })).toBeChecked();
  expect(daemon.received.filter(m => m.type === 'teams.engine.set')).toEqual([expect.objectContaining({ engine: 'openrig' })]);
});
