import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ActionCard, actionRowOf, type ActionCardProps, type ActionRowView } from '../src/chat/ActionCard';
import { ACTIONS, ACTION_ERROR_CODES, type ChatAction } from '@ledge/protocol';
import { actionCopy as shipped } from '../src/chat/actionCopy';
import { actionWords } from '../src/chat/actionWords';
import { ChatCopyProvider } from '../src/chat/copy';
import { actionCopy, copy } from './chat-copy-fixture';

const AT = '2026-10-26T09:42:00.000Z';
const at = new Date(AT).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

// The mockup's cases (docs/mockups/ledge-action-card.html): a plan of three, one reversible row, a permission.
const model: ActionRowView = { summary: 'Switch **Nova** to Opus 5.5', risk: 'reversible', action: 'session.model' };
const archive: ActionRowView = { summary: 'Archive **Otto**', risk: 'reversible', action: 'session.archive' };
const dissolve: ActionRowView = { summary: 'Dissolve the team **ledge-roles**', risk: 'destructive', action: 'team.dissolve', detail: 'Its 6 sessions go back to the common table.' };
const permission: ActionRowView = {
  summary: 'Accept **Nova**\'s request', risk: 'destructive', action: 'session.decide', target: 'Nova',
  request: { kind: 'Bash · rebuild the daemon', text: 'rm -rf packages/ledge/dist' }, deny: { summary: 'Deny **Nova**\'s request' }
};
const plan = (states: Array<Partial<ActionRowView>> = []) => [model, archive, dissolve].map((r, i) => ({ ...r, ...states[i] }));

function card(rows: ActionRowView[], extra: Partial<ActionCardProps> = {}) {
  const p = { onApply: vi.fn(), onDeny: vi.fn(), onIgnore: vi.fn(), onReview: vi.fn(), onOpen: vi.fn() };
  const ui = render(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={rows} {...p} {...extra} /></ChatCopyProvider>);
  return { ...p, ...ui };
}
const rowsOf = () => [...document.querySelectorAll<HTMLElement>('[data-action-row]')];
const nodes = () => [...document.querySelectorAll<HTMLElement>('[data-action-node]')].map(n => n.getAttribute('aria-label'));

