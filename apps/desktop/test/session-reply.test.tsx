import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { NOTE_MAX } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, listSessions, type MockDaemon } from './helpers';
import { MESSAGES } from '../src/i18n/messages';

// A plan that takes no note exists on no harness today: Cursor's plan is made noteless here to test that case.
vi.mock('@ledge/protocol', async importOriginal => {
  const real = await importOriginal<typeof import('@ledge/protocol')>();
  return { ...real, offers: (tool: Parameters<typeof real.offers>[0], kind: Parameters<typeof real.offers>[1], what: 'always' | 'note') => (tool === 'cursor' && kind === 'plan' && what === 'note' ? false : real.offers(tool, kind, what)) };
});

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const field = () => screen.getByRole('textbox', { name: 'Reply to the agent' });
const card = (name: string) => within(screen.getByRole('region', { name }));
const sent = (d: MockDaemon, type: string) => d.received.filter(m => m.type === type);
async function open(name: string, sessions = listSessions(), list = true) {
  const env = await boot({ sessions, list });
  await env.user.click(screen.getByRole('listitem', { name: new RegExp(`^${name},`) }));
  await waitFor(() => expect(document.querySelector('.session-reply')).not.toBeNull());
  return env;
}

describe('the pinned request and the reply', () => {
  it('the pinned permission, before the thread even loads: Y allows once, the buttons wait', async () => {
    const otto = { ...listSessions()[0]!, pending: { kind: 'permission' as const, text: 'npm test', tool: 'Bash', source: 'hook' as const } };
    const { d, user } = await open('Otto', [otto, ...listSessions().slice(1)]);
    const req = card('Approval requested');
    expect(req.getByText('Otto wants to run a command')).toBeVisible();
    expect(req.getByText('Bash')).toHaveClass('tool-tag');
    expect(req.getByText('for 12 min')).toHaveClass('pending-since');
    expect(req.getByRole('button', { name: /^Always allow in this project/ })).toBeVisible();
    await user.keyboard('y'); await user.keyboard('y');
    await waitFor(() => expect(sent(d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept', expect: { kind: 'permission', text: 'npm test', key: expect.any(String) } }]));
    expect(req.getByRole('button', { name: /^Allow/ })).toBeDisabled();
  });

  it('typing in the reply: y, n, 1, r, o, j and k are text; Escape leaves the field, not the page; Enter denies with the note', async () => {
    const { d, user } = await open('Otto');
    await user.click(field());
    await user.keyboard('yn1rojk');
    expect(field()).toHaveValue('yn1rojk');
    expect(sent(d, 'session.decide')).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(field()).not.toHaveFocus();
    expect(document.querySelector('.session-page')).not.toBeNull();
    await user.clear(field()); await user.type(field(), 'Use pnpm');
    expect(screen.getByText('Enter denies with this message')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deny with this message' })).toBeEnabled();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sent(d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'deny', note: 'Use pnpm', expect: { kind: 'permission', text: 'npm test', key: expect.any(String) } }]));
    expect(field()).toHaveValue('');
  });

  it('a refusal while the machine drops is said, the buttons come back', async () => {
    const { d, user } = await open('Otto');
    await user.keyboard('n');
    await waitFor(() => expect(sent(d, 'session.decide')).toHaveLength(1));
    d.push({ type: 'error', id: 'otto', message: 'the terminal did not take it', request: 'session.decide' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not send the decision to Otto: Local: the terminal did not take it'));
    expect(card('Approval requested').getByRole('button', { name: /^Allow/ })).toBeEnabled();
  });

  it('a held key decides nothing: Y, N and 1…9 repeated by the keyboard are ignored, the first press counts', async () => {
    const { d } = await open('Otto');
    fireEvent.keyDown(document.body, { key: 'y', repeat: true });
    fireEvent.keyDown(document.body, { key: 'n', repeat: true });
    await new Promise(r => setTimeout(r, 100));
    expect(sent(d, 'session.decide')).toEqual([]);
    expect(card('Approval requested').getByRole('button', { name: /^Allow/ })).toBeEnabled();
    fireEvent.keyDown(document.body, { key: 'y' });
    await waitFor(() => expect(sent(d, 'session.decide')).toHaveLength(1));
    cleanup(); await closeDaemons();
    const kit = { ...listSessions()[4]!, pending: { kind: 'question' as const, text: 'Quel port ?', options: ['8080', '3000'], source: 'hook' as const } };
    const env = await open('Kit', [...listSessions().slice(0, 4), kit]);
    fireEvent.keyDown(document.body, { key: '1', repeat: true });
    await new Promise(r => setTimeout(r, 100));
    expect(sent(env.d, 'session.reply')).toEqual([]);
  });

  it('a question: numbered choices answer with their digit, R writes freely', async () => {
    const kit = { ...listSessions()[4]!, pending: { kind: 'question' as const, text: 'Quel port ?', options: ['8080', '3000'], optionDetails: ['Par défaut', ''], source: 'hook' as const } };
    const { d, user } = await open('Kit', [...listSessions().slice(0, 4), kit]);
    const q = card('Question from the agent');
    expect(q.getByText('Kit asks you a question')).toBeVisible();
    expect(q.getByRole('button', { name: /^1\s*8080\s*Par défaut/ })).toBeVisible();
    await user.keyboard('2');
    await waitFor(() => expect(sent(d, 'session.reply')).toEqual([{ type: 'session.reply', id: 'kit', text: '2' }]));
    d.upsert({ ...kit, state: 'working', pending: undefined, lastActivityAt: new Date().toISOString() });
    await user.keyboard('r'); expect(field()).toHaveFocus();
    await user.keyboard('Port 9000{Enter}');
    await waitFor(() => expect(sent(d, 'session.reply')).toHaveLength(2));
    expect(sent(d, 'session.reply')[1]).toEqual({ type: 'session.reply', id: 'kit', text: 'Port 9000' });
  });

  it('a refused reply gives its text back', async () => {
    const { d, user } = await open('Nova');
    await user.type(field(), 'Continue{Enter}');
    await waitFor(() => expect(sent(d, 'session.reply')).toHaveLength(1));
    d.push({ type: 'error', id: 'nova', message: 'the terminal did not take it', request: 'session.reply' });
    await waitFor(() => expect(field()).toHaveValue('Continue'));
    expect(screen.getByRole('status')).toHaveTextContent('Could not send the reply to Nova: Local: the terminal did not take it');
  });

  it('a plan: N asks for what to revise, a note sends it back; « always » only where the harness offers it', async () => {
    const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan: add README.md', body: '# Plan: add README.md\n\n1. Écrire', source: 'hook' } });
    const { d, user } = await open('Pia', [...listSessions(), pia]);
    const plan = card('Plan to approve');
    expect(plan.getByText('Pia proposes a plan · Plan: add README.md')).toBeVisible();
    expect(plan.getByRole('button', { name: 'Approve in auto mode' })).toBeVisible();
    await user.keyboard('n');
    expect(field()).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Write what to revise, then Enter: the plan goes back to planning.');
    await user.keyboard('Garde la v1{Enter}');
    await waitFor(() => expect(sent(d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'pia', decision: 'deny', note: 'Garde la v1', expect: { kind: 'plan', text: '# Plan: add README.md', key: expect.any(String) } }]));
    cleanup(); await closeDaemons();
    await open('Pia', [...listSessions(), { ...pia, tool: 'codex' }]);
    expect(card('Plan to approve').queryByRole('button', { name: 'Approve in auto mode' })).toBeNull();
  });

  it('offline: no request, no field, the machine is named; read-only says so', async () => {
    await open('Rio');
    expect(screen.queryByRole('textbox', { name: 'Reply to the agent' })).toBeNull();
    expect(screen.getByText('Local is offline.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'See the machine' })).toBeVisible();
    cleanup(); await closeDaemons();
    await open('Nova', listSessions().map(s => (s.name === 'Nova' ? { ...s, source: 'hook_only' as const } : s)));
    expect(screen.getByText('Session started without Ledge: read only.')).toBeVisible();
  });

  it("a subagent's page: its request shows who passes it on; replies go through the parent", async () => {
    const otto = { ...listSessions()[0]!, pending: { kind: 'permission' as const, text: 'cat a', source: 'hook' as const, helperId: 'h1' } };
    const { user } = await open('Otto', [otto, ...listSessions().slice(1)]);
    expect(card('Approval requested').getByText('Explore wants your approval')).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(within(screen.getByRole('listitem', { name: /^Otto,/ })).getByRole('button', { name: 'Show 1 subagent' }));
    await user.click(screen.getByRole('listitem', { name: /subagent of Otto/ }));
    expect(card('Approval requested').getByText('Otto passes this decision on.')).toBeVisible();
    expect(card('Approval requested').queryByRole('button', { name: /^Allow/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open Otto' }));
    expect(screen.getByRole('textbox', { name: 'Reply to the agent' })).toBeVisible();
  });

  it('a draft stays with its session from agent to agent', async () => {
    const { user } = await open('Otto');
    await user.type(field(), 'à moitié');
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');                                  // Bix
    expect(field()).toHaveValue('');
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');                                 // back to Otto
    expect(field()).toHaveValue('à moitié');
  });

  it('Reply from the List lands in the reply field', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.click(within(screen.getByRole('listitem', { name: /^Kit,/ })).getByRole('button', { name: 'Reply' }));
    expect(await screen.findByRole('textbox', { name: 'Reply to the agent' })).toHaveFocus();
  });
});

describe('the reply, beyond the brief (carried items)', () => {
  it('« always » says its real scope where it is wider than the session', async () => {
    const withPending = (pending: NonNullable<ReturnType<typeof listSessions>[0]['pending']>, tool: 'claude' | 'codex' = 'claude') =>
      [{ ...listSessions()[0]!, tool, pending }, ...listSessions().slice(1)];
    await open('Otto', withPending({ kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' }));
    expect(screen.getByRole('button', { name: /^Always allow in this project/ })).toHaveAttribute('title', expect.stringMatching(/project/));
    cleanup(); await closeDaemons();
    await open('Otto', withPending({ kind: 'permission', text: 'src/a.ts', tool: 'Write', source: 'hook' }));
    expect(screen.getByRole('button', { name: /^Always allow for this session/ })).toHaveAttribute('title', expect.stringMatching(/every edit/));
    cleanup(); await closeDaemons();
    await open('Otto', withPending({ kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' }, 'codex'));
    expect(screen.getByRole('button', { name: /^Always allow for this session/ })).toHaveAttribute('title', expect.stringMatching(/rest of the session/));
    cleanup(); await closeDaemons();
    await open('Otto', withPending({ kind: 'plan', text: 'Plan: x', source: 'hook' }));
    // Never promise less than granted: the label says auto mode (Claude 2.1), the title what older versions do instead.
    const auto = screen.getByRole('button', { name: 'Approve in auto mode' });
    expect(auto).toHaveAttribute('title', expect.stringMatching(/auto mode, which answers the next requests by itself, commands included/));
    expect(auto).toHaveAttribute('title', expect.stringMatching(/versions without auto mode.*accept.*edits automatically/i));
    expect([MESSAGES.fr.session.pending.approveAuto, MESSAGES.fr.session.pending.alwaysScope.plan]).toEqual(
      ['Approuver en mode automatique', expect.stringMatching(/mode auto.*sans mode auto.*accepte les modifications automatiquement/)]);
  });

  it('Claude saves a non-edit rule for the project: the label says so; its file tools keep « for this session »', async () => {
    const withPending = (pending: NonNullable<ReturnType<typeof listSessions>[0]['pending']>) => [{ ...listSessions()[0]!, pending }, ...listSessions().slice(1)];
    await open('Otto', withPending({ kind: 'permission', text: 'https://example.com', tool: 'WebFetch', source: 'hook' }));
    expect(card('Approval requested').getByRole('button', { name: 'Always allow in this project' })).toBeVisible();
    expect(card('Approval requested').queryByRole('button', { name: /for this session/ })).toBeNull();
    cleanup(); await closeDaemons();
    await open('Otto', withPending({ kind: 'permission', text: 'src/a.ts', tool: 'Write', source: 'hook' }));
    expect(card('Approval requested').getByRole('button', { name: 'Always allow for this session' })).toBeVisible();
    cleanup(); await closeDaemons();
    await open('Otto', withPending({ kind: 'diff', text: 'src/a.ts', source: 'hook' }));
    expect(card('Approval requested').getByRole('button', { name: 'Always allow for this session' })).toBeVisible();
  });

  it('a plan whose harness takes no note: N and « Keep planning » deny it plainly', async () => {
    const pia = fakeSession('pia', { name: 'Pia', tool: 'cursor', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan: x', source: 'hook' } });
    const { d, user } = await open('Pia', [...listSessions(), pia]);
    expect(field()).toBeDisabled();
    await user.keyboard('n');
    await waitFor(() => expect(sent(d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'pia', decision: 'deny', expect: { kind: 'plan', text: '# Plan: x', key: expect.any(String) } }]));
    expect(screen.getByRole('status')).not.toHaveTextContent('Write what to revise');
    cleanup(); await closeDaemons();
    const env = await open('Pia', [...listSessions(), pia]);
    await env.user.click(card('Plan to approve').getByRole('button', { name: /^Keep planning/ }));
    await waitFor(() => expect(sent(env.d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'pia', decision: 'deny', expect: { kind: 'plan', text: '# Plan: x', key: expect.any(String) } }]));
  });

  it('a reply that seems to land at once (a working session moves) still gives its text back when refused', async () => {
    const { d, user } = await open('Nova');
    await user.type(field(), 'Continue{Enter}');
    await waitFor(() => expect(sent(d, 'session.reply')).toHaveLength(1));
    const nova = listSessions()[3]!;
    d.upsert({ ...nova, state: 'error', lastActivityAt: new Date().toISOString() });            // InjectFailed comes before the error
    await waitFor(() => expect(document.querySelector('.session-page')).not.toBeNull());
    d.push({ type: 'error', id: 'nova', message: 'the terminal did not take it', request: 'session.reply' });
    await waitFor(() => expect(field()).toHaveValue('Continue'));
    expect(screen.getByRole('status')).toHaveTextContent('Could not send the reply to Nova: Local: the terminal did not take it');
  });

  it('a refused note comes back to an empty field', async () => {
    const { d, user } = await open('Otto');
    await user.type(field(), 'Use pnpm{Enter}');
    await waitFor(() => expect(sent(d, 'session.decide')).toHaveLength(1));
    expect(field()).toHaveValue('');
    d.push({ type: 'error', id: 'otto', message: 'no prompt visible in the terminal, open the tab', request: 'session.decide' });
    await waitFor(() => expect(field()).toHaveValue('Use pnpm'));
  });

  it('a note is capped at NOTE_MAX; a longer draft cannot be sent as a refusal', async () => {
    const long = 'x'.repeat(NOTE_MAX + 1);
    await open('Otto');
    expect(field()).toHaveAttribute('maxlength', String(NOTE_MAX));
    cleanup(); await closeDaemons();
    // A draft written before the request came is longer than a note may be.
    const env = await open('Nova');
    await env.user.click(field());
    await env.user.paste(long);
    env.d.upsert({ ...listSessions()[3]!, state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Approval requested' })).toBeVisible());
    expect(screen.getByText(`A note holds ${NOTE_MAX} characters at most.`)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deny with this message' })).toBeDisabled();
    await env.user.keyboard('{Enter}');
    expect(sent(env.d, 'session.decide')).toEqual([]);
    expect(field()).toHaveValue(long);
  });

  it('options only: a harness without free answers keeps the field shut while its question waits', async () => {
    const kit = { ...listSessions()[4]!, tool: 'codex' as const, pending: { kind: 'question' as const, text: 'Quel port ?', options: ['8080', '3000'], source: 'hook' as const } };
    await open('Kit', [...listSessions().slice(0, 4), kit]);
    expect(field()).toBeDisabled();
    expect(screen.getByText('Choose one of the proposed answers (1–9).')).toHaveClass('reply-hint');
  });

  it('a refusal the harness takes without a note: N still works, the field says why it is shut', async () => {
    const otto = { ...listSessions()[0]!, tool: 'cursor' as const, pending: { kind: 'diff' as const, text: 'src/a.ts', source: 'hook' as const } };
    const { d, user } = await open('Otto', [otto, ...listSessions().slice(1)]);
    expect(card('Approval requested').getByText('Otto wants to change a file')).toBeVisible();
    expect(card('Approval requested').queryByRole('button', { name: /^Always allow/ })).toBeNull();
    expect(field()).toBeDisabled();
    expect(screen.getByText('This agent takes no message with a refusal: deny with N.')).toHaveClass('reply-hint');
    await user.keyboard('n');
    await waitFor(() => expect(sent(d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'deny', expect: { kind: 'diff', text: 'src/a.ts', key: expect.any(String) } }]));
  });

  it("keys do nothing on a subagent's page; its parent's own request is not shown there", async () => {
    const otto = { ...listSessions()[0]!, pending: { kind: 'permission' as const, text: 'cat a', source: 'hook' as const, helperId: 'h1' } };
    const { d, user } = await open('Otto', [otto, ...listSessions().slice(1)]);
    await user.keyboard('{Escape}');
    await user.click(within(screen.getByRole('listitem', { name: /^Otto,/ })).getByRole('button', { name: 'Show 1 subagent' }));
    await user.click(screen.getByRole('listitem', { name: /subagent of Otto/ }));
    await waitFor(() => expect(document.querySelector('.session-page[data-helper=h1]')).not.toBeNull());
    await user.keyboard('yr');
    expect(sent(d, 'session.decide')).toEqual([]);
    // A request of the parent itself is not shown on the subagent's page.
    d.upsert({ ...otto, pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Approval requested' })).toBeNull());
  });
});
