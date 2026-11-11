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
const cancel: ActionRowView = { summary: 'Cancel **Max**’s task “Relire”', risk: 'destructive', action: 'task.cancel', detail: 'Max is told; the task cannot be reopened.' };
const permission: ActionRowView = {
  summary: 'Accept **Nova**\'s request', risk: 'destructive', action: 'session.decide', target: 'Nova',
  request: { kind: 'Bash · rebuild the daemon', text: 'rm -rf packages/ledge/dist' }, deny: { summary: 'Deny **Nova**\'s request' }
};
const plan = (states: Array<Partial<ActionRowView>> = []) => [model, archive, cancel].map((r, i) => ({ ...r, ...states[i] }));

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
    expect(within(rowsOf()[2]!).getByRole('button', { name: 'Drop…' })).toBeTruthy();
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
    fireEvent.click(within(rowsOf()[2]!).getByRole('button', { name: 'Drop…' }));
    fireEvent.keyDown(screen.getByRole('group', { name: /^Confirmation/ }), { key: 'Escape' });
    expect(document.activeElement).toBe(within(rowsOf()[2]!).getByRole('button', { name: 'Drop…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply all (3)…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply all (3)…' }));
  });

  it('the asking row applied elsewhere: the confirmation closes, the focus goes to the foot', () => {
    const p = card(plan());
    fireEvent.click(within(rowsOf()[2]!).getByRole('button', { name: 'Drop…' }));
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={plan([{}, {}, { state: 'done', doneAt: AT }])} {...p} /></ChatCopyProvider>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply all (2)' }));
  });

  it('the asking row applied elsewhere, no foot left: the focus goes to the card\'s first button', () => {
    const p = card([{ ...model, state: 'stale', target: 'Nova' }, cancel]);
    fireEvent.click(screen.getByRole('button', { name: 'Drop…' }));
    p.rerender(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, action: actionCopy } }}><ActionCard rows={[{ ...model, state: 'stale', target: 'Nova' }, { ...cancel, state: 'done', doneAt: AT }]} {...p} /></ChatCopyProvider>);
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
    fireEvent.click(within(rowsOf()[2]!).getByRole('button', { name: 'Drop…' }));
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
    fireEvent.click(within(rowsOf()[2]!).getByRole('button', { name: 'Drop…' }));
    const confirm = screen.getByRole('group', { name: 'Confirmation Cancel Max’s task “Relire”?' });
    expect(document.getElementById(confirm.getAttribute('aria-describedby')!)).toHaveTextContent('Ledge cannot undo it once sent.');
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(rowsOf()[0]!.querySelector<HTMLElement>('[data-action-side] span')!.style.fontSize).toBe('12px');
  });

  it('an irreversible row asks too, alone; the rows already done read « already done », dimmed', () => {
    const p = card(plan([{ state: 'done', doneAt: AT }]));
    fireEvent.click(screen.getByRole('button', { name: 'Drop…' }));
    const confirm = screen.getByRole('group', { name: /^Confirmation/ });
    expect(confirm).toHaveTextContent('Cancel Max’s task “Relire”?');
    expect(rowsOf()[0]).toHaveTextContent('already done');
    expect(rowsOf()[0]!.hasAttribute('data-dim')).toBe(true);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Drop' }));
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
    fireEvent.click(within(screen.getByRole('group', { name: /^Confirmation/ })).getByRole('button', { name: 'Drop' }));
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
    card([{ ...model, state: 'done' }, { ...archive, state: 'done' }, decide, cancel], { ignoredAt: AT });
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
  const row: ChatAction = { action: 'task.cancel', args: { task: 't91b0d4' }, summary: 'Annuler la tâche « Relire » de **Max**', vars: { task: 'Relire', owner: 'Max' }, risk: 'destructive', session: 'local:max', detail: 'Max est prévenu…' };

  it('its id, summary, risk, detail and state as they come; the session it names, for a link', () => {
    expect(actionRowOf(row)).toEqual({ action: 'task.cancel', summary: row.summary, risk: 'destructive', detail: 'Max est prévenu…', target: 'Max', vars: { task: 'Relire', owner: 'Max' } });
    expect(actionRowOf({ ...row, action: 'session.resume', vars: { session: 'Otto' }, session: 'local:otto' }).target).toBe('Otto');
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
    const save: ChatAction = { action: 'session.resume', args: { session: 'local:otto' }, summary: 'Reprendre **Otto**', vars: { session: 'Otto' }, risk: 'reversible', state: 'refused', code: 'changed', error: 'the target has changed since the card' };
    expect(actionRowOf(save)).toMatchObject({ state: 'refused', code: 'changed' });
    card([{ ...model, state: 'done', doneAt: AT }, actionRowOf(save), cancel]);
    expect(nodes()[1]).toBe('Step 2, refused');
    expect(within(rowsOf()[1]!).getByRole('alert')).toHaveTextContent('Refused: things have changed since my answer: ask me again. Nothing was sent.');
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(rowsOf()[2]).toHaveTextContent('Not applied: the plan stopped at step 2.');
    expect(screen.getByRole('button', { name: 'Continue without step 2 (1)…' })).toBeTruthy();
  });

  it('a request changed inside a plan: Open Nova on its row, the plan stopped there too', () => {
    const decide: ChatAction = { action: 'session.decide', args: { session: 'local:nova', decision: 'accept' }, summary: 'Accepter la demande de **Nova**', vars: { session: 'Nova', decision: 'accept', kind: 'permission' }, risk: 'destructive', session: 'local:nova', detail: 'npm test', state: 'refused', code: 'changed' };
    card([{ ...model, state: 'done', doneAt: AT }, actionRowOf(decide), cancel]);
    expect(within(rowsOf()[1]!).getByRole('button', { name: 'Open Nova' })).toBeTruthy();
    expect(rowsOf()[2]).toHaveTextContent('Not applied: the plan stopped at step 2.');
    expect(screen.getByRole('button', { name: 'Continue without step 2 (1)…' })).toBeTruthy();
  });

  it('a code it knows is kept; one it does not (a newer daemon) reads as failed', () => {
    expect(actionRowOf({ ...row, state: 'refused', code: 'closed', error: 'déjà close' })).toMatchObject({ state: 'refused', code: 'closed', error: 'déjà close' });
    expect(actionRowOf({ ...row, state: 'failed', code: 'quota_exceeded' }).code).toBe('failed');
  });
});

