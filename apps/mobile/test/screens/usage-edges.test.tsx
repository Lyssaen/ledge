// review-qa's reproductions (review of 39e21fa2, P2-a and P2-b), kept as guards with the expected behaviour.
import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import type { PhoneHarnessUsage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { overWindows, shownUsage } from '../../src/model/usage';
import { Chat } from '../../src/screens/Chat';
import { Limits } from '../../src/ui/chat/Limits';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe('usage edges', () => {
  it('a first read that failed says it, without an age (a state the mockup did not draw)', () => {
    const { container } = render(<Limits usage={[{ harness: 'claude', status: 'unreachable', readAt: null, windows: [] }]} now={Date.now()} alert={0.8} />);
    expect(container.textContent).toBe(`LIMITESClaude Code${copy.chat.point.unreachNever}`);
  });

  it('values over an hour old: no window drawn, no « À toi » line (M9)', () => {
    const usage: PhoneHarnessUsage[] = [{ harness: 'claude', status: 'ok', readAt: ago(120), windows: [{ kind: 'five_hour', pct: 100, resetsAt: null }] }];
    expect(overWindows(usage, 0.8)).toHaveLength(0);
    const { container } = render(<Limits usage={usage} now={Date.now()} alert={0.8} />);
    expect(container.textContent).not.toContain('100 %');
  });

  it('the link lost: « ok » reads as old, dimmed with its age; « À toi » says nothing from it', () => {
    const usage: PhoneHarnessUsage[] = [{ harness: 'claude', status: 'ok', readAt: ago(12), windows: [{ kind: 'five_hour', pct: 100, resetsAt: null }] }];
    expect(shownUsage(usage, Date.now(), false)[0]!.status).toBe('stale');
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'Bix', repo: 'ledge' })], 'Atelier', undefined, { confirm: true, chat: true as const }));
    t.deliver({ type: 'usage.state', harnesses: usage, prefs: { alert: 0.8 } });
    t.set('pc_offline');
    const { getByRole } = render(<Chat store={t.store} />);
    const region = getByRole('region', { name: copy.chat.point.label });
    const limits = within(region).getByRole('group', { name: copy.chat.point.limitsLabel });
    expect(limits.textContent).toContain(copy.chat.point.stale('12 min'));
    expect(limits.querySelector('.opacity-50')).not.toBeNull();
    expect(region.querySelectorAll('[data-usage-over]')).toHaveLength(0);
  });

  it.each([['stale', 12, copy.chat.point.stale('12 min')], ['unreachable', 25, copy.chat.point.unreach('25 min')]] as const)('Cursor %s: its rows dimmed, with the message', (status, min, text) => {
    const usage: PhoneHarnessUsage[] = [{ harness: 'cursor', status, readAt: ago(min), windows: [{ kind: 'month', pct: 40, resetsAt: null }, { kind: 'pool', pool: 'other', pct: 20, resetsAt: null }] }];
    const { container } = render(<Limits usage={usage} now={Date.now()} alert={0.8} />);
    expect(container.querySelector('.opacity-50')?.textContent).toContain('Autres');
    expect(container.textContent).toContain(text);
  });
});
