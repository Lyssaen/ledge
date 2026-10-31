import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { Escalation, LedgeDecision, LedgeRule } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';
import { fr } from '../src/i18n/fr';

const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const tab = () => within(home().getByRole('tabpanel', { name: 'Mandate' }));
const sent = (d: MockDaemon, type: string) => d.received.filter(m => m.type === type);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const MANDATE = `# Le mandat de Ledge

## Ledge tranche seul
- git : git et branches
- tests : tests et relectures
- context : contexte et relèves
- code : petits choix de code

## Te revient toujours
- design : design (UI, copie)
- architecture : architecture (stockage, API)
- critical : critique (données, sécurité, suppression, coûts)
`;
const GIT_UP = MANDATE.replace('- git : git et branches\n', '').replace('- design :', '- git : git et branches\n- design :');

const dec = (id: string, o: Partial<LedgeDecision> = {}): LedgeDecision => ({ id, escalationId: `e-${id}`, by: 'ledge', category: 'git', summary: `summary ${id}`, answers: {}, at: ago(30), ...o });
const RULES: LedgeRule[] = [
  { id: 'r1', text: 'Merge, jamais de rebase sur une branche partagée', category: 'git', since: '2026-10-26', from: 'd9', appliedCount: 4, status: 'active' },
  { id: 'r2', text: 'Fusion sur main seulement après la relecture d’un second agent', category: 'git', since: '2026-10-30', from: 'd2,d3', appliedCount: 0, status: 'proposed' },
  { id: 'r3', text: 'Tests ciblés d’abord', category: 'tests', since: '2026-10-20', from: '', appliedCount: 1, status: 'active' }
];
const DECISIONS: LedgeDecision[] = [
  dec('d1', { summary: 'merge, pas de rebase', from: 'build@factory', rigId: 'rf', rule: 'r1' }),
  dec('d2', { by: 'user', summary: 'relecture avant fusion', from: 'orch-lead@factory', rigId: 'rf', at: ago(60) }),
  dec('d3', { by: 'user', category: 'tests', summary: 'tests ciblés', from: 'dev-build@starter', rigId: 'rs', at: ago(90) }),
  dec('d9', { summary: 'force-push refusé', from: 'build@factory', rigId: 'rf', at: ago(60 * 24 * 10) })
];
const PENDING: Escalation = { id: 'qi-1', source: 'rig', machine: 'local', rigId: 'rf', from: 'lead@factory', intent: 'decision', summary: 'JSON ou SQLite ?',
  questions: [], createdAt: ago(4), state: 'pending', category: 'architecture' };

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openMandate(text = MANDATE) {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, sessions: [] });
  await home().findByRole('tab', { name: 'Conversation' });
  env.d.push({ type: 'mandate', text, path: '/home/paradow/.ledge/mandat.md' });
  env.d.push({ type: 'rules', items: RULES });
  env.d.push({ type: 'decisions', items: DECISIONS });
  env.d.push({ type: 'escalation.updated', escalation: PENDING });
  await env.user.click(home().getByRole('tab', { name: 'Mandate' }));
  await tab().findByRole('listbox', { name: 'LEDGE SETTLES ALONE' });
  return env;
}
const selfList = () => within(tab().getByRole('listbox', { name: 'LEDGE SETTLES ALONE' }));
const userList = () => within(tab().getByRole('listbox', { name: 'ALWAYS COMES BACK TO YOU' }));
const detail = () => within(tab().getByRole('region', { name: /^Category / }));

