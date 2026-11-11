import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PhoneForgeState, PhoneServerMessage } from '@ledge/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../../src/copy';
import { Inbox } from '../../src/screens/Inbox';
import { atoiSub, CHIP_TOAST_MS } from '../../src/screens/prs/forgeMarks';
import { Thread } from '../../src/screens/Thread';
import type { ForgeStore } from '../../src/state/forge';
import { session } from '../model/fixtures';
import { forgeState, mr, pr } from '../model/forge-fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const AT = '2026-11-11T14:12:00.000Z';
const TIP = 'GitLab ne se lit pas sur WSL : Ledge ne sait pas si cette branche a une MR.';

/** A forge store holding `s`, as the app's would after its `forge.state`. */
const forgeOf = (s: PhoneForgeState | null): ForgeStore => {
  const held = { state: s, at: AT, loading: false, details: {}, runs: [], drafts: {} };
  return { getState: () => held, subscribe: () => () => undefined } as unknown as ForgeStore;
};

const SESSIONS = [
  session('s-front', { name: 'dev-front', branch: 'feat/detached' }),
  session('s-tom', { name: 'Tom', branch: 'fix/s3-timeout' }),
  session('s-glab', { name: 'Gil', branch: 'fix/glab-proxy' }),
  session('s-none', { name: 'Nia', branch: 'feat/new-idea' })
];

function opened(forgeOn = true) {
  const t = setup();
  const snap = snapshot(SESSIONS, 'WSL');
  if (snap.type === 'snapshot' && forgeOn) snap.daemon = { ...snap.daemon, forge: true };
  t.deliver(snap as PhoneServerMessage);
  return t;
}

const section = () => screen.queryByRole('region', { name: 'MR et PR' });

afterEach(() => setLang('fr'));

describe('À toi › MR et PR (M5 §9)', () => {
  it('lists the failed pipelines first, then the requests ready to merge, each opening in the MR/PR tab', () => {
    const t = opened();
    const state = forgeState({ prs: [pr(), mr(), pr({ id: 'github.com/acme/ledge#229', number: 229, ref: '#229', title: 'IDE lot 6', pipeline: 'none', sessions: [] })] });
    render(<Inbox store={t.store} forge={forgeOf(state)} />);
    const rows = within(section()!).getAllByRole('link');
    expect(rows.map(r => r.textContent)).toEqual([
      '!41 Worker : relance sur délai S3GitLab · synapse · pipeline échoué · Tom',
      '#231 Lot 9 : fenêtres détachéesGitHub · ledge · pipeline réussi, approuvée',
      '#229 IDE lot 6GitHub · ledge · sans CI, approuvée'
    ]);
    expect(rows[0]).toHaveAttribute('href', '#/prs/gitlab.acme.dev%2Fteam%2Fsynapse%2341');
    expect(screen.getByRole('heading', { name: /MR et PR/ })).toHaveTextContent('pipelines échoués, prêtes à fusionner');
  });

  it('is not shown when nothing waits there: a running pipeline, a draft, an unapproved request', () => {
    const t = opened();
    const state = forgeState({ prs: [pr({ pipeline: 'run' }), pr({ id: 'x#2', state: 'draft' }), pr({ id: 'x#3', mergeable: false })] });
    render(<Inbox store={t.store} forge={forgeOf(state)} />);
    expect(section()).toBeNull();
  });

  it('is not shown before the PC sends its requests, nor without a store', () => {
    const t = opened(false);
    render(<Inbox store={t.store} forge={forgeOf(forgeState())} />);
    expect(section()).toBeNull();
    const u = opened();
    render(<Inbox store={u.store} />);
    expect(section()).toBeNull();
  });

  it('offline, says when the list was read instead of the repository', () => {
    expect(atoiSub(mr(), 'fail', 'Tom', AT)).toMatch(/^GitLab · pipeline échoué · relevé \d{2}:\d{2}$/);
  });

  it('speaks English', () => {
    setLang('en');
    const t = opened();
    render(<Inbox store={t.store} forge={forgeOf(forgeState())} />);
    const rows = within(screen.getByRole('region', { name: 'MR and PR' })).getAllByRole('link');
    expect(rows[1]).toHaveTextContent('GitHub · ledge · pipeline passed, approved');
  });
});

describe('the request chip of a session\'s foot (M5 §9, Q60)', () => {
  const unread = forgeState({
    followed: [...forgeState().followed, { session: 's-glab', forge: 'gitlab', host: 'gitlab.acme.dev', repo: 'team/proxy' }],
    forges: [{ forge: 'github', host: 'github.com', status: 'ok', at: AT }, { forge: 'gitlab', host: 'gitlab.acme.dev', status: 'unauthenticated', at: AT }],
    prs: [pr({ pipeline: 'run' })]
  });
  const foot = (id: string, state = forgeState(), forgeOn = true) => {
    const t = opened(forgeOn);
    render(<Thread store={t.store} sessionId={id} storage={t.storage} forge={forgeOf(state)} />);
    return document.querySelector('footer[aria-label]') as HTMLElement;
  };

  it('shows the branch\'s open request with its pipeline\'s dot, a tap opening it', () => {
    const chip = within(foot('s-front', unread)).getByRole('link', { name: '#231' });
    expect(chip).toHaveAttribute('href', '#/prs/github.com%2Facme%2Fledge%23231');
    expect(chip.querySelector('[data-dot]')).toHaveAttribute('data-dot', 'work');
  });

  it('says « MR ? » when the forge of its repository cannot be read, with Desktop\'s sentence', () => {
    const chip = within(foot('s-glab', unread)).getByRole('button', { name: TIP });
    expect(chip).toHaveTextContent('MR ?');
    expect(chip).toHaveAttribute('title', TIP);
  });

  it('says that sentence in a toast on a tap, alone, until 4 s or the next tap (Q91)', () => {
    vi.useFakeTimers();
    try {
      const chip = within(foot('s-glab', unread)).getByRole('button', { name: TIP });
      fireEvent.click(chip);
      const toast = () => document.querySelector('[data-chip-toast]');
      expect(toast()).toHaveAttribute('role', 'status');
      expect(toast()).toHaveTextContent(TIP);
      expect(within(toast() as HTMLElement).queryByRole('button')).toBeNull();
      act(() => { vi.advanceTimersByTime(CHIP_TOAST_MS); });
      expect(toast()).toBeNull();
      fireEvent.click(chip);
      expect(toast()).not.toBeNull();
      fireEvent.pointerDown(document.body);
      expect(toast()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('has no chip without a request, nor before the PC sends its requests', () => {
    expect(foot('s-none').querySelector('[data-pr-chip]')).toBeNull();
    expect(foot('s-front', forgeState(), false).querySelector('[data-pr-chip]')).toBeNull();
  });
});
