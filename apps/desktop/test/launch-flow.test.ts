import { describe, expect, it } from 'vitest';
import { START, step, type Flow, type FlowEvent } from '../src/launch/flow';
import type { LaunchRequest } from '../src/launch/form';

const req: LaunchRequest = { machine: 'devbox', tool: 'codex', cwd: '~/w/api', prompt: 'Run the tests' };
const run = (events: FlowEvent[], from: Flow = START) => events.reduce((f, e) => step(f, e).flow, from);
const starting = run([{ type: 'open' }, { type: 'start', request: req }]);

describe('launch flow', () => {
  it('opens on the form and sends the request once', () => {
    const form = step(START, { type: 'open' }).flow;
    expect(form).toMatchObject({ stage: 'form', request: null, error: null });
    const s = step(form, { type: 'start', request: req });
    expect(s.send).toEqual(req);
    expect(s.flow).toMatchObject({ stage: 'starting', request: req, attempt: 1 });
    const again = step(s.flow, { type: 'start', request: req });   // a double click
    expect(again.flow).toBe(s.flow);
    expect(again.send).toBeUndefined();
  });
  it('open while the screen is up changes nothing', () => {
    expect(step(starting, { type: 'open' }).flow).toBe(starting);
  });
  it('the chosen machine\'s launched closes the screen and names the session', () => {
    const s = step(starting, { type: 'launched', machine: 'devbox', id: 'devbox:ari' });
    expect(s.launched).toBe('devbox:ari');
    expect(s.flow).toMatchObject({ stage: 'closed', request: null });
  });
  it('another machine\'s answers change nothing', () => {
    expect(step(starting, { type: 'launched', machine: 'local', id: 'local:x' }).flow).toBe(starting);
    expect(step(starting, { type: 'refused', machine: 'local', message: 'no' }).flow).toBe(starting);
    expect(step(starting, { type: 'dropped', machine: 'local' }).flow).toBe(starting);
  });
  it('a daemon error, an unsent request and a lost connection fail with their reason', () => {
    expect(step(starting, { type: 'refused', machine: 'devbox', message: 'no such folder: ~/w/api' }).flow)
      .toMatchObject({ stage: 'failed', error: { kind: 'daemon', message: 'no such folder: ~/w/api' }, request: req });
    expect(step(starting, { type: 'unsent' }).flow).toMatchObject({ stage: 'failed', error: { kind: 'offline' }, late: {} });
    expect(step(starting, { type: 'dropped', machine: 'devbox' }).flow).toMatchObject({ stage: 'failed', error: { kind: 'lost' }, late: {} });
  });
  it('a refusal right before that machine\'s drop is a lost connection: the SSH bridge reports its exit, then closes', () => {
    const r = step(starting, { type: 'refused', machine: 'devbox', message: 'SSH connection closed (255).' });
    expect(r.watchDrop).toBe(1);
    expect(r.flow).toMatchObject({ stage: 'failed', error: { kind: 'daemon' } });
    expect(step(r.flow, { type: 'dropped', machine: 'local' }).flow).toBe(r.flow);
    expect(step(r.flow, { type: 'dropped', machine: 'devbox' }).flow).toMatchObject({ stage: 'failed', error: { kind: 'lost' }, request: req });
    // Leaving the failure ends the window.
    expect(step(r.flow, { type: 'edit' }).flow.dropMayFollow).toBe(false);
    expect(step(r.flow, { type: 'close' }).flow.dropMayFollow).toBe(false);
  });
  it('a refusal no drop follows stays a refusal, even if the machine drops later', () => {
    const refused = step(starting, { type: 'refused', machine: 'devbox', message: 'no such folder: ~/w/api' }).flow;
    expect(step(refused, { type: 'settled', attempt: 0 }).flow).toBe(refused);   // another attempt's window
    const settled = step(refused, { type: 'settled', attempt: 1 }).flow;
    expect(step(settled, { type: 'dropped', machine: 'devbox' }).flow)
      .toMatchObject({ stage: 'failed', error: { kind: 'daemon', message: 'no such folder: ~/w/api' } });
    // A timeout or an unsent request opens no window: only a refusal can be the bridge's report.
    const timedOut = step(starting, { type: 'timeout', attempt: 1 });
    expect(timedOut.watchDrop).toBeUndefined();
    expect(step(timedOut.flow, { type: 'dropped', machine: 'devbox' }).flow.error).toEqual({ kind: 'timeout' });
    const retried = step(step(refused, { type: 'retry' }).flow, { type: 'unsent' }).flow;
    expect(step(retried, { type: 'dropped', machine: 'devbox' }).flow.error).toEqual({ kind: 'offline' });
  });
  it('times out only the attempt it was armed for, and the answer it owes is skipped', () => {
    expect(step(starting, { type: 'timeout', attempt: 0 }).flow).toBe(starting);
    const failed = step(starting, { type: 'timeout', attempt: 1 }).flow;
    expect(failed).toMatchObject({ stage: 'failed', error: { kind: 'timeout' }, late: { devbox: 1 } });
    const retried = step(failed, { type: 'retry' });
    expect(retried.send).toEqual(req);
    expect(retried.flow).toMatchObject({ stage: 'starting', attempt: 2, error: null });
    const skipped = step(retried.flow, { type: 'launched', machine: 'devbox', id: 'devbox:first' });
    expect(skipped.launched).toBeUndefined();
    expect(skipped.flow).toMatchObject({ stage: 'starting', late: {} });
    expect(step(skipped.flow, { type: 'launched', machine: 'devbox', id: 'devbox:second' }).launched).toBe('devbox:second');
  });
  it('Edit returns to the form; Retry only from a failure', () => {
    const failed = step(starting, { type: 'refused', machine: 'devbox', message: 'x' }).flow;
    expect(step(failed, { type: 'edit' }).flow).toMatchObject({ stage: 'form', error: null });
    expect(step(starting, { type: 'retry' }).flow).toBe(starting);
    expect(step(starting, { type: 'edit' }).flow).toBe(starting);
  });
  it('Cancel closes the screen and skips the cancelled attempt\'s answer, not the next one\'s', () => {
    const closed = step(starting, { type: 'close' }).flow;
    expect(closed).toMatchObject({ stage: 'closed', request: null, late: { devbox: 1 } });
    const late = step(closed, { type: 'launched', machine: 'devbox', id: 'devbox:late' });
    expect(late.launched).toBeUndefined();
    expect(late.flow.late).toEqual({});
    const next = run([{ type: 'open' }, { type: 'start', request: req }], closed);
    expect(step(next, { type: 'refused', machine: 'devbox', message: 'late refusal' }).flow).toMatchObject({ stage: 'starting', late: {} });
  });
  it('a lost connection clears what that machine owed', () => {
    const closed = step(starting, { type: 'close' }).flow;
    expect(step(closed, { type: 'dropped', machine: 'devbox' }).flow.late).toEqual({});
    expect(step(closed, { type: 'dropped', machine: 'local' }).flow).toBe(closed);
  });
  it('closing from the form or a failure owes nothing', () => {
    expect(step(run([{ type: 'open' }]), { type: 'close' }).flow).toMatchObject({ stage: 'closed', late: {} });
    const failed = step(starting, { type: 'unsent' }).flow;
    expect(step(failed, { type: 'close' }).flow).toMatchObject({ stage: 'closed', late: {} });
    expect(step(START, { type: 'close' }).flow).toBe(START);
  });
  it('a machine named like an Object.prototype member starts with no debt', () => {
    const odd = step(run([{ type: 'open' }]), { type: 'start', request: { ...req, machine: 'constructor' } }).flow;
    const s = step(odd, { type: 'launched', machine: 'constructor', id: 'constructor:a' });
    expect(s.launched).toBe('constructor:a');
    const closed = step(odd, { type: 'close' }).flow;
    expect(closed.late.constructor).toBe(1);
    expect(step(closed, { type: 'dropped', machine: 'toString' }).flow).toBe(closed);
  });
});
