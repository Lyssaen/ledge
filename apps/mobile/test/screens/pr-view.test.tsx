// A request of the MR/PR tab (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html, §3 and §8): its head, the pipeline and the failed job's
// log, « Pour fusionner », the details, the footer, and the detail's states.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PhoneServerMessage, PrDetail } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { detail, forgeState, mr, pr } from '../model/forge-fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

const C = copy.prs;
const at = (id: string) => `#/prs/${encodeURIComponent(id)}`;

/** The app on a request, its PC sending its requests, the list delivered. */
function open(id: string) {
  const t = app('ready', { hash: at(id) });
  const snap = snapshot([], 'WSL') as Extract<PhoneServerMessage, { type: 'snapshot' }>;
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
