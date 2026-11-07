import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ServerMessage } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { createRigOutput, RIG_OUTPUT_MAX, useRigOutput, type RigOutputEntry } from '../src/openrig/rigOutput';
import { OutputView } from '../src/ide/OutputView';

afterEach(cleanup);

function fakeClient() {
  const fns = new Set<(m: ServerMessage) => void>();
  return { onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; }, emit: (m: unknown) => fns.forEach(f => f(m as ServerMessage)), count: () => fns.size };
}

describe('the rig output log', () => {
  it('logs an openrig.done that succeeded: its last non-empty line, on the local machine', () => {
    const c = fakeClient(); const log = createRigOutput(c, () => 1000);
    c.emit({ type: 'openrig.done', requestId: 'r1', ok: true, commands: ['rig up demo --existing --yes --json'], output: 'a\nb\n' });
    expect(log.entries()).toEqual([{ seq: 0, at: 1000, machine: 'local', commands: ['rig up demo --existing --yes --json'], ok: true, result: 'b' }]);
  });
  it('has no result for a success without output, and names the machine', () => {
    const c = fakeClient(); const log = createRigOutput(c);
    c.emit({ type: 'openrig.launched', requestId: 'r1', machineId: 'wsl', ok: true, plan: {}, commands: ['rig up x'] });
    expect(log.entries()[0]).toMatchObject({ machine: 'wsl', ok: true, result: null });
  });
  it('logs a failed openrig.reseated with its error', () => {
    const c = fakeClient(); const log = createRigOutput(c);
    c.emit({ type: 'openrig.reseated', requestId: 'r1', ok: false, commands: ['rig seat add'], error: 'busy' });
    expect(log.entries()[0]).toMatchObject({ ok: false, result: 'busy' });
  });
  it('ignores an answer with no command and the local cancellation', () => {
    const c = fakeClient(); const log = createRigOutput(c);
    c.emit({ type: 'openrig.done', requestId: 'r1', ok: false, commands: [], error: 'busy' });
    c.emit({ type: 'openrig.done', requestId: 'r2', ok: false, commands: ['rig up x'], error: 'cancelled' });
    expect(log.entries()).toEqual([]);
  });
  it('keeps the last 200 entries', () => {
    const c = fakeClient(); const log = createRigOutput(c);
    for (let i = 0; i <= RIG_OUTPUT_MAX; i++) c.emit({ type: 'openrig.done', requestId: `r${i}`, ok: true, commands: [`rig n${i}`] });
    expect(log.entries()).toHaveLength(200);
    expect(log.entries()[0]!.commands[0]).toBe('rig n1');
  });
  it('keeps one array until an entry is added, notifies, and stops listening on dispose', () => {
    const c = fakeClient(); const log = createRigOutput(c); let n = 0; log.subscribe(() => n++);
    const a = log.entries();
    expect(log.entries()).toBe(a);
    c.emit({ type: 'openrig.done', requestId: 'r1', ok: true, commands: ['rig up x'] });
    expect(n).toBe(1); expect(log.entries()).not.toBe(a);
    log.dispose();
    expect(c.count()).toBe(0);
    c.emit({ type: 'openrig.done', requestId: 'r2', ok: true, commands: ['rig up y'] });
    expect(log.entries()).toHaveLength(1);
  });
});

const at = (h: number, m: number) => new Date(2026, 10, 7, h, m).getTime();
const view = (entries: readonly RigOutputEntry[]) => render(<LangProvider lang="fr"><OutputView entries={entries} /></LangProvider>);

describe('OutputView', () => {
  it('shows time, joined commands and the result with its mark', () => {
    view([
      { seq: 0, at: at(12, 4), machine: 'local', commands: ['rig down demo'], ok: true, result: 'demo arrêté' },
      { seq: 1, at: at(12, 5), machine: 'local', commands: ['rig snapshot demo', 'rig up demo'], ok: false, result: 'busy' }
    ]);
    expect(screen.getByText('12:04 · rig down demo')).toBeTruthy();
    expect(screen.getByText('12:05 · rig snapshot demo && rig up demo')).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('✗')).toBeTruthy();
  });
  it('says nothing ran yet when empty', () => {
    view([]);
    expect(screen.getByText('Aucune commande rig lancée depuis l’ouverture de Ledge.')).toBeTruthy();
  });
  it('useRigOutput follows the log', () => {
    const c = fakeClient(); const log = createRigOutput(c);
    function Probe() { return <LangProvider lang="fr"><OutputView entries={useRigOutput(log)} /></LangProvider>; }
    render(<Probe />);
    act(() => c.emit({ type: 'openrig.done', requestId: 'r1', ok: true, commands: ['rig up x'], output: 'ok' }));
    expect(screen.getByText('ok')).toBeTruthy();
  });
  it('is a log reachable by keyboard', () => {
    view([]);
    expect(screen.getByRole('log', { name: 'Sortie' }).getAttribute('tabindex')).toBe('0');
  });
  it('scrolls to the end on a new entry only when it was at the end', () => {
    const e = (n: number): RigOutputEntry => ({ seq: n, at: 0, machine: 'local', commands: [`rig n${n}`], ok: true, result: null });
    const ui = (entries: readonly RigOutputEntry[]) => <LangProvider lang="fr"><OutputView entries={entries} /></LangProvider>;
    const { rerender } = render(ui([e(0)]));
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 100 });
    rerender(ui([e(0), e(1)]));
    expect(log.scrollTop).toBe(500);
    log.scrollTop = 100; fireEvent.scroll(log);
    rerender(ui([e(0), e(1), e(2)]));
    expect(log.scrollTop).toBe(100);
    log.scrollTop = 400; fireEvent.scroll(log);
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 600 });
    rerender(ui([e(0), e(1), e(2), e(3)]));
    expect(log.scrollTop).toBe(600);
  });
});
