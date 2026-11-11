// The MR/PR tab (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html, §1 and §2): the list of the PC's requests on the whole app with a PC
// that sends them (`daemon.forge`), its forges' strips, and the tab's red badge.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PhoneForgeState, PhoneServerMessage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { clock } from '../../src/screens/Inbox';
import { forgeState, mr, pr } from '../model/forge-fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

const C = copy.prs;
const AT = '2026-11-11T14:12:00.000Z';

/** The app at `hash`, its PC sending its requests (or not), and `state` once asked. */
function open(hash: string, o: { forge?: boolean; state?: Partial<PhoneForgeState> | false } = {}) {
  const t = app('ready', { hash });
  const snap = snapshot([], 'WSL') as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  act(() => t.deliver(o.forge === false ? snap : { ...snap, daemon: { ...snap.daemon, forge: true } }));
  if (o.forge !== false && o.state !== false) act(() => t.deliver({ type: 'forge.state', ...forgeState(o.state || {}) }));
  return t;
}

const badge = () => within(screen.getByRole('navigation', { name: copy.nav.label })).getAllByRole('link')[2]!.querySelector('[data-badge]');

describe('the MR/PR list', () => {
  it('says the PC does not send its requests yet, as before, and asks nothing', () => {
    const t = open('#/prs', { forge: false });
    expect(t.of('forge.state')).toHaveLength(0);
    expect(screen.getByText(C.notSent('WSL'))).toBeTruthy();
  });

  it('asks the requests once, and shows the open ones newest first, each opening its request', () => {
    const t = open('#/prs');
    expect(t.of('forge.state')).toHaveLength(1);
    const list = screen.getByRole('region', { name: C.title });
    const rows = within(list).getAllByRole('link');
    expect(rows.map(r => r.getAttribute('href'))).toEqual([`#/prs/${encodeURIComponent(mr().id)}`, `#/prs/${encodeURIComponent(pr().id)}`]);
    expect(screen.getByText(C.openHead(2))).toBeTruthy();
    expect(within(rows[0]!).getByText(C.pipeline.fail)).toBeTruthy();
    expect(within(rows[0]!).getByText(C.threads(1))).toBeTruthy();
    expect(within(rows[1]!).getByText(C.ready)).toBeTruthy();
    expect(within(rows[1]!).queryByText(C.threads(0))).toBeNull();
  });

  it('badges the tab in red with the failed pipelines, and not without one', () => {
    const t = open('#/atoi');
    expect(badge()?.textContent).toBe('1');
    expect(badge()?.getAttribute('data-badge')).toBe('red');
    act(() => t.deliver({ type: 'forge.state', ...forgeState({ prs: [pr()] }) }));
    expect(badge()).toBeNull();
  });

  it('folds the merged and closed requests at the bottom', () => {
    open('#/prs', { state: { prs: [pr(), mr({ state: 'merged', pipeline: 'ok' })] } });
    const fold = screen.getByRole('button', { name: C.closedGroup(1) });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(mr().title)).toBeNull();
    fireEvent.click(fold);
    expect(screen.getByText(mr().title)).toBeTruthy();
  });

  it('says when no request is open', () => {
    open('#/prs', { state: { prs: [] } });
    expect(screen.getByText(C.emptyTitle)).toBeTruthy();
    expect(screen.getByText(C.emptyBody)).toBeTruthy();
  });
});

describe('a forge the PC cannot read', () => {
  it('says glab is not installed, for a followed GitLab session (decision 35)', () => {
    open('#/prs', {
      state: {
        prs: [pr()],
        forges: [{ forge: 'github', host: 'github.com', status: 'ok', at: AT }, { forge: 'gitlab', host: 'gitlab.acme.dev', status: 'missing', at: AT }]
      }
    });
    const strip = screen.getByText(C.missing('glab', 'WSL', 'gitlab.acme.dev', 'MR'));
    expect(strip.getAttribute('data-forge-strip')).toBe('missing');
  });

  it('gives the sign-in command of a CLI not signed in', () => {
    open('#/prs', { state: { forges: [{ forge: 'gitlab', host: 'gitlab.acme.dev', status: 'unauthenticated', at: AT }, { forge: 'github', host: 'github.com', status: 'ok', at: AT }] } });
    expect(screen.getByText(C.unauth('glab', 'gitlab.acme.dev', 'WSL'))).toBeTruthy();
    expect(screen.getByText('glab auth login --hostname gitlab.acme.dev')).toBeTruthy();
    expect(screen.getByRole('button', { name: C.copy })).toBeTruthy();
  });

  it('says since when the reads fail, and its requests as last read', () => {
    const since = '2026-11-11T10:42:00.000Z';
    const read = '2026-11-11T10:30:00.000Z';
    open('#/prs', { state: { forges: [{ forge: 'github', host: 'github.com', status: 'ok', at: AT }, { forge: 'gitlab', host: 'gitlab.acme.dev', status: 'error', at: AT, since, readAt: read }] } });
    expect(screen.getByText(C.error('GitLab', 'WSL', clock(since)))).toBeTruthy();
    const row = within(screen.getByRole('region', { name: C.title })).getAllByRole('link')[0]!;
    expect(within(row).getByText(new RegExp(C.asOf(clock(read))))).toBeTruthy();
    expect(within(row).queryByText(C.threads(1))).toBeNull();
  });

  it('says no forge can be read when none can', () => {
    open('#/prs', { state: { prs: [], forges: [{ forge: 'gitlab', host: 'gitlab.acme.dev', status: 'missing', at: AT }] } });
    expect(screen.getByText(C.emptyUnread)).toBeTruthy();
  });
});
