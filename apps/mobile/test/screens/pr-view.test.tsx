// A request of the MR/PR tab (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html, §3 and §8): its head, the pipeline and the failed job's
// log, « Pour fusionner », the details, the footer, and the detail's states.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage, PrDetail } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { getAssertion } from '../../src/link/webauthn';
import { detail, forgeState, mr, pr } from '../model/forge-fixtures';
import { snapshot } from '../state/helpers';
import { session } from '../model/fixtures';
import { app } from './app-setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

const C = copy.prs;
const CHALLENGE = { type: 'confirm.challenge' as const, purpose: 'forge' as const, challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 };
const at = (id: string) => `#/prs/${encodeURIComponent(id)}`;

/** The app on a request, its PC sending its requests, the list delivered. */
function open(id: string, o: { confirm?: boolean; sessions?: Parameters<typeof snapshot>[0] } = {}) {
  const t = app('ready', { hash: at(id) });
  const snap = snapshot(o.sessions ?? [], 'WSL', undefined, { confirm: o.confirm ?? true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  act(() => t.deliver({ ...snap, daemon: { ...snap.daemon, forge: true } }));
  act(() => t.deliver({ type: 'forge.state', ...forgeState() }));
  const give = (d: PrDetail | undefined, extra: { cut?: true; error?: 'unavailable' | 'failed' | 'too_large' } = {}) =>
    act(() => t.deliver({ type: 'forge.detail', prId: id, ...(d ? { detail: d } : {}), ...extra }));
  return { ...t, give };
}

describe('a request', () => {
  it('opens on the list alone, reads its detail, and says the jobs are coming', () => {
    const t = open(pr().id);
    expect(t.of('forge.detail').map(m => m.prId)).toEqual([pr().id]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`#231 ${pr().title}`);
    expect(screen.getByText(`GitHub · ledge · ${pr().branch} → main`)).toBeTruthy();
    expect(screen.getByRole('link', { name: C.openOn('GitHub') }).getAttribute('href')).toBe(pr().url);
    expect(screen.getByText(C.detailLoading)).toBeTruthy();
  });

  it('shows a ready request: its stages, « Pour fusionner » all met, and Merge on', () => {
    const t = open(pr().id);
    t.give(detail(pr(), { pr: { ...pr(), approvals: { given: 1 } } }));
    expect(screen.getByText('build', { selector: '.uppercase' })).toBeTruthy();
    expect(screen.getByText('2:02')).toBeTruthy();
    const list = screen.getByRole('region', { name: C.toMerge });
    expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual(['✓Pipeline réussi', '✓Approuvée (1/1)', '✓Aucun changement demandé']);
    expect(screen.getByText('Pipeline réussi · approuvée (1/1)')).toBeTruthy();
    expect((screen.getByRole('button', { name: C.merge }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('review-qa')).toBeTruthy();
    expect(screen.getByText('#38')).toBeTruthy();
  });

  it('numbers GitLab stages, reads the failed job\'s log under the graph, and says what is missing in the footer', () => {
    const t = open(mr().id);
    t.give(detail(mr(), { mergeBlockers: ['pipeline'] }));
    expect(screen.getByText(C.stage(2, 'test'))).toBeTruthy();
    expect(t.of('forge.detail').map(m => m.log)).toEqual([undefined, 'j2']);
    expect(screen.getByText(C.log.reading('test'))).toBeTruthy();
    t.give({ ...detail(mr(), { mergeBlockers: ['pipeline'] }), log: { jobId: 'j2', text: 'FAIL worker/retry.test.ts' } });
    expect(screen.getByText('FAIL worker/retry.test.ts')).toBeTruthy();
    const foot = document.querySelector('[data-foot="why"]')!;
    expect(foot.textContent).toBe('0/1 approbation · le pipeline a échoué');
    expect((screen.getByRole('button', { name: C.merge }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens another job\'s log in a sheet', () => {
    const t = open(mr().id);
    t.give(detail(mr()));
    fireEvent.click(screen.getByRole('button', { name: /build/ }));
    expect(t.of('forge.detail').at(-1)?.log).toBe('j1');
    t.give({ ...detail(mr()), log: { jobId: 'j1', text: '…\n✓ built in 4.81s' } });
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(C.log.title('build'))).toBeTruthy();
    expect(within(sheet).getByText(`${C.log.note} ${C.log.cut('GitLab')}`)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: C.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows its changes and its commits in their views, each with its count', () => {
    const t = open(pr().id);
    t.give(detail());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${C.tabs.changes}\\s*1$`) }));
    expect(screen.getByText(/Term\.tsx/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${C.tabs.commits}\\s*1$`) }));
    expect(screen.getByText('feat: detached windows')).toBeTruthy();
  });

  it('reads a merged request without a button, the footer saying where it went', () => {
    const merged = pr({ state: 'merged' });
    const t = app('ready', { hash: at(merged.id) });
    const snap = snapshot([], 'WSL') as Extract<PhoneServerMessage, { type: 'snapshot' }>;
    act(() => t.deliver({ ...snap, daemon: { ...snap.daemon, forge: true } }));
    act(() => t.deliver({ type: 'forge.state', ...forgeState({ prs: [merged] }) }));
    act(() => t.deliver({ type: 'forge.detail', prId: merged.id, detail: detail(merged) }));
    expect(screen.queryByRole('button', { name: C.merge })).toBeNull();
    expect(screen.queryByRole('region', { name: C.toMerge })).toBeNull();
    expect(document.querySelector('[data-foot="done"]')?.textContent).toMatch(/^fusionnéedans main · /);
  });
});

describe('a request\'s detail that does not come', () => {
  it('says its CLI could not read it, and reads again', () => {
    const t = open(mr().id);
    t.give(undefined, { error: 'failed' });
    expect(screen.getByText(C.readFailed('glab', 'MR'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: C.retry }));
    expect(t.of('forge.detail')).toHaveLength(2);
  });

  it('sends a request too heavy to its forge', () => {
    const t = open(pr().id);
    t.give(undefined, { error: 'too_large' });
    expect(screen.getByText(C.tooLarge)).toBeTruthy();
    expect(screen.getByRole('link', { name: C.open }).getAttribute('href')).toBe(pr().url);
  });

  it('says a lightened detail is missing parts', () => {
    const t = open(pr().id);
    t.give(detail(), { cut: true });
    expect(screen.getByText(C.cut('GitHub'))).toBeTruthy();
  });

  it('says a request no longer followed', () => {
    open('github.com/acme/ledge#999');
    expect(screen.getByText(C.gone('PR', 'WSL'))).toBeTruthy();
  });
});

describe('merging a request', () => {
  const ready = () => detail(pr());
  /** Merge, then the sheet's checked button, the PC's challenge and the passkey. */
  async function merge(t: ReturnType<typeof open>) {
    fireEvent.click(screen.getByRole('button', { name: C.merge }));
    const sheet = screen.getByRole('dialog', { name: C.confirm('#231', 'main') });
    expect(within(sheet).getByText(ready().mergeCommand)).toBeTruthy();
    expect(within(sheet).getByText(C.headRead('a3f9c1e'))).toBeTruthy();
    vi.mocked(getAssertion).mockResolvedValue({ id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Fusionner avec/ }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver(CHALLENGE));
    await waitFor(() => expect(t.of('forge.act')).toHaveLength(1));
    return t.of('forge.act')[0]!;
  }

  it('asks the device\'s check over the head read, says it merges, then the receipt with the command', async () => {
    const t = open(pr().id);
    t.give(ready());
    const sent = await merge(t);
    expect(sent).toMatchObject({ prId: pr().id, action: { kind: 'merge', headSha: pr().headSha } });
    act(() => t.deliver({ type: 'operation.result', op: sent.op, status: 'received' } as PhoneServerMessage));
    expect(screen.getByText(`${C.merging} · ${C.answers('gh')}`)).toBeTruthy();
    expect((screen.getByRole('button', { name: C.merge }) as HTMLButtonElement).disabled).toBe(true);
    act(() => t.deliver({ type: 'forge.done', op: sent.op, ok: true, command: ready().mergeCommand }));
    expect(screen.getByText(C.merged('#231'))).toBeTruthy();
    expect(screen.getAllByText(ready().mergeCommand).length).toBeGreaterThan(0);
  });

  it('says the branch moved, with its new head, and reads it again', async () => {
    const t = open(pr().id);
    t.give(ready());
    const sent = await merge(t);
    const moved = pr({ headSha: '7d2e04b17d2e04b17d2e04b17d2e04b17d2e04b1' });
    act(() => t.deliver({ type: 'forge.state', ...forgeState({ prs: [moved] }) }));
    act(() => t.deliver({ type: 'forge.done', op: sent.op, ok: false, error: 'stale' }));
    expect(screen.getByText(C.stale('7d2e04b'))).toBeTruthy();
    const before = t.of('forge.detail').length;
    fireEvent.click(screen.getByRole('button', { name: C.reload }));
    expect(t.of('forge.detail').length).toBe(before + 1);
  });

  it('says what the forge refuses, and gh\'s last line on a failure', async () => {
    const t = open(pr().id);
    t.give(ready());
    const sent = await merge(t);
    act(() => t.deliver({ type: 'forge.done', op: sent.op, ok: false, error: 'failed', message: 'GraphQL: base branch requires signed commits' }));
    expect(screen.getByText(C.failed('gh'))).toBeTruthy();
    expect(screen.getByText('GraphQL: base branch requires signed commits')).toBeTruthy();
  });

  it('asks to protect the approvals first on a device without its check', () => {
    const t = open(pr().id, { confirm: false });
    t.give(ready());
    fireEvent.click(screen.getByRole('button', { name: C.merge }));
    expect(screen.getByText(copy.rigs.protectFirst)).toBeTruthy();
  });
});

describe('a failed pipeline', () => {
  const tom = session('s-tom', { name: 'Tom', tool: 'omp', repo: 'synapse' });
  const ada = session('s-ada', { name: 'Ada', tool: 'claude', repo: 'synapse' });
  const failing = (sessions = ['s-tom']) => mr({ sessions });

  it('reruns its failed jobs after the device\'s check, and says it is rerun', async () => {
    const t = open(mr().id, { sessions: [tom] });
    t.give(detail(mr(), { mergeBlockers: ['pipeline'] }));
    fireEvent.click(screen.getByRole('button', { name: C.rerun }));
    const sheet = screen.getByRole('dialog', { name: C.rerunTitle('!41') });
    expect(within(sheet).getByText(C.rerunBody('GitLab'))).toBeTruthy();
    vi.mocked(getAssertion).mockResolvedValue({ id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Relancer avec/ }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver(CHALLENGE));
    await waitFor(() => expect(t.of('forge.act')).toHaveLength(1));
    const sent = t.of('forge.act')[0]!;
    expect(sent.action).toEqual({ kind: 'rerun' });
    act(() => t.deliver({ type: 'forge.done', op: sent.op, ok: false, error: 'not_offered' }));
    expect(screen.getByText(C.nothingToRerun)).toBeTruthy();
  });

  it('shows no Rerun while the pipeline runs', () => {
    const running = mr({ pipeline: 'run' });
    const t = app('ready', { hash: at(running.id) });
    const snap = snapshot([], 'WSL') as Extract<PhoneServerMessage, { type: 'snapshot' }>;
    act(() => t.deliver({ ...snap, daemon: { ...snap.daemon, forge: true } }));
    act(() => t.deliver({ type: 'forge.state', ...forgeState({ prs: [running] }) }));
    expect(screen.queryByRole('button', { name: C.rerun })).toBeNull();
  });

  it('asks the branch\'s session to fix it, in its thread, with Desktop\'s text', () => {
    const t = open(failing().id, { sessions: [tom] });
    t.give(detail(failing()));
    fireEvent.click(screen.getByRole('button', { name: C.askFix('Tom') }));
    expect(t.of('session.reply')).toMatchObject([{ id: 's-tom', text: C.fixText('!41', 'test') }]);
    expect(screen.getByText(C.sentTo('Tom'))).toBeTruthy();
    expect(screen.getByRole('link', { name: C.openAgent('Tom') }).getAttribute('href')).toBe('#/thread/s-tom');
  });

  it('offers the branch\'s other sessions, the most active first', () => {
    const t = open(failing(['s-tom', 's-ada']).id, { sessions: [tom, ada] });
    act(() => t.deliver({ type: 'forge.state', ...forgeState({ prs: [failing(['s-tom', 's-ada']), pr()] }) }));
    t.give(detail(failing(['s-tom', 's-ada'])));
    fireEvent.click(screen.getByRole('button', { name: C.otherSession }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map(i => i.textContent)).toEqual([`Tom omp · synapse${C.mostActive}`.replace('omp', 'OMP'), 'Ada Claude Code · synapse']);
    fireEvent.click(items[1]!);
    fireEvent.click(screen.getByRole('button', { name: C.askFix('Ada') }));
    expect(t.of('session.reply')[0]?.id).toBe('s-ada');
  });

  it('says nobody works on the branch', () => {
    const t = open(failing().id);
    t.give(detail(failing()));
    expect(screen.getByText(C.noSession('fix/s3-timeout'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Demander à/ })).toBeNull();
  });
});

describe('a request\'s discussion', () => {
  const front = session('s-front', { name: 'Front', repo: 'ledge' });
  const AT = '2026-11-10T10:05:00.000Z';
  const threads: PrDetail['threads'] = [
    { id: 't1', resolvable: true, resolved: false, file: 'term/Term.tsx', line: 88, code: '+ term.loadAddon(new WebglAddon());', comments: [
      { id: 'c1', author: 'reviewer', at: AT, body: 'Le WebglAddon n\'est pas libéré.' }, { id: 'c2', author: 'dev-front', at: AT, body: 'Exact.' }
    ] },
    { id: 't2', resolvable: false, resolved: false, comments: [{ id: 'c3', author: 'lead', at: AT, body: 'Ajoute un test.' }] },
    { id: 't3', resolvable: true, resolved: true, file: 'term/copy.ts', line: 12, comments: [{ id: 'c4', author: 'reviewer', at: AT, body: 'ok' }] }
  ];
  const signed = () => vi.mocked(getAssertion).mockResolvedValue({ id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' });
  /** The request on its Discussion view, the branch's session known. */
  function discussion(extra: Partial<PrDetail> = {}) {
    const t = open(pr().id, { sessions: [front] });
    t.give(detail(pr(), { threads, ...extra }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${C.tabs.discussion}\\s*\\d+$`) }));
    return t;
  }
  /** The checked button, the PC's challenge, the passkey: the `forge.act` sent. */
  async function check(t: ReturnType<typeof open>, verb: RegExp) {
    signed();
    fireEvent.click(screen.getByRole('button', { name: verb }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver(CHALLENGE));
    await waitFor(() => expect(t.of('forge.act')).toHaveLength(1));
    return t.of('forge.act')[0]!;
  }

  it('shows the open threads with their line, a comment on the request without Résoudre, the resolved folded', () => {
    discussion();
    expect(screen.getByText(C.discSub(2, 1))).toBeTruthy();
    const review = document.querySelector('[data-thread="t1"]') as HTMLElement;
    expect(within(review).getByText(C.fileLine('term/Term.tsx', 88))).toBeTruthy();
    expect(within(review).getByText('+ term.loadAddon(new WebglAddon());')).toBeTruthy();
    expect(within(review).getByRole('button', { name: C.resolve })).toBeTruthy();
    const comment = document.querySelector('[data-thread="t2"]') as HTMLElement;
    expect(within(comment).queryByRole('button', { name: C.resolve })).toBeNull();
    expect(within(comment).getByRole('button', { name: C.sendTo('Front') })).toBeTruthy();
    const folded = screen.getByRole('button', { name: C.resolvedRow([C.fileLine('term/copy.ts', 12), 'reviewer']) });
    expect(folded.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByPlaceholderText(C.addComment)).toBeTruthy();
    expect(screen.queryByRole('button', { name: C.merge })).toBeNull();
  });

  it('sends one thread, or all the open ones, to the branch\'s session in Desktop\'s words', () => {
    const t = discussion();
    fireEvent.click(within(document.querySelector('[data-thread="t1"]') as HTMLElement).getByRole('button', { name: C.sendTo('Front') }));
    expect(t.of('session.reply')[0]).toMatchObject({ id: 's-front', text: C.threadText('#231', 'reviewer', C.fileLine('term/Term.tsx', 88), 'Le WebglAddon n\'est pas libéré.') });
    // One reply to a session at a time (the thread's rule): the second goes once the PC applied the first.
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.reply')[0]!.op, status: 'applied' } as PhoneServerMessage));
    fireEvent.click(screen.getByRole('button', { name: C.sendAll('Front') }));
    expect(t.of('session.reply')[1]?.text).toBe(C.notesText('#231', [C.note('reviewer', C.fileLine('term/Term.tsx', 88), 'Le WebglAddon n\'est pas libéré.'), C.note('lead', null, 'Ajoute un test.')]));
    expect(screen.getAllByText(C.commentSent('Front')).length).toBe(2);
    expect(screen.getAllByRole('link', { name: C.openAgent('Front') })[0]!.getAttribute('href')).toBe('#/thread/s-front');
  });

  it('replies in a thread after the device\'s check over the exact text, then says it is posted', async () => {
    const t = discussion();
    fireEvent.click(within(document.querySelector('[data-thread="t1"]') as HTMLElement).getByRole('button', { name: C.reply }));
    fireEvent.change(screen.getByPlaceholderText(C.replyPh), { target: { value: 'Bien, fusionne quand le test est là.' } });
    expect(screen.getByText(C.postedAs('GitHub'))).toBeTruthy();
    const sent = await check(t, /^Répondre avec/);
    expect(sent.action).toEqual({ kind: 'reply', threadId: 't1', body: 'Bien, fusionne quand le test est là.' });
    act(() => t.deliver({ type: 'forge.done', op: sent.op, ok: true }));
    expect(screen.getByText(C.replyPosted('GitHub'))).toBeTruthy();
    expect(screen.queryByPlaceholderText(C.replyPh)).toBeNull();
  });

  it('keeps a reply not posted in its field, and says why', async () => {
    const t = discussion();
    fireEvent.click(within(document.querySelector('[data-thread="t1"]') as HTMLElement).getByRole('button', { name: C.reply }));
    fireEvent.change(screen.getByPlaceholderText(C.replyPh), { target: { value: 'Bien.' } });
    const sent = await check(t, /^Répondre avec/);
    act(() => t.deliver({ type: 'forge.done', op: sent.op, ok: false, error: 'failed', message: 'HTTP 422' }));
    expect(screen.getByText(`${copy.rigs.because(C.notDone.reply, C.lastLine('gh'))} ${C.keptText}`)).toBeTruthy();
    expect((screen.getByPlaceholderText(C.replyPh) as HTMLTextAreaElement).value).toBe('Bien.');
  });

  it('resolves a thread after the check, and says gh\'s last line when it fails', async () => {
    const t = discussion();
    const sent = await check(t, new RegExp(`^${C.resolve}$`));
    expect(sent.action).toEqual({ kind: 'resolve', threadId: 't1' });
    act(() => t.deliver({ type: 'forge.done', op: sent.op, ok: false, error: 'failed', message: 'Resource not accessible by integration' }));
    expect(screen.getByText(copy.rigs.because(C.notDone.resolve, C.lastLine('gh')))).toBeTruthy();
    expect(screen.getByText('Resource not accessible by integration')).toBeTruthy();
  });

  it('posts a comment from the footer, and clears it once posted', async () => {
    const t = discussion();
    fireEvent.change(screen.getByPlaceholderText(C.addComment), { target: { value: 'LGTM' } });
    const sent = await check(t, /^Publier avec/);
    expect(sent.action).toEqual({ kind: 'comment', body: 'LGTM' });
    act(() => t.deliver({ type: 'forge.done', op: sent.op, ok: true }));
    expect(screen.getByText(C.commentPosted('GitHub'))).toBeTruthy();
    expect((screen.getByPlaceholderText(C.addComment) as HTMLTextAreaElement).value).toBe('');
  });

  it('says there is no comment', () => {
    discussion({ threads: [] });
    expect(screen.getByText(C.noComment)).toBeTruthy();
  });
});