describe('the action card (#94): a plan', () => {
  it('proposed: a numbered rail, a verb per row, the risk in words, « … » where a confirmation follows, Ignore in the foot', () => {
    card(plan());
    expect(screen.getByRole('region', { name: 'Plan of 3 actions' })).toBeTruthy();
    expect(nodes()).toEqual(['Step 1', 'Step 2', 'Step 3']);
    expect(rowsOf().map(r => r.getAttribute('data-action-row'))).toEqual(['proposed', 'proposed', 'proposed']);
    expect(within(rowsOf()[0]!).getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(within(rowsOf()[1]!).getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(within(rowsOf()[2]!).getByRole('button', { name: 'Dissolve…' })).toBeTruthy();
    expect(rowsOf()[0]).toHaveTextContent('Reversible');
    expect(rowsOf()[2]).toHaveTextContent('Irreversible');
    expect(rowsOf()[2]).toHaveTextContent('I will ask again');
    expect(rowsOf()[2]!.hasAttribute('data-destructive')).toBe(true);
    expect(rowsOf()[0]!.querySelector('strong')?.textContent).toBe('Nova');
    expect(screen.getByRole('button', { name: 'Apply all (3)…' })).toBeTruthy();
    expect(document.body).toHaveTextContent('in order, stops at the first failure · 1 irreversible, I will ask again');
    expect(screen.getAllByRole('button', { name: 'Ignore' })).toHaveLength(1);
  });

  it('a reversible row applies at once; Ignore says so', () => {
    const p = card(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(p.onApply).toHaveBeenCalledWith([0], { confirmed: false });
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    expect(p.onIgnore).toHaveBeenCalledOnce();
  });

  it('confirmation in the card: the rows lose their buttons, details unfold, focus on Cancel, esc cancels, the foot applies all', () => {
    const p = card(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (3)…' }));
    const confirm = screen.getByRole('group', { name: /^Confirmation/ });
    expect(confirm).toHaveTextContent('Apply these 3 actions, in order?');
    expect(confirm).toHaveTextContent('1 irreversible: read the detail above.');
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('[data-action-card]')!.hasAttribute('data-confirming')).toBe(true);
    for (const r of rowsOf()) expect(within(r).queryByRole('button')).toBeNull();
    expect(rowsOf()[2]!.querySelector('[data-action-detail]')!.hasAttribute('data-clamped')).toBe(false);
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: /^Confirmation/ })).toBeNull();
    expect(p.onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (3)…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply the 3' }));
    expect(p.onApply).toHaveBeenCalledWith([0, 1, 2], { confirmed: true });
    expect(screen.queryByRole('group', { name: /^Confirmation/ })).toBeNull();
  });

  it('esc or Cancel: the focus goes back to the button that asked, not to the page', () => {
    card(plan());
    fireEvent.click(within(rowsOf()[2]!).getByRole('button', { name: 'Dissolve…' }));
    fireEvent.keyDown(screen.getByRole('group', { name: /^Confirmation/ }), { key: 'Escape' });
    expect(document.activeElement).toBe(within(rowsOf()[2]!).getByRole('button', { name: 'Dissolve…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (3)…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply all (3)…' }));
  });

  it('the asking row applied elsewhere: the confirmation closes, the focus goes to the foot', () => {
    const p = card(plan());
    fireEvent.click(within(rowsOf()[2]!).getByRole('button', { name: 'Dissolve…' }));
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={plan([{}, {}, { state: 'done', doneAt: AT }])} {...p} /></ChatCopyProvider>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply all (2)' }));
  });

  it('the asking row applied elsewhere, no foot left: the focus goes to the card\'s first button', () => {
    const p = card([{ ...model, state: 'stale', target: 'Nova' }, dissolve]);
    fireEvent.click(screen.getByRole('button', { name: 'Dissolve…' }));
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={[{ ...model, state: 'stale', target: 'Nova' }, { ...dissolve, state: 'done', doneAt: AT }]} {...p} /></ChatCopyProvider>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Nova' }));
  });

  it('the card changes elsewhere: the confirmation keeps only the rows still open, and sends only them', () => {
    const p = card(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (3)…' }));
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={plan([{ state: 'done', doneAt: AT }])} {...p} /></ChatCopyProvider>);
    const confirm = screen.getByRole('group', { name: /^Confirmation/ });
    expect(confirm).toHaveTextContent('Apply the 2 actions, in order?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Apply the 2' }));
    expect(p.onApply).toHaveBeenCalledWith([1, 2], { confirmed: true });
  });

  it('the irreversible row applied elsewhere: what is left needs no confirmation, it closes', () => {
    const p = card(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (3)…' }));
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={plan([{}, {}, { state: 'done', doneAt: AT }])} {...p} /></ChatCopyProvider>);
    expect(screen.queryByRole('group', { name: /^Confirmation/ })).toBeNull();
    expect(p.onApply).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply all (2)' }));
  });

  it('Ignore clicked here: once ignored, the focus goes to Review', () => {
    const p = card(plan());
    const ignore = screen.getByRole('button', { name: 'Ignore' });
    ignore.focus(); fireEvent.click(ignore);
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={plan()} ignoredAt={AT} {...p} /></ChatCopyProvider>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review' }));
  });

  it('Review clicked here: once open again, the focus goes to the card\'s first button', () => {
    const p = card(plan(), { ignoredAt: AT });
    const review = screen.getByRole('button', { name: 'Review' });
    review.focus(); fireEvent.click(review);
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={plan()} {...p} /></ChatCopyProvider>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' }));
  });

  it('ignored elsewhere while confirming: the focus goes to Review', () => {
    const p = card(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (3)…' }));
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={plan()} ignoredAt={AT} {...p} /></ChatCopyProvider>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review' }));
  });

  it('the card changes elsewhere: no row asked is open any more, or it is ignored, the confirmation closes; Review does not reopen it', () => {
    const p = card(plan());
    const again = (rows: ActionRowView[], extra: Partial<ActionCardProps> = {}) =>
      p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={rows} {...p} {...extra} /></ChatCopyProvider>);
    fireEvent.click(within(rowsOf()[2]!).getByRole('button', { name: 'Dissolve…' }));
    again(plan([{}, {}, { state: 'done', doneAt: AT }]));
    expect(screen.queryByRole('group', { name: /^Confirmation/ })).toBeNull();
    expect(document.body).not.toHaveTextContent('already done');
    again(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (3)…' }));
    again(plan(), { ignoredAt: AT });
    again(plan());
    expect(screen.queryByRole('group', { name: /^Confirmation/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply all (3)…' })).toBeTruthy();
  });

  it('the confirmation is named by its question and described by its why; a row\'s state reads at 12 px', () => {
    card(plan([{ state: 'done', doneAt: AT }]));
    fireEvent.click(within(rowsOf()[2]!).getByRole('button', { name: 'Dissolve…' }));
    const confirm = screen.getByRole('group', { name: 'Confirmation Dissolve the team ledge-roles?' });
    expect(document.getElementById(confirm.getAttribute('aria-describedby')!)).toHaveTextContent('Ledge cannot undo it once sent.');
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(rowsOf()[0]!.querySelector<HTMLElement>('[data-action-side] span')!.style.fontSize).toBe('12px');
  });

  it('an irreversible row asks too, alone; the rows already done read « already done », dimmed', () => {
    const p = card(plan([{ state: 'done', doneAt: AT }]));
    fireEvent.click(screen.getByRole('button', { name: 'Dissolve…' }));
    const confirm = screen.getByRole('group', { name: /^Confirmation/ });
    expect(confirm).toHaveTextContent('Dissolve the team ledge-roles?');
    expect(rowsOf()[0]).toHaveTextContent('already done');
    expect(rowsOf()[0]!.hasAttribute('data-dim')).toBe(true);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Dissolve' }));
    expect(p.onApply).toHaveBeenCalledWith([2], { confirmed: true });
  });

  it('running: the step turns, its button waits, the foot counts the steps', () => {
    card(plan([{ state: 'done', doneAt: AT }, { state: 'running' }]));
    expect(nodes()).toEqual(['Step 1, applied', 'Step 2, running', 'Step 3']);
    expect(rowsOf()[0]).toHaveTextContent(`Applied · ${at}`);
    expect((within(rowsOf()[1]!).getByRole('button', { name: 'Running…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Step 2 of 3…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ignore' })).toBeNull();
  });

  it('failed: why, the next steps held, « Resume at step 2 » from it, Retry on the row', () => {
    const p = card(plan([{ state: 'done', doneAt: AT }, { state: 'failed', error: 'Atlas is offline.', code: 'failed' }]));
    expect(rowsOf().map(r => r.getAttribute('data-action-row'))).toEqual(['done', 'failed', 'held']);
    expect(within(rowsOf()[1]!).getByRole('alert')).toHaveTextContent('Failed: the action was sent but did not go through.');
    expect(document.body).not.toHaveTextContent('Atlas is offline.');
    expect(rowsOf()[2]).toHaveTextContent('Not applied: the plan stopped at step 2.');
    expect(document.body).toHaveTextContent('steps done are not replayed');
    fireEvent.click(within(rowsOf()[1]!).getByRole('button', { name: 'Retry' }));
    expect(p.onApply).toHaveBeenLastCalledWith([1], { confirmed: false });
    fireEvent.click(screen.getByRole('button', { name: 'Resume at step 2 (2)…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply the 2' }));
    expect(p.onApply).toHaveBeenLastCalledWith([1, 2], { confirmed: true });
    expect(screen.getAllByRole('button', { name: 'Ignore' })).toHaveLength(1);
  });

  it('refused: nothing was sent, no retry; « Continue without step 2 » leaves it out', () => {
    const p = card(plan([{ state: 'done', doneAt: AT }, { state: 'refused', error: 'Otto was closed meanwhile.', code: 'exited', vars: { session: 'Otto' } }]));
    expect(nodes()[1]).toBe('Step 2, refused');
    expect(within(rowsOf()[1]!).getByRole('alert')).toHaveTextContent('Refused: Otto is no longer running. Nothing was sent.');
    expect(within(rowsOf()[1]!).getByRole('alert').querySelector('strong')?.textContent).toBe('Otto');
    expect(document.body).not.toHaveTextContent('Otto was closed meanwhile.');
    expect(within(rowsOf()[1]!).queryByRole('button')).toBeNull();
    expect(rowsOf()[1]).toHaveTextContent('Refused');
    fireEvent.click(screen.getByRole('button', { name: 'Continue without step 2 (1)…' }));
    fireEvent.click(within(screen.getByRole('group', { name: /^Confirmation/ })).getByRole('button', { name: 'Dissolve' }));
    expect(p.onApply).toHaveBeenLastCalledWith([2], { confirmed: true });
  });

  it('applied: every step ✓ and the plan\'s time, no button left', () => {
    card(plan([{ state: 'done', doneAt: AT }, { state: 'done', doneAt: AT }, { state: 'done', doneAt: AT }]));
    expect(nodes()).toEqual(['Step 1, applied', 'Step 2, applied', 'Step 3, applied']);
    expect(document.body).toHaveTextContent(`Plan applied at ${at}`);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(rowsOf()[2]!.querySelector('[data-action-detail]')!.hasAttribute('data-clamped')).toBe(false);
  });

  it('ignored: one line, nothing sent, Review opens it again', () => {
    const p = card(plan(), { ignoredAt: AT });
    expect(document.querySelector('[data-action-card]')).toBeNull();
    expect(document.body).toHaveTextContent(`Plan of 3 actions ignored at ${at} · nothing was sent`);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(p.onReview).toHaveBeenCalledOnce();
  });

  it('ignored once begun: what went is counted, the rest ignored, never « nothing was sent »', () => {
    card(plan([{ state: 'done', doneAt: AT }, { state: 'failed', code: 'failed' }]), { ignoredAt: AT });
    expect(document.body).toHaveTextContent(`Plan of 3 actions: 1 applied, 1 failed, the rest ignored at ${at}`);
    expect(document.body).not.toHaveTextContent('nothing was sent');
    const decide: ActionRowView = { ...permission, state: 'denied', doneAt: AT };
    card([{ ...model, state: 'done' }, { ...archive, state: 'done' }, decide, dissolve], { ignoredAt: AT });
    expect(document.body).toHaveTextContent(`Plan of 4 actions: 2 applied, 1 denial sent, the rest ignored at ${at}`);
    expect(shipped.fr.ignored(4, '10:42', { done: 2, denied: 1, failed: 1 })).toBe('Plan de 4 actions : 2 appliquées, 1 refus envoyé, 1 échouée, le reste ignoré à 10:42');
    expect(shipped.fr.ignored(1, '10:42', { done: 0, denied: 0, failed: 1 })).toBe('Carte ignorée à 10:42 · l’action est partie, mais n’a pas abouti');
    expect(shipped.fr.ignored(3, '10:42')).toBe('Plan de 3 actions ignoré à 10:42 · rien n’a été envoyé');
  });

  it('narrow (the island): the buttons go under the text', () => {
    card(plan(), { narrow: true });
    expect(rowsOf()[0]!.querySelector('[data-action-side]')!.getAttribute('data-under')).toBe('true');
  });
});

describe('the action card (#94): one row', () => {
  it('no rail, Ignore beside the verb, no foot', () => {
    const p = card([model]);
    expect(screen.getByRole('region', { name: 'Proposed action' })).toBeTruthy();
    expect(nodes()).toEqual([]);
    expect(within(rowsOf()[0]!).getByRole('button', { name: 'Ignore' })).toBeTruthy();
    expect(document.querySelector('[data-action-foot]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(p.onApply).toHaveBeenCalledWith([0], { confirmed: false });
  });

  it('failed: Ignore and Retry; done: its time', () => {
    const { unmount } = card([{ ...model, state: 'failed', error: 'Atlas is offline.' }]);
    expect(within(rowsOf()[0]!).getAllByRole('button').map(b => b.textContent)).toEqual(['Ignore', 'Retry']);
    unmount();
    card([{ ...model, state: 'done', doneAt: AT }]);
    expect(rowsOf()[0]).toHaveTextContent(`Applied · ${at}`);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('done or denied without its time: no empty « · », no « at »', () => {
    card([{ ...model, state: 'done' }]);
    expect(rowsOf()[0]).toHaveTextContent(/Applied$/);
    card([{ ...permission, state: 'denied' }]);
    expect(rowsOf()[1]).toHaveTextContent('Denial sent');
    expect(rowsOf()[1]).not.toHaveTextContent('Denial sent ·');
    card(plan([{ state: 'done' }, { state: 'done' }, { state: 'done' }]));
    expect(document.querySelectorAll('[data-action-foot]')[0]).toHaveTextContent(/^Plan applied$/);
  });

  it('ignored: « Card ignored »', () => {
    card([model], { ignoredAt: AT });
    expect(document.body).toHaveTextContent(`Card ignored at ${at} · nothing was sent`);
  });

  it('ignored after it failed: it was sent, the line does not say nothing was', () => {
    card([{ ...model, state: 'failed', code: 'failed' }], { ignoredAt: AT });
    expect(document.body).toHaveTextContent(`Card ignored at ${at} · the action was sent but did not go through`);
    expect(document.body).not.toHaveTextContent('nothing was sent');
  });

  it('an action the front does not know (a newer daemon): its summary, « Apply »', () => {
    card([{ action: 'session.fork', summary: 'Fork **Nova**', risk: 'reversible' }]);
    expect(document.body).toHaveTextContent('Fork Nova');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
  });
});

describe('the action card (#94): a permission', () => {
  it('Ignore, Deny, Accept…; the request quoted as it is', () => {
    card([permission]);
    expect(within(rowsOf()[0]!).getAllByRole('button').map(b => b.textContent)).toEqual(['Ignore', 'Deny', 'Accept…']);
    const quote = rowsOf()[0]!.querySelector('[data-action-request]')!;
    expect(quote).toHaveTextContent('Bash · rebuild the daemon');
    expect(quote).toHaveTextContent('rm -rf packages/ledge/dist');
  });

  it('Deny sends at once, without a confirmation; Accept… asks first', () => {
    const p = card([permission]);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(p.onDeny).toHaveBeenCalledWith(0);
    expect(screen.queryByRole('group', { name: /^Confirmation/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Accept…' }));
    const confirm = screen.getByRole('group', { name: /^Confirmation/ });
    expect(confirm).toHaveTextContent('Accept Nova\'s request?');
    expect(confirm).toHaveTextContent('Ledge cannot undo it once sent.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Accept' }));
    expect(p.onApply).toHaveBeenCalledWith([0], { confirmed: true });
  });

  it('denial sent: grey, the deny line, no risk, the request faded', () => {
    card([{ ...permission, state: 'denied', doneAt: AT }]);
    const r = rowsOf()[0]!;
    expect(r.getAttribute('data-action-row')).toBe('denied');
    expect(r).toHaveTextContent('Deny Nova\'s request');
    expect(r).toHaveTextContent(`Denial sent · ${at}`);
    expect(r).toHaveTextContent('Nova got your denial: the command did not run.');
    expect(r).not.toHaveTextContent('Irreversible');
    expect(r.querySelector('[data-action-request]')!.getAttribute('data-action-request')).toBe('faded');
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('the request changed: the old one struck, nothing sent, « Open Nova »', () => {
    const p = card([{ ...permission, state: 'stale' }]);
    const r = rowsOf()[0]!;
    expect(r.querySelector('[data-action-request]')!.getAttribute('data-action-request')).toBe('old');
    expect(r).toHaveTextContent('Nova\'s request changed since my answer: nothing was sent.');
    fireEvent.click(screen.getByRole('button', { name: 'Open Nova' }));
    expect(p.onOpen).toHaveBeenCalledWith(0);
  });
});

describe('the action card (#94): a row from the protocol', () => {
  const row: ChatAction = { action: 'team.dissolve', args: { team: 't1' }, summary: 'Dissoudre l’équipe **ledge-roles**', vars: { team: 'ledge-roles' }, risk: 'destructive', team: 't1', detail: 'Ses 6 sessions…' };

  it('its id, summary, risk, detail and state as they come; the session it names, for a link', () => {
    expect(actionRowOf(row)).toEqual({ action: 'team.dissolve', summary: row.summary, risk: 'destructive', detail: 'Ses 6 sessions…', target: 'ledge-roles', vars: { team: 'ledge-roles' } });
    expect(actionRowOf({ ...row, action: 'task.cancel', vars: { task: 'Relire', owner: 'Max' }, session: 'local:max' }).target).toBe('Max');
    expect(actionRowOf({ ...row, action: 'session.archive', session: 'otto', state: 'done', doneAt: AT })).toMatchObject({ state: 'done', doneAt: AT });
  });

  it('its target by name, not by id: « Open Nova », not « Open local:nova »', () => {
    const decide: ChatAction = { action: 'session.decide', args: { session: 'local:nova', decision: 'accept' }, summary: 'Accepter la demande de **Nova**', vars: { session: 'Nova', decision: 'accept', kind: 'permission' }, risk: 'destructive', session: 'local:nova', state: 'refused', code: 'changed' };
    expect(actionRowOf(decide)).toMatchObject({ target: 'Nova', state: 'stale' });
    card([actionRowOf(decide)]);
    expect(screen.getByRole('button', { name: 'Open Nova' })).toBeTruthy();
    expect(document.body).not.toHaveTextContent('local:nova');
  });

  it('session.decide with vars.decision deny: its verb is Deny, not Accept', () => {
    const deny: ChatAction = { action: 'session.decide', args: { session: 'local:nova', decision: 'deny' }, summary: 'Refuser la demande de **Nova**', vars: { session: 'Nova', decision: 'deny', kind: 'permission' }, risk: 'reversible', session: 'local:nova' };
    expect(actionRowOf(deny).decision).toBe('deny');
    card([actionRowOf(deny)]);
    expect(within(rowsOf()[0]!).getAllByRole('button').map(b => b.textContent)).toEqual(['Ignore', 'Deny']);
  });

  it('changed on another action than session.decide: a refusal, « things have changed », no Open; the plan stops there (codes.md)', () => {
    const save: ChatAction = { action: 'team.save', args: { team: 't1' }, summary: 'Enregistrer **ledge-roles**', vars: { team: 'ledge-roles' }, risk: 'reversible', team: 't1', state: 'refused', code: 'changed', error: 'the target has changed since the card' };
    expect(actionRowOf(save)).toMatchObject({ state: 'refused', code: 'changed' });
    card([{ ...model, state: 'done', doneAt: AT }, actionRowOf(save), dissolve]);
    expect(nodes()[1]).toBe('Step 2, refused');
    expect(within(rowsOf()[1]!).getByRole('alert')).toHaveTextContent('Refused: things have changed since my answer: ask me again. Nothing was sent.');
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(rowsOf()[2]).toHaveTextContent('Not applied: the plan stopped at step 2.');
    expect(screen.getByRole('button', { name: 'Continue without step 2 (1)…' })).toBeTruthy();
  });

  it('a request changed inside a plan: Open Nova on its row, the plan stopped there too', () => {
    const decide: ChatAction = { action: 'session.decide', args: { session: 'local:nova', decision: 'accept' }, summary: 'Accepter la demande de **Nova**', vars: { session: 'Nova', decision: 'accept', kind: 'permission' }, risk: 'destructive', session: 'local:nova', detail: 'npm test', state: 'refused', code: 'changed' };
    card([{ ...model, state: 'done', doneAt: AT }, actionRowOf(decide), dissolve]);
    expect(within(rowsOf()[1]!).getByRole('button', { name: 'Open Nova' })).toBeTruthy();
    expect(rowsOf()[2]).toHaveTextContent('Not applied: the plan stopped at step 2.');
    expect(screen.getByRole('button', { name: 'Continue without step 2 (1)…' })).toBeTruthy();
  });

  it('a code it knows is kept; one it does not (a newer daemon) reads as failed', () => {
    expect(actionRowOf({ ...row, state: 'refused', code: 'dissolved', error: 'déjà dissoute' })).toMatchObject({ state: 'refused', code: 'dissolved', error: 'déjà dissoute' });
    expect(actionRowOf({ ...row, state: 'failed', code: 'quota_exceeded' }).code).toBe('failed');
  });
});

describe('the action card (#94): its words from the row\'s vars, in the front\'s language', () => {
  const dissolveRow: ChatAction = { action: 'team.dissolve', args: { team: 't1' }, summary: 'Dissoudre l’équipe **ledge-roles**', vars: { team: 'ledge-roles' }, risk: 'destructive', team: 't1' };

  it('the line from vars, its names in bold, never the daemon\'s French summary', () => {
    card([actionRowOf(dissolveRow)]);
    expect(rowsOf()[0]).toHaveTextContent('Dissolve the team ledge-roles');
    expect(rowsOf()[0]!.querySelector('strong')?.textContent).toBe('ledge-roles');
    expect(document.body).not.toHaveTextContent('Dissoudre');
    fireEvent.click(screen.getByRole('button', { name: 'Dissolve…' }));
    expect(screen.getByRole('group', { name: /^Confirmation/ })).toHaveTextContent('Dissolve the team ledge-roles?');
  });

  it('a word missing, or an action the front does not know: the summary', () => {
    card([actionRowOf({ ...dissolveRow, vars: {} })]);
    expect(rowsOf()[0]).toHaveTextContent('Dissoudre l’équipe ledge-roles');
    card([actionRowOf({ ...dissolveRow, action: 'team.fork' })]);
    expect(rowsOf()[1]).toHaveTextContent('Dissoudre l’équipe ledge-roles');
  });

  it('each line of the registry: session.model and session.decide by their words', () => {
    const w = actionWords.en.line;
    expect(w['session.model']!({ session: 'Nova', model: 'opus', effort: 'high' })).toBe('Switch **Nova** to opus, effort high');
    expect(w['session.model']!({ session: 'Nova' })).toBe('Switch **Nova** to its default model and effort');
    expect(w['session.decide']!({ session: 'Nova', decision: 'deny', kind: 'plan', note: 'x' })).toBe('Deny **Nova**’s plan request, with a note');
    expect(actionWords.fr.line['task.pass']!({ task: 'Relire', owner: 'Max', session: 'Gus' })).toBe('Passer la tâche « Relire » de **Max** à **Gus**');
    const generic = ACTIONS.filter(a => a.card === 'generic').map(a => a.id).sort();
    for (const l of ['fr', 'en'] as const) expect(generic.filter(id => !actionWords[l].line[id]), l).toEqual([]);
  });

  it('refused or failed: the front\'s words by code, the daemon\'s error never on screen', () => {
    card([actionRowOf({ ...dissolveRow, state: 'refused', code: 'dissolved', error: 'team ledge-roles is dissolved' })]);
    expect(rowsOf()[0]).toHaveTextContent('Refused: the team ledge-roles was dissolved in the meantime. Nothing was sent.');
    expect(document.body).not.toHaveTextContent('team ledge-roles is dissolved');
    card([actionRowOf({ ...dissolveRow, state: 'failed', code: 'quota_exceeded', error: 'quota' })]);
    expect(rowsOf()[1]).toHaveTextContent('Failed: the action was sent but did not go through.');
    card([actionRowOf({ ...dissolveRow, state: 'refused', error: 'nope' })]);
    expect(rowsOf()[2]).toHaveTextContent('Refused: this action is no longer possible. Nothing was sent.');
  });

  it('a code whose word is missing reads « no longer possible »; unknown speaks of what the action is about', () => {
    const why = actionWords.fr.why;
    expect(why('member', 'team.join', { session: 'Nova' })).toBe('cette action n’est plus possible.');
    expect(why('unknown', 'team.join', { session: 'Nova', team: 'qa' })).toBe('Ledge ne trouve plus l’équipe **qa**.');
    expect(why('unknown', 'task.cancel', { task: 'Relire', owner: 'Max' })).toBe('Ledge ne trouve plus la tâche « Relire ».');
    expect(why('running', 'session.resume', { session: 'Otto' })).toBe('**Otto** tourne déjà : rien à reprendre.');
    for (const code of ACTION_ERROR_CODES) for (const l of ['fr', 'en'] as const) expect(actionWords[l].why(code, undefined, {}), `${l} ${code}`).toBeTruthy();
  });
});

describe('the action card (#94): a request from the protocol, and one cut', () => {
  const decide: ChatAction = { action: 'session.decide', args: { session: 'local:nova', decision: 'accept' }, summary: 'Accepter la demande de permission de **Nova**', vars: { session: 'Nova', decision: 'accept', kind: 'permission' }, risk: 'destructive', session: 'local:nova', detail: 'npm test' };

  it('session.decide: the request quoted, under the words of its kind, not as a detail', () => {
    const r = actionRowOf(decide);
    expect(r.request).toEqual({ kind: 'permission', text: 'npm test' });
    expect(r.detail).toBeUndefined();
    card([r]);
    const quote = rowsOf()[0]!.querySelector('[data-action-request]')!;
    expect(quote).toHaveTextContent('Permission');
    expect(quote).toHaveTextContent('npm test');
    expect(rowsOf()[0]!.querySelector('[data-action-detail]')).toBeNull();
  });

  it('cut (detailCut): the quote ends « truncated », no Accept, Open Nova instead; Ignore and Deny stay', () => {
    const r = actionRowOf({ ...decide, detail: 'x'.repeat(50) + '…', detailCut: true });
    expect(r.state).toBe('cut');
    const p = card([r]);
    expect(rowsOf()[0]!.getAttribute('data-action-row')).toBe('cut');
    expect(rowsOf()[0]!.querySelector('[data-action-request]')).toHaveTextContent('… (truncated, see the session)');
    expect(rowsOf()[0]).toHaveTextContent('Too long to be quoted in full: read it in Nova to accept it. You can deny it from here.');
    expect(within(rowsOf()[0]!).getAllByRole('button').map(b => b.textContent)).toEqual(['Ignore', 'Deny', 'Open Nova']);
    fireEvent.click(screen.getByRole('button', { name: 'Open Nova' }));
    expect(p.onOpen).toHaveBeenCalledWith(0);
    expect(p.onApply).not.toHaveBeenCalled();
  });

  it('cut with a deny row (the daemon\'s contract): Deny stays', () => {
    card([{ ...actionRowOf({ ...decide, detailCut: true }), deny: { summary: 'Deny **Nova**’s request' } }]);
    expect(within(rowsOf()[0]!).getAllByRole('button').map(b => b.textContent)).toEqual(['Ignore', 'Deny', 'Open Nova']);
  });

  it('the daemon\'s cut code reads as the cut state, not a refusal; a denial cut is not cut', () => {
    expect(actionRowOf({ ...decide, state: 'refused', code: 'cut', error: 'cut' })).toMatchObject({ state: 'cut' });
    expect(actionRowOf({ ...decide, vars: { ...decide.vars, decision: 'deny' }, detailCut: true }).state).toBeUndefined();
  });

  it('ignored and confirm_required are never shown: the row is proposed again', () => {
    for (const code of ['ignored', 'confirm_required']) {
      const r = actionRowOf({ ...decide, state: 'refused', code, error: code });
      expect(r.state, code).toBeUndefined();
      expect(r.code, code).toBeUndefined();
    }
  });

  it('a plan with a cut row: Apply all leaves it out', () => {
    const p = card([actionRowOf({ ...decide, detailCut: true }), model]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (1)' }));
    expect(p.onApply).toHaveBeenCalledWith([1], { confirmed: false });
  });
});

describe('the action card (#94): Deny, from the protocol', () => {
  const decide: ChatAction = { action: 'session.decide', args: { session: 'local:nova', decision: 'accept' }, summary: 'Accepter la demande de permission de **Nova**', vars: { session: 'Nova', decision: 'accept', kind: 'permission' }, risk: 'destructive', session: 'local:nova', detail: 'npm test' };

  it('an accept row offers Deny beside Accept…; Deny goes at once, without a confirmation', () => {
    const p = card([actionRowOf(decide)]);
    expect(within(rowsOf()[0]!).getAllByRole('button').map(b => b.textContent)).toEqual(['Ignore', 'Deny', 'Accept…']);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(p.onDeny).toHaveBeenCalledWith(0);
    expect(screen.queryByRole('group', { name: /^Confirmation/ })).toBeNull();
  });

  it('denied (its summary and decision still say accept): « Denial sent », the line of the denial in the front\'s words', () => {
    card([actionRowOf({ ...decide, state: 'denied', doneAt: AT })]);
    const r = rowsOf()[0]!;
    expect(r.getAttribute('data-action-row')).toBe('denied');
    expect(r).toHaveTextContent('Deny Nova’s permission request');
    expect(r).not.toHaveTextContent('Accept');
    expect(r).toHaveTextContent(`Denial sent · ${at}`);
  });

  it('a cut request keeps Deny', () => {
    card([actionRowOf({ ...decide, detailCut: true })]);
    expect(within(rowsOf()[0]!).getAllByRole('button').map(b => b.textContent)).toEqual(['Ignore', 'Deny', 'Open Nova']);
  });

  it('a row that denies already, or another action: no second Deny', () => {
    expect(actionRowOf({ ...decide, vars: { ...decide.vars, decision: 'deny' } }).deny).toBeUndefined();
    expect(actionRowOf({ ...decide, action: 'session.archive' }).deny).toBeUndefined();
  });
});