describe('the action card (#94): its words from the row\'s vars, in the front\'s language', () => {
  const cancelRow: ChatAction = { action: 'task.cancel', args: { task: 't91b0d4' }, summary: 'Annuler la tâche « Relire » de **Max**', vars: { task: 'Relire', owner: 'Max' }, risk: 'destructive', session: 'local:max' };

  it('the line from vars, its names in bold, never the daemon\'s French summary', () => {
    card([actionRowOf(cancelRow)]);
    expect(rowsOf()[0]).toHaveTextContent('Cancel Max’s task “Relire”');
    expect(rowsOf()[0]!.querySelector('strong')?.textContent).toBe('Max');
    expect(document.body).not.toHaveTextContent('Annuler');
    fireEvent.click(screen.getByRole('button', { name: 'Drop…' }));
    expect(screen.getByRole('group', { name: /^Confirmation/ })).toHaveTextContent('Cancel Max’s task “Relire”?');
  });

  it('a word missing, or an action the front does not know: the summary', () => {
    card([actionRowOf({ ...cancelRow, vars: {} })]);
    expect(rowsOf()[0]).toHaveTextContent('Annuler la tâche « Relire » de Max');
    card([actionRowOf({ ...cancelRow, action: 'task.fork' })]);
    expect(rowsOf()[1]).toHaveTextContent('Annuler la tâche « Relire » de Max');
  });

  it('each line of the registry: session.model and session.decide by their words', () => {
    const w = actionWords.en.line;
    expect(w['session.model']!({ session: 'Nova', model: 'opus', effort: 'high' })).toBe('Switch **Nova** to opus, effort high');
    expect(w['session.model']!({ session: 'Nova' })).toBe('Switch **Nova** to its default model and effort');
    expect(w['session.decide']!({ session: 'Nova', decision: 'deny', kind: 'plan', note: 'x' })).toBe('Deny **Nova**’s plan request, with a note');
    expect(actionWords.fr.line['task.pass']!({ task: 'Relire', owner: 'Max', session: 'Gus' })).toBe('Passer la tâche « Relire » de **Max** à **Gus**');
    expect(actionWords.fr.line['task.answer']!({ task: 'Fusionner ?', session: 'Otto', answer: 'oui' })).toBe('Répondre à la décision « Fusionner ? » de **Otto**');
    expect(w['task.answer']!({ task: 'Merge?', session: 'Otto' })).toBe('Answer **Otto**’s decision “Merge?”');
    expect(actionWords.fr.why('not_decision', 'task.answer', { task: 'Relire' })).toBe('la tâche « Relire » n’est pas une décision qui t’est posée.');
    const generic = ACTIONS.filter(a => a.card === 'generic').map(a => a.id).sort();
    for (const l of ['fr', 'en'] as const) expect(generic.filter(id => !actionWords[l].line[id]), l).toEqual([]);
  });

  it('OpenRig rows by their words (M3 Q34): a rig\'s or the kernel\'s power, a snapshot, a role\'s seats, and their refusals', () => {
    const fr = actionWords.fr, en = actionWords.en;
    expect(fr.line['rig.act']!({ kind: 'rig.start', rig: 'ledge-dev' })).toBe('Démarrer le rig **ledge-dev**');
    expect(fr.line['rig.act']!({ kind: 'rig.restart', rig: 'ledge-dev' })).toBe('Redémarrer le rig **ledge-dev**');
    expect(fr.line['rig.act']!({ kind: 'rig.snapshot', rig: 'ledge-dev' })).toBe('Prendre un snapshot du rig **ledge-dev**');
    expect(fr.line['rig.act']!({ kind: 'kernel.stop', rig: 'kernel' })).toBe('Arrêter le kernel');
    expect(en.line['rig.act']!({ kind: 'rig.stop', rig: 'ledge-dev' })).toBe('Stop the rig **ledge-dev**');
    expect(en.line['rig.act']!({ kind: 'rig.snapshot', rig: 'ledge-dev' })).toBe('Take a snapshot of the rig **ledge-dev**');
    expect(en.line['rig.act']!({ kind: 'kernel.start', rig: 'kernel' })).toBe('Start the kernel');
    // A kind this front does not know: the daemon's summary.
    expect(fr.line['rig.act']!({ kind: 'rig.fly', rig: 'ledge-dev' })).toBeUndefined();
    expect(fr.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '2', from: '1' })).toBe('Ajouter 1 siège **dev.back** à **ledge-dev** (1 → 2)');
    expect(fr.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '3', from: '1' })).toBe('Ajouter 2 sièges **dev.back** à **ledge-dev** (1 → 3)');
    expect(fr.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '1', from: '2' })).toBe('Retirer 1 siège **dev.back** de **ledge-dev** (2 → 1)');
    expect(fr.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '0', from: '2' })).toBe('Retirer tous les sièges **dev.back** de **ledge-dev** (2 → 0)');
    expect(en.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '2', from: '1' })).toBe('Add 1 **dev.back** seat to **ledge-dev** (1 → 2)');
    expect(en.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '3', from: '1' })).toBe('Add 2 **dev.back** seats to **ledge-dev** (1 → 3)');
    expect(en.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '1', from: '2' })).toBe('Remove 1 **dev.back** seat from **ledge-dev** (2 → 1)');
    expect(en.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '0', from: '2' })).toBe('Remove every **dev.back** seat from **ledge-dev** (2 → 0)');
    // Without `from` (an older PC), the daemon's summary.
    expect(fr.line['rig.seats']!({ rig: 'ledge-dev', role: 'dev.back', count: '2' })).toBeUndefined();
    const rig = { kind: 'rig.start', rig: 'ledge-dev' }, kernel = { kind: 'kernel.start', rig: 'kernel' }, seats = { rig: 'ledge-dev', role: 'dev.back', count: '2', from: '2' };
    expect(fr.why('not_running', 'rig.act', rig)).toBe('**ledge-dev** ne tourne pas.');
    expect(fr.why('not_running', 'rig.act', kernel)).toBe('le kernel ne tourne pas.');
    expect(fr.why('running', 'rig.act', rig)).toBe('**ledge-dev** tourne déjà.');
    expect(en.why('running', 'rig.act', kernel)).toBe('the kernel is already running.');
    expect(fr.why('unchanged', 'rig.seats', seats)).toBe('**ledge-dev** a déjà 2 sièges **dev.back**.');
    expect(en.why('unchanged', 'rig.seats', seats)).toBe('**ledge-dev** already has 2 **dev.back** seats.');
    // `unknown` names the cause the PC gives (`missing`), whichever row it is: a rig gone under a seat change is the rig.
    expect(fr.why('unknown', 'rig.act', { ...rig, missing: 'rig' })).toBe('Ledge ne trouve plus le rig **ledge-dev**.');
    expect(fr.why('unknown', 'rig.seats', { ...seats, missing: 'rig' })).toBe('Ledge ne trouve plus le rig **ledge-dev**.');
    expect(fr.why('unknown', 'rig.seats', { ...seats, missing: 'role' })).toBe('**ledge-dev** n’a pas de siège **dev.back**.');
    expect(fr.why('unknown', 'rig.act', { ...rig, missing: 'openrig' })).toBe('OpenRig n’est pas sur ce PC.');
    expect(fr.why('unknown', 'rig.act', { ...kernel, missing: 'openrig' })).toBe('OpenRig n’est pas sur ce PC.');
    expect(en.why('unknown', 'rig.seats', { ...seats, missing: 'role' })).toBe('**ledge-dev** has no **dev.back** seat.');
    expect(en.why('unknown', 'rig.seats', { ...seats, missing: 'rig' })).toBe('Ledge can no longer find the rig **ledge-dev**.');
    expect(en.why('unknown', 'rig.act', { ...kernel, missing: 'openrig' })).toBe('OpenRig is not on this PC.');
    // No cause given (an older PC): none is claimed.
    expect(fr.why('unknown', 'rig.seats', seats)).toBe('cette action n’est plus possible.');
    expect(en.why('unknown', 'rig.act', rig)).toBe('this action is no longer possible.');
    expect(fr.why('failed', 'rig.act', rig)).toBe('l’action est partie, mais n’a pas abouti.');
  });

  it('an OpenRig row\'s button is its line\'s verb (M3 Q34); without its kind or its count, the action\'s verb', () => {
    const seats = (count: string, from?: string) => ({ rig: 'ledge-dev', role: 'dev.back', count, ...(from ? { from } : {}) });
    const fr = actionWords.fr.verb, en = actionWords.en.verb;
    expect(['rig.start', 'rig.stop', 'rig.restart', 'rig.snapshot', 'kernel.start', 'kernel.stop', 'kernel.restart'].map(kind => fr('rig.act', { kind, rig: 'x' })))
      .toEqual(['Démarrer', 'Arrêter', 'Redémarrer', 'Prendre le snapshot', 'Démarrer', 'Arrêter', 'Redémarrer']);
    expect(en('rig.act', { kind: 'rig.snapshot', rig: 'x' })).toBe('Take the snapshot');
    expect(en('rig.act', { kind: 'kernel.restart', rig: 'kernel' })).toBe('Restart');
    expect([fr('rig.seats', seats('3', '1')), fr('rig.seats', seats('0', '2')), en('rig.seats', seats('2', '1')), en('rig.seats', seats('1', '2'))])
      .toEqual(['Ajouter', 'Retirer', 'Add', 'Remove']);
    expect(fr('rig.act', { rig: 'x' })).toBeUndefined();
    expect(fr('rig.seats', seats('2'))).toBeUndefined();
    expect(fr('session.archive', { session: 'Nova' })).toBeUndefined();
    card([actionRowOf({ action: 'rig.act', args: { kind: 'rig.stop', rig: 'ledge-dev' }, summary: 'Arrêter le rig **ledge-dev**', vars: { kind: 'rig.stop', rig: 'ledge-dev' }, risk: 'destructive' })]);
    // An irreversible row carries its own button: the line's verb, and the action's when the card lacks `from`.
    card([actionRowOf({ action: 'rig.seats', args: { rig: 'ledge-dev', role: 'dev.back', count: 0 }, summary: 'Passer', vars: { rig: 'ledge-dev', role: 'dev.back', count: '0', from: '2' }, risk: 'destructive' })]);
    card([actionRowOf({ action: 'rig.seats', args: { rig: 'ledge-dev', role: 'dev.back', count: 0 }, summary: 'Passer', vars: { rig: 'ledge-dev', role: 'dev.back', count: '0' }, risk: 'destructive' })]);
    expect(within(rowsOf()[0]!).getByRole('button', { name: /^Stop/ })).toBeTruthy();
    expect(within(rowsOf()[1]!).getByRole('button', { name: /^Remove/ })).toBeTruthy();
    // The fixture's copy has no verb for rig.seats; the shipped one says « Changer » / « Change » (M3 § 5).
    expect(within(rowsOf()[2]!).getByRole('button', { name: /^Apply/ })).toBeTruthy();
    expect([shipped.fr.verbs['rig.act'], shipped.fr.verbs['rig.seats'], shipped.en.verbs['rig.act'], shipped.en.verbs['rig.seats']]).toEqual(['Appliquer', 'Changer', 'Apply', 'Change']);
  });

  it('refused or failed: the front\'s words by code, the daemon\'s error never on screen', () => {
    card([actionRowOf({ ...cancelRow, state: 'refused', code: 'closed', error: 'task t91b0d4 is closed' })]);
    expect(rowsOf()[0]).toHaveTextContent('Refused: the task “Relire” is already closed. Nothing was sent.');
    expect(document.body).not.toHaveTextContent('task t91b0d4 is closed');
    card([actionRowOf({ ...cancelRow, state: 'failed', code: 'quota_exceeded', error: 'quota' })]);
    expect(rowsOf()[1]).toHaveTextContent('Failed: the action was sent but did not go through.');
    card([actionRowOf({ ...cancelRow, state: 'refused', error: 'nope' })]);
    expect(rowsOf()[2]).toHaveTextContent('Refused: this action is no longer possible. Nothing was sent.');
  });

  it('a code whose word is missing reads « no longer possible »; unknown speaks of what the action is about', () => {
    const why = actionWords.fr.why;
    expect(why('holder', 'task.pass', { session: 'Nova' })).toBe('cette action n’est plus possible.');
    expect(why('unknown', 'session.archive', { session: 'Nova' })).toBe('Ledge ne trouve plus **Nova**.');
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