describe('the Mandat tab (lot 7)', () => {
  it('the sub-bar: « What Ledge settles », « Memories · n » and where the mandate is read', async () => {
    await openMandate();
    const sub = within(tab().getByRole('tablist', { name: 'Mandate views' }));
    expect(sub.getByRole('tab', { name: 'What Ledge settles' })).toHaveAttribute('aria-selected', 'true');
    expect(sub.getByRole('tab', { name: 'Memories · 3' })).toBeVisible();
    expect(tab().getByText('~/.ledge/mandat.md', { selector: '.md-read code' })).toBeVisible();
  });

  it('the left column follows the mandate file, with tags, week counts and pending', async () => {
    await openMandate();
    const self = selfList().getAllByRole('option');
    expect(self.map(o => o.querySelector('strong')?.textContent)).toEqual(['Git and branches', 'Tests and reviews', 'Context and handovers', 'Small code choices']);
    expect(self[0]).toHaveAttribute('aria-selected', 'true');
    expect(self[0]).toHaveTextContent('merge');
    expect(self[0]).toHaveTextContent('2 this week');
    expect(self[1]).toHaveTextContent(/^Tests and reviews1/);
    const mine = userList().getAllByRole('option');
    expect(mine.map(o => o.querySelector('strong')?.textContent)).toEqual(['Design', 'Architecture', 'Critical']);
    expect(mine[1]).toHaveTextContent('1 pending');
    expect(mine[0]).toHaveTextContent('—');
  });

  it('a mandate where git was escalated lists git under « always yours »', async () => {
    await openMandate(GIT_UP);
    expect(selfList().queryByRole('option', { name: /Git and branches/ })).toBeNull();
    expect(userList().getByRole('option', { name: /Git and branches/ })).toBeVisible();
    expect(selfList().getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(selfList().getAllByRole('option')[0]).toHaveTextContent('Tests and reviews');
  });

  it('« Escalate it to me from now on » sends category.escalate and is absent for design', async () => {
    const { d, user } = await openMandate();
    expect(detail().getByText('Ledge settles alone · 2 decisions this week ·', { exact: false })).toBeVisible();
    await user.click(detail().getByRole('button', { name: 'Escalate it to me from now on' }));
    await waitFor(() => expect(sent(d, 'category.escalate')).toEqual([{ type: 'category.escalate', rid: expect.any(String), category: 'git' }]));
    await user.click(userList().getByRole('option', { name: /Design/ }));
    expect(detail().getByRole('heading', { name: 'Design' })).toBeVisible();
    expect(detail().queryByRole('button', { name: 'Escalate it to me from now on' })).toBeNull();
  });

  it('after « Escalate it to me from now on » the detail stays on the category, now under « always yours »', async () => {
    const { d, user } = await openMandate();
    await user.click(detail().getByRole('button', { name: 'Escalate it to me from now on' }));
    d.push({ type: 'mandate', text: GIT_UP, path: '/home/paradow/.ledge/mandat.md' });
    await waitFor(() => expect(userList().getByRole('option', { name: /Git and branches/ })).toHaveAttribute('aria-selected', 'true'));
    expect(detail().getByRole('heading', { name: 'Git and branches' })).toBeVisible();
    expect(detail().queryByRole('button', { name: 'Escalate it to me from now on' })).toBeNull();
  });

  it('the rules table: since, where it comes from, applied; a proposed rule is blue with « to approve », approving sends rule.set active', async () => {
    const { d, user } = await openMandate();
    const table = within(detail().getByRole('table', { name: 'Rules kept' }));
    expect(table.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Rule', 'Since', 'Where it comes from', 'Applied']);
    const [active, proposed] = table.getAllByRole('row').slice(1);
    expect(active).toHaveTextContent('26/10');
    expect(active).toHaveTextContent('force-push refusé');
    expect(active).toHaveTextContent('4 times');
    expect(proposed).toHaveClass('proposed');
    expect(proposed).toHaveTextContent('proposed');
    expect(proposed).toHaveTextContent('you settled the same way twice');
    expect(detail().getByText(/a rule Ledge proposes/).closest('p')).toHaveTextContent('blue: a rule Ledge proposes; it only applies once approved.');
    await user.click(within(proposed!).getByRole('button', { name: 'to approve' }));
    await user.click(screen.getByRole('menuitem', { name: 'Approve' }));
    await waitFor(() => expect(sent(d, 'rule.set')).toEqual([{ type: 'rule.set', rid: expect.any(String), id: 'r2', status: 'active' }]));
    await user.click(within(proposed!).getByRole('button', { name: 'to approve' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reject' }));
    await waitFor(() => expect(sent(d, 'rule.set')[1]).toEqual({ type: 'rule.set', rid: expect.any(String), id: 'r2', status: 'rejected' }));
  });

  it('« Revisit » on a last decision sends decision.revisit; the line names seat@rig and the rule’s day', async () => {
    const { d, user } = await openMandate();
    const list = within(detail().getByRole('list', { name: 'Last decisions' }));
    const rows = list.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('build@factory');
    expect(rows[0]).toHaveTextContent('merge, pas de rebase');
    expect(rows[0]).toHaveTextContent('rule from 26/10');
    await user.click(within(rows[0]!).getByRole('button', { name: 'Revisit' }));
    await waitFor(() => expect(sent(d, 'decision.revisit')).toEqual([{ type: 'decision.revisit', rid: expect.any(String), id: 'd1' }]));
  });

  it('the paths box: « Open » edits the mandate in place and saves through mandate.update; a warning in the result shows', async () => {
    const { d, user } = await openMandate();
    const box = within(detail().getByRole('group', { name: 'Files' }));
    expect(box.getByText('~/.ledge/memoire/')).toBeVisible();
    expect(box.getByText('3 rules, 4 decisions')).toBeVisible();
    await user.click(box.getByRole('button', { name: 'Open' }));
    const dialog = within(screen.getByRole('dialog', { name: 'The mandate' }));
    const area = dialog.getByRole('textbox', { name: 'The mandate' }) as HTMLTextAreaElement;
    expect(area.value).toBe(MANDATE);
    await user.clear(area);
    await user.type(area, 'n’importe quoi');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent(d, 'mandate.update')).toHaveLength(1));
    const m = sent(d, 'mandate.update')[0] as { rid: string; text: string };
    expect(m.text).toBe('n’importe quoi');
    d.push({ type: 'rig.result', rid: m.rid, ok: true, reason: 'le mandat illisible fait tout remonter à toi' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'The mandate' })).toBeNull());
    expect(tab().getByRole('status')).toHaveTextContent('le mandat illisible fait tout remonter à toi');
  });

  it('a refused save keeps the editor open with the reason', async () => {
    const { d, user } = await openMandate();
    await user.click(within(detail().getByRole('group', { name: 'Files' })).getByRole('button', { name: 'Open' }));
    const dialog = within(screen.getByRole('dialog', { name: 'The mandate' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent(d, 'mandate.update')).toHaveLength(1));
    d.push({ type: 'rig.result', rid: (sent(d, 'mandate.update')[0] as { rid: string }).rid, ok: false, code: 'failed', reason: 'disque plein' });
    expect(await dialog.findByRole('alert')).toHaveTextContent('Not saved: disque plein');
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'The mandate' })).toBeNull();
  });

  it('Memories lists every rule and filters the decisions by who, category and rig, each with « Revisit »', async () => {
    const { d, user } = await openMandate();
    await user.click(tab().getByRole('tab', { name: 'Memories · 3' }));
    const mem = within(tab().getByRole('region', { name: 'Memories' }));
    expect(within(mem.getByRole('table', { name: 'Rules kept' })).getAllByRole('row')).toHaveLength(4);
    const lines = () => within(mem.getByRole('list', { name: 'Decisions' })).queryAllByRole('listitem');
    expect(lines()).toHaveLength(4);
    await user.selectOptions(mem.getByRole('combobox', { name: 'Who' }), 'user');
    expect(lines().map(l => l.textContent)).toEqual([expect.stringContaining('relecture avant fusion'), expect.stringContaining('tests ciblés')]);
    await user.selectOptions(mem.getByRole('combobox', { name: 'Category' }), 'tests');
    expect(lines()).toHaveLength(1);
    await user.selectOptions(mem.getByRole('combobox', { name: 'Rig' }), 'rf');
    expect(lines()).toHaveLength(0);
    await user.selectOptions(mem.getByRole('combobox', { name: 'Category' }), '');
    expect(lines()).toHaveLength(1);
    await user.click(within(lines()[0]!).getByRole('button', { name: 'Revisit' }));
    await waitFor(() => expect(sent(d, 'decision.revisit')).toEqual([{ type: 'decision.revisit', rid: expect.any(String), id: 'd2' }]));
  });

  it('the Mandat tab never turns the brain on', async () => {
    const { d, user } = await openMandate();
    await user.click(detail().getByRole('button', { name: 'Escalate it to me from now on' }));
    await user.click(tab().getByRole('tab', { name: 'Memories · 3' }));
    expect(sent(d, 'brain.set')).toEqual([]);
  });

  it('the French labels are the plan’s, word for word', () => {
    const m = fr.mandate;
    expect([m.settles, m.memories(12), m.readIn]).toEqual(['Ce que Ledge tranche', 'Souvenirs · 12', 'Mandat lu dans']);
    expect([m.selfTitle, m.userTitle, m.rules, m.last]).toEqual(['LEDGE TRANCHE SEUL', 'TE REVIENT TOUJOURS', 'Règles retenues', 'Dernières décisions']);
    expect([m.cols.rule, m.cols.since, m.cols.from, m.cols.applied]).toEqual(['Règle', 'Depuis', "D'où elle vient", 'Appliquée']);
    expect([m.escalate, m.toApprove, m.revisit, m.open]).toEqual(['Me le remonter désormais', 'à valider', 'Revenir dessus', 'Ouvrir']);
    expect(m.blueWord + m.blueRest).toBe('bleu : une règle que Ledge propose ; elle ne s\'applique qu\'une fois validée.');
    expect(m.footnote).toBe('Ledge propose une règle quand tu tranches deux fois pareil. Le design, l\'architecture et le critique ne passent jamais dans « Ledge tranche seul ».');
    expect([m.week(6, true), m.week(9, false), m.pending(1), m.none]).toEqual(['6 cette semaine', '9', '1 en attente', '—']);
    expect(m.selfLine(6)).toBe('Ledge tranche seul · 6 décisions cette semaine ·');
    expect([m.since(null), m.applied(4), m.ruleOf('2026-10-26'), m.yesterday]).toEqual(['proposée', '4 fois', 'règle du 26/10', 'hier']);
    expect([m.files.mandate, m.files.memory, m.files.count(12, 31)]).toEqual(['Mandat', 'Souvenirs', '12 règles, 31 décisions']);
    expect([m.source.twice, m.source.order, m.source.answerTo('orch-lead')]).toEqual(['tu as tranché deux fois pareil', 'ta consigne', 'ta réponse à orch-lead']);
  });
});
