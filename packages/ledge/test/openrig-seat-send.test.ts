import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rig, RigSeat } from '@ledge/protocol';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { createRigCli } from '../src/daemon/openrig/cli.js';
import { createSeatSend, leadingAddress, resolveSeatAddress } from '../src/daemon/openrig/seatSend.js';
import { createLedgeThread } from '../src/daemon/ledgeThread.js';
import { createLedgeSay } from '../src/daemon/ledgeSay.js';
import type { Chat } from '../src/chat/service.js';

const seat = (name: string, rig: string, state: RigSeat['state'] = 'idle'): RigSeat => ({ ref: `dev-${name}@${rig}`, address: `@${name}`, name, runtime: 'claude-code', state });
const rig = (name: string, seats: RigSeat[], lifecycle: Rig['lifecycle'] = 'running'): Rig =>
  ({ id: name, name, machine: 'local', cwd: `/w/${name}`, projectId: null, offProject: false, lifecycle, kernel: false, seats, repos: [] });
const rigs: Rig[] = [
  rig('factory', [seat('build', 'factory'), seat('review-a', 'factory'), seat('qa', 'factory', 'stopped')]),
  rig('starter', [seat('build', 'starter')]),
  rig('old', [seat('ghost', 'old')], 'stopped')
];

describe('seat address', () => {
  it('a unique seat address resolves', () => {
    expect(resolveSeatAddress('@review-a', rigs)).toMatchObject({ ok: true, seat: { ref: 'dev-review-a@factory' }, rig: { name: 'factory' } });
  });
  it('an ambiguous address lists candidates', () => {
    expect(resolveSeatAddress('@build', rigs)).toEqual({ ok: false, reason: expect.stringContaining('Plusieurs agents s\'appellent @build : '), candidates: ['@build@factory', '@build@starter'] });
  });
  it('@build@factory picks the rig', () => {
    expect(resolveSeatAddress('@build@factory', rigs)).toMatchObject({ ok: true, rig: { name: 'factory' }, seat: { ref: 'dev-build@factory' } });
  });
  it('a stopped seat is refused with its state', () => {
    expect(resolveSeatAddress('@qa', rigs)).toMatchObject({ ok: false, reason: '@qa est arrêté (factory)' });
  });
  it('a seat of a stopped rig is no seat', () => {
    expect(resolveSeatAddress('@ghost', rigs)).toMatchObject({ ok: false });
  });
  it('leadingAddress splits the head word', () => {
    expect(leadingAddress('@build relance les tests')).toEqual({ word: '@build', rest: 'relance les tests' });
    expect(leadingAddress('  @build@factory, go')).toEqual({ word: '@build@factory', rest: 'go' });
    expect(leadingAddress('bonjour @build')).toBeNull();
  });
});

describe('seatSend', () => {
  let fake: FakeOpenRig; let exec: ReturnType<typeof fakeRigCli>; let rigsNow: Rig[];
  beforeEach(async () => { fake = await createFakeOpenRig(); exec = fakeRigCli(fake); rigsNow = rigs; });
  afterEach(() => fake.stop());
  const make = () => createSeatSend({ bridge: { rigs: () => rigsNow, cli: () => createRigCli(exec) } });

  it('send runs rig send signed Ledge', async () => {
    expect(await make().send('local', 'dev-build@factory', 'relance les tests')).toMatchObject({ ok: true });
    expect(exec.calls.at(-1)).toEqual(['send', 'dev-build@factory', '[Ledge] relance les tests']);
    expect(exec.envs.at(-1)).toEqual({ OPENRIG_SESSION_NAME: 'ledge@external' });
  });
  it('a remote machine is refused, nothing sent', async () => {
    expect(await make().send('mac', 'dev-build@factory', 'x')).toMatchObject({ ok: false });
    expect(exec.calls).toEqual([]);
  });
  it('a failing rig send gives the reason', async () => {
    const r = await createSeatSend({ bridge: { rigs: () => rigs, cli: () => createRigCli(fakeRigCli(null)) } }).send('local', 'dev-build@factory', 'x');
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('@build') });
  });
  it('a word that is no seat goes to Ledge', async () => { expect(await make().fromSay('r', '@Otto où en es-tu ?')).toBeNull(); });
  it('plain text goes to Ledge', async () => { expect(await make().fromSay('r', 'salut')).toBeNull(); });
  it('fromSay sends to a unique seat; refuses ambiguous and stopped ones without sending', async () => {
    const s = make();
    expect(await s.fromSay('r', '@review-a regarde ça')).toEqual({ ok: true, to: '@review-a' });
    expect(exec.calls.at(-1)).toEqual(['send', 'dev-review-a@factory', '[Ledge] regarde ça']);
    const n = exec.calls.length;
    expect(await s.fromSay('r', '@build go')).toMatchObject({ ok: false, reason: expect.stringContaining('@build@factory') });
    expect(await s.fromSay('r', '@qa go')).toEqual({ ok: false, reason: '@qa est arrêté (factory)' });
    expect(await s.fromSay('r', '@review-a')).toMatchObject({ ok: false });
    expect(exec.calls.length).toBe(n);
  });

  it('say "@build@factory …" sends and adds a user item with to, chat.ask never called', async () => {
    const thread = createLedgeThread({ path: join(mkdtempSync(join(tmpdir(), 'ledge-seat-')), 't.jsonl') });
    let asked = 0;
    const chat = { async ask() { asked++; }, idle: async () => {} } as unknown as Chat;
    const say = createLedgeSay({ thread, chat, escalations: () => undefined, toSeat: make().fromSay, tool: () => 'codex', broadcast: () => {} });
    await say.say('r1', '@build@factory relance les tests');
    expect(thread.page().items).toEqual([expect.objectContaining({ kind: 'user', to: '@build@factory' })]);
    expect(asked).toBe(0);
    await say.say('r2', '@build relance');
    expect(thread.page().items.map(i => i.kind)).toEqual(['user', 'user', 'ledge']);
  });
});
