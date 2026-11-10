import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HumanAsk, PhoneServerMessage } from '@ledge/protocol';
import { copy, setLang } from '../../src/copy';
import { ageLabel, headline, type InboxItem } from '../../src/model/requests';
import { forgetTabs } from '../../src/shell/tabs';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { app } from '../screens/app-setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

afterEach(() => { setLang('fr'); localStorage.clear(); forgetTabs(); });

const ask = (id: string, kind: HumanAsk['kind']): HumanAsk => ({
  id, kind, alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: null }, summary: id, body: '', bodyTruncated: false,
  detail: null, evidenceRef: null, questions: [], createdAt: '2026-11-10T19:00:00Z', updatedAt: '2026-11-10T19:00:00Z'
});
const withOpenRig = (m: PhoneServerMessage) => ({ ...m, daemon: { ...(m as { daemon: object }).daemon, openrig: true } }) as PhoneServerMessage;
const atoiTab = () => within(screen.getByRole('navigation', { name: copy.nav.label })).getByRole('link', { name: new RegExp(`^${copy.nav.atoi}`) });

describe('M0 review (qitem-20261110200447-63090a55)', () => {
  it('asks OpenRig\'s asks of a PC that answers them, and counts its decisions and parked rows in À toi\'s amber badge', () => {
    const t = app('ready', { hash: '#/' });
    act(() => t.deliver(withOpenRig(snapshot([], 'PC-Desan'))));
    expect(t.of('openrig.asks')).toHaveLength(1);
    act(() => t.deliver({ type: 'openrig.asks', channel: { state: 'ready', person: null, slack: false }, asks: [ask('q1', 'decision'), ask('q2', 'parked'), ask('q3', 'update')] }));
    expect(within(atoiTab()).getByText('2')).toHaveAttribute('data-badge', 'amber');
  });

  it('does not ask a PC that does not answer them', () => {
    const t = app('ready', { hash: '#/' });
    act(() => t.deliver(snapshot([], 'PC-Desan')));
    expect(t.of('openrig.asks')).toHaveLength(0);
  });

  it('keeps the five tabs under a thread on a phone, Sessions lit', () => {
    const t = app('ready', { hash: '#/thread/s1' });
    act(() => t.deliver(snapshot([session('s1', { name: 'Pim' })], 'PC-Desan')));
    const nav = screen.getByRole('navigation', { name: copy.nav.label });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    expect(within(nav).getByRole('link', { name: copy.nav.sessions })).toHaveAttribute('aria-current', 'page');
  });

  it('says a request\'s headline and age in the language shown', () => {
    const plan = { kind: 'plan', text: '' } as unknown as InboxItem;
    const diff = { kind: 'diff', text: 'src/a.ts' } as unknown as InboxItem;
    const now = Date.parse('2026-11-10T00:00:00Z');
    expect(headline(plan)).toBe('Plan à valider');
    expect(ageLabel('2026-11-07T00:00:00Z', now)).toBe('3 j');
    setLang('en');
    expect(headline(plan)).toBe('Plan to approve');
    expect(headline(diff)).toBe('Edit src/a.ts');
    expect(ageLabel('2026-11-07T00:00:00Z', now)).toBe('3 d');
  });
});
