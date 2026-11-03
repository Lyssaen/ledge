import { describe, expect, it } from 'vitest';
import type { NotchActivity } from '@ledge/protocol';
import { hoverLine, initialLine, lineView, nextDeadline, pushLine, QUIET_WAKE_MS, tickLine, WAKE_MS, type LineState, type NotchLine } from '../src/notch/line';

const at = '2026-11-02T19:00:00.000Z';
const message: NotchActivity = { kind: 'message', session: 'otto', at, direction: 'out', counterpart: 'nova', peer: 'nova', summary: 'Maquette validée' };
const notification: NotchActivity = { kind: 'notification', session: 'pim', at, reason: 'permission', text: 'pnpm test' };
const finished: NotchActivity = { kind: 'notification', session: 'otto', at, reason: 'finished' };
const tool: NotchActivity = { kind: 'tool', session: 'otto', at, tool: 'Edit', label: 'Edit src/a.ts' };
const thinking: NotchActivity = { kind: 'thinking', session: 'nova', at };
const track: NotchLine = { kind: 'track', title: 'Sous la verrière', artist: 'Halles 72' };

/** Ticks the state at every deadline up to `to`, as the hook would. */
function runTo(s: LineState, to: number): LineState {
  for (let d = nextDeadline(s); d !== null && d <= to; d = nextDeadline(s)) s = tickLine(s, d);
  return tickLine(s, to);
}

describe('the notch activity line', () => {
  it('a message wakes the notch for 5 s, then it sleeps and keeps the line for the hover', () => {
    let s = pushLine(initialLine(0), message, 1000);
    expect(lineView(s)).toMatchObject({ awake: true, line: message, aged: false });
    s = runTo(s, 1000 + WAKE_MS - 1);
    expect(lineView(s).awake).toBe(true);
    s = runTo(s, 1000 + WAKE_MS);
    expect(lineView(s)).toMatchObject({ awake: false, line: message, aged: true, seenAt: 1000 });
  });

  it('an action wakes only a notch asleep for at least 20 s', () => {
    const early = pushLine(initialLine(0), tool, QUIET_WAKE_MS - 1);
    expect(lineView(early)).toMatchObject({ awake: false, line: tool });
    const late = pushLine(initialLine(0), thinking, QUIET_WAKE_MS);
    expect(lineView(late).awake).toBe(true);
  });

  it('awake, an action replaces the line without prolonging the 5 s', () => {
    let s = pushLine(initialLine(0), finished, 1000);
    s = runTo(s, 4000);
    s = pushLine(s, tool, 4000);
    expect(lineView(s).line).toBe(tool);
    expect(s.awakeUntil).toBe(1000 + WAKE_MS);
  });

  it('a message keeps the line 3 s: an action meanwhile is ignored, a notification waits then shows', () => {
    let s = pushLine(initialLine(0), message, 1000);
    s = pushLine(s, tool, 1500);
    expect(lineView(s).line).toBe(message);
    s = pushLine(s, notification, 2000);
    expect(lineView(s).line).toBe(message);
    s = runTo(s, 4000);
    expect(lineView(s).line).toBe(notification);
    // The notification is a waker: the 5 s count again from it.
    expect(s.awakeUntil).toBe(4000 + WAKE_MS);
  });

  it('a waiting notification older than 5 s is dropped', () => {
    let s = pushLine(initialLine(0), message, 1000);
    s = pushLine(s, notification, 1100);
    s = pushLine(s, { ...message, summary: 'encore' }, 3900);
    s = runTo(s, 6900);
    expect((lineView(s).line as NotchActivity).kind).toBe('message');
  });

  it('a message during a message replaces it; a track during a message is ignored', () => {
    let s = pushLine(initialLine(0), message, 1000);
    const other = { ...message, summary: 'Autre' };
    s = pushLine(s, other, 1200);
    expect(lineView(s).line).toBe(other);
    s = pushLine(s, track, 1400);
    expect(lineView(s).line).toBe(other);
    expect(s.trackKey).toBe(0);
  });

  it('collision: track, then a message 1.5 s later takes the line, an action at 2.4 s is ignored, asleep by 6.5 s', () => {
    let s = pushLine(initialLine(0), track, 0 + QUIET_WAKE_MS);
    const t0 = QUIET_WAKE_MS;
    expect(s.trackKey).toBe(1);
    s = pushLine(runTo(s, t0 + 1500), message, t0 + 1500);
    expect(lineView(s).line).toBe(message);
    s = pushLine(runTo(s, t0 + 2400), tool, t0 + 2400);
    expect(lineView(s).line).toBe(message);
    s = runTo(s, t0 + 6500);
    expect(lineView(s).awake).toBe(false);
  });

  it('an action behind a track waits out its 1.2 s', () => {
    let s = pushLine(initialLine(0), track, 1000);
    s = pushLine(s, tool, 1500);
    expect(lineView(s).line).toBe(track);
    s = runTo(s, 2200);
    expect(lineView(s).line).toBe(tool);
    expect(s.awakeUntil).toBe(1000 + WAKE_MS);
  });

  it('the hover holds the notch awake; leaving restarts the 5 s', () => {
    let s = pushLine(initialLine(0), message, 1000);
    s = hoverLine(s, true, 2000);
    s = runTo(s, 20_000);
    expect(lineView(s).awake).toBe(true);
    s = hoverLine(s, false, 20_000);
    s = runTo(s, 20_000 + WAKE_MS - 1);
    expect(lineView(s).awake).toBe(true);
    s = runTo(s, 20_000 + WAKE_MS);
    expect(lineView(s).awake).toBe(false);
  });

  it('Do not disturb: only a permission or a question wakes it; the rest still updates the line', () => {
    let s = pushLine(initialLine(0), message, 1000, true);
    expect(lineView(s)).toMatchObject({ awake: false, line: message });
    s = pushLine(s, finished, 1200, true);
    expect(lineView(s).awake).toBe(false);
    s = pushLine(s, notification, 1400, true);
    expect(lineView(s)).toMatchObject({ awake: true, line: notification });
    s = pushLine(s, { ...notification, reason: 'question' }, 99_000, true);
    expect(lineView(s).awake).toBe(true);
  });

  it('asleep, nothing is held: any line replaces the last one', () => {
    let s = pushLine(initialLine(0), message, 1000, true);
    s = pushLine(s, tool, 1100, true);
    expect(lineView(s).line).toBe(tool);
  });
});
