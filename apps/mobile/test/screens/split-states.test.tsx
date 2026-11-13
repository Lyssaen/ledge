// The two panes' own states on a wide screen (docs/mockups/ledge-mobile-refonte/t-tablette.html, §5 and §6): a list with nothing to
// choose joins both panes (Q94 B, styles.css reads the marks below); a PC that does not answer puts one banner across both (Q95 A).
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PhoneServerMessage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { session } from '../model/fixtures';
import { forgeState } from '../model/forge-fixtures';
import { openrig } from '../model/openrig-fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
afterEach(() => { wide(false); });

/** The app at `hash` on a wide screen, its PC sending its sessions, rigs and requests. */
function open(hash: string, sessions: Parameters<typeof snapshot>[0] = []) {
  wide(true);
  const t = app('ready', { hash });
  const snap = snapshot(sessions, 'WSL') as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  const ready = () => act(() => t.deliver({ ...snap, daemon: { ...snap.daemon, rigs: true, forge: true } }));
  return { ...t, ready };
}
const listState = () => document.querySelector('.split-list [data-list-state]');
const emptyDetail = () => document.querySelector('.split-detail > [data-split-empty]');
const head = () => document.querySelector('.split-list .pane-head') as HTMLElement;

describe('a list with nothing to choose, in two panes (Q94 B)', () => {
  it('says it is connecting in the list\'s head and marks its skeleton, until the PC\'s first state', () => {
    const t = open('#/sessions');
    expect(within(head()).getByText(copy.link.connecting(copy.host.unknown))).toBeTruthy();
    expect(head().querySelector('[data-host]')).toBeNull();
    expect(listState()).toBeTruthy();
    expect(emptyDetail()).toBeTruthy();
    t.ready();
    expect(within(head()).queryByText(copy.link.connecting(copy.host.unknown))).toBeNull();
    expect(head().querySelector('[data-host]')).toBeTruthy();
  });

  it('marks an empty list of sessions, not one that has sessions', () => {
    open('#/sessions').ready();
    expect(listState()).toBeTruthy();
    const t = open('#/sessions', [session('s1', { name: 'Front' })]);
    t.ready();
    expect(document.querySelectorAll('.split-list [data-list-state]')).toHaveLength(1);
  });

  it('marks the MR/PR list while it reads, then empty, and not once it lists a request', () => {
    const t = open('#/prs');
    t.ready();
    expect(listState()?.getAttribute('role')).toBe('status');
    act(() => t.deliver({ type: 'forge.state', ...forgeState({ prs: [] }) }));
    expect(screen.getByText(copy.prs.emptyTitle)).toBeTruthy();
    expect(listState()).toBeTruthy();
    act(() => t.deliver({ type: 'forge.state', ...forgeState() }));
    expect(listState()).toBeNull();
    expect(emptyDetail()).toBeTruthy();
  });

  it('marks the Rigs list while OpenRig is read and when it has no rig', () => {
    const t = open('#/rigs');
    t.ready();
    expect(listState()).toBeTruthy();
    act(() => t.deliver({ type: 'rigs.state', state: openrig() }));
    expect(listState()).toBeNull();
    act(() => t.deliver({ type: 'rigs.state', state: { ...openrig(), rigs: [] } }));
    expect(screen.getByText(copy.rigs.empty.title)).toBeTruthy();
    expect(listState()).toBeTruthy();
  });

  it('marks À toi with nothing to decide and nobody at work', () => {
    open('#/').ready();
    expect(screen.getByText(copy.atoi.noRequest, { selector: 'h2' })).toBeTruthy();
    expect(listState()).toBeTruthy();
    expect(emptyDetail()).toBeTruthy();
  });
});

describe('a PC that does not answer, in two panes (Q95 A)', () => {
  it('puts one banner across both panes, and the list says its last known state under its title', () => {
    const t = open('#/rigs/ledge-dev');
    t.ready();
    act(() => t.deliver({ type: 'rigs.state', state: openrig() }));
    act(() => t.set('pc_offline'));
    const strips = document.querySelectorAll('[data-strip]');
    expect(strips).toHaveLength(1);
    expect(strips[0]!.parentElement?.className).toBe('split-banner');
    expect(within(strips[0] as HTMLElement).getByText(copy.offline.title('WSL'))).toBeTruthy();
    expect(within(head()).getByText(/^Dernier état connu · \d\d:\d\d$/)).toBeTruthy();
    expect(head().querySelector('[data-host="offline"]')).toBeTruthy();
  });

  it('keeps the phone\'s banner in its tab', () => {
    wide(false);
    const t = app('ready', { hash: '#/sessions' });
    act(() => t.deliver(snapshot([session('s1', { name: 'Front' })], 'WSL')));
    act(() => t.set('pc_offline'));
    expect(document.querySelector('.split-banner')).toBeNull();
    expect(document.querySelector('main [data-strip="pc"]')).toBeTruthy();
  });
});
