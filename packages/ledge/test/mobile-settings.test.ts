import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DEFAULT_DEVICE_PREFS, PhoneServerMessageSchema, type DevicePrefs, type PhoneServerMessage, type ServerMessage } from '@ledge/protocol';
import { flush, setup, stopAll } from './helpers/gateway.js';

// The phone's Réglages: a device's own settings (`device.prefs`) and the PC's context threshold (`context.set`).

afterEach(stopAll);

const PREFS: DevicePrefs = { notify: { finished: false, chat: true, decision: true }, quietUntil: '2026-11-06T07:00:00.000Z', chatTool: 'codex' };
type Snapshot = Extract<PhoneServerMessage, { type: 'snapshot' }>;
const snapshots = (g: ReturnType<typeof setup>, id: string) => g.got(id).filter((m): m is Snapshot => m.type === 'snapshot');
const finals = (g: ReturnType<typeof setup>, id: string) => g.results(id).filter(r => r.type === 'operation.result' && r.status !== 'received');

describe('phone settings: what the snapshot says', () => {
  it('a daemon that keeps them says `settings` and gives each device its own (the defaults until set)', async () => {
    const g = setup({ settings: true });
    g.fm.prefs.set('dev2', PREFS);
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev2', { type: 'snapshot.request' });
    await flush();
    const [one] = snapshots(g, 'dev1');
    const [two] = snapshots(g, 'dev2');
    expect(PhoneServerMessageSchema.parse(one)).toMatchObject({ daemon: { settings: true }, device: { prefs: DEFAULT_DEVICE_PREFS, contextNear: 0.8 } });
    expect(two?.device?.prefs).toEqual(PREFS);
  });

  it('a daemon without them says nothing, and refuses both operations as unavailable', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const [snap] = snapshots(g, 'dev1');
    expect(snap?.daemon).not.toHaveProperty('settings');
    expect(snap?.device).not.toHaveProperty('prefs');
    const a = randomUUID(); const b = randomUUID();
    g.send('dev1', { type: 'device.prefs', op: a, prefs: PREFS });
    g.send('dev1', { type: 'context.set', op: b, near: 0.7 });
    await flush();
    expect(finals(g, 'dev1')).toEqual([
      { type: 'operation.result', op: a, status: 'rejected', reason: 'unavailable' },
      { type: 'operation.result', op: b, status: 'rejected', reason: 'unavailable' }
    ]);
    expect(g.dispatched).toEqual([]);
  });
});

describe('phone settings: device.prefs', () => {
  it('stores the sender\'s settings only, then sends it a snapshot that carries them', async () => {
    const g = setup({ settings: true });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const op = randomUUID();
    g.send('dev1', { type: 'device.prefs', op, prefs: PREFS });
    await flush();
    expect(finals(g, 'dev1')).toEqual([{ type: 'operation.result', op, status: 'applied' }]);
    expect(g.fm.prefs.get('dev1')).toEqual(PREFS);
    expect(g.fm.prefs.has('dev2')).toBe(false);
    expect(snapshots(g, 'dev1').at(-1)?.device?.prefs).toEqual(PREFS);
    expect(g.got('dev2')).toEqual([]);
  });

  it('refuses a field off the list (a device cannot widen its own rights) as invalid, storing nothing', async () => {
    const g = setup({ settings: true });
    g.send('dev1', { type: 'device.prefs', op: randomUUID(), prefs: { ...PREFS, terminalInput: true } });
    g.send('dev1', { type: 'device.prefs', op: randomUUID(), prefs: { ...PREFS, notify: { ...PREFS.notify, request: false } } });
    g.send('dev1', { type: 'device.prefs', op: randomUUID(), prefs: PREFS, id: 'dev2' });
    await flush();
    expect(g.got('dev1').map(m => m.type === 'error' && m.code)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(g.fm.prefs.size).toBe(0);
  });

  it('the same op sent again is replayed, the same op with other values is a conflict', async () => {
    const g = setup({ settings: true });
    const op = randomUUID();
    g.send('dev1', { type: 'device.prefs', op, prefs: PREFS });
    await flush();
    g.send('dev1', { type: 'device.prefs', op, prefs: PREFS });
    g.send('dev1', { type: 'device.prefs', op, prefs: { ...PREFS, chatTool: null } });
    await flush();
    expect(finals(g, 'dev1').map(r => r.type === 'operation.result' && [r.status, r.reason ?? null])).toEqual([['applied', null], ['applied', null], ['rejected', 'conflict']]);
    expect(g.fm.prefs.get('dev1')).toEqual(PREFS);
  });

  it('the chat of a device that chose its agent runs it; another device keeps the PC\'s', async () => {
    const asked: Array<{ id: string; tool: unknown }> = [];
    const chatOf = (id: string) => ({
      async ask(qid: string, _text: string, emit: (m: ServerMessage) => void, tool?: unknown) { asked.push({ id, tool }); emit({ type: 'chat.done', qid, text: 'ok', at: '2026-11-05T10:00:00.000Z' } as never); },
      cancel() {}, async reset() {}, history: () => [], ignore: () => null
    });
    const chats = {
      device: (id: string) => chatOf(id) as never, async deviceTool() { return 'claude' as const; }, owner: () => undefined,
      peek: (id: string) => chatOf(id) as never, async drop() {}, setEmitter() {}
    };
    const g = setup({ settings: true, chats });
    g.fm.prefs.set('dev1', { ...DEFAULT_DEVICE_PREFS, chatTool: 'cursor' });
    g.send('dev1', { type: 'chat.ask', qid: randomUUID(), text: 'hello' });
    g.send('dev2', { type: 'chat.ask', qid: randomUUID(), text: 'hello' });
    await flush();
    expect(asked).toEqual([{ id: 'dev1', tool: 'cursor' }, { id: 'dev2', tool: 'claude' }]);
  });
});

describe('phone settings: context.set', () => {
  it('goes to the daemon as its own context.set, and is applied', async () => {
    const g = setup({ settings: true });
    const op = randomUUID();
    g.send('dev1', { type: 'context.set', op, near: 0.65 });
    await flush();
    expect(g.dispatched).toEqual([{ type: 'context.set', prefs: { near: 0.65 } }]);
    expect(finals(g, 'dev1')).toEqual([{ type: 'operation.result', op, status: 'applied' }]);
  });

  it('a refusal of the daemon is the operation\'s, never its words', async () => {
    const g = setup({ settings: true, dispatch: async (_m, reply) => { reply({ type: 'error', message: 'EACCES /home/secret/context.json', request: 'context.set' } as ServerMessage); } });
    const op = randomUUID();
    g.send('dev1', { type: 'context.set', op, near: 0.65 });
    await flush();
    expect(finals(g, 'dev1')).toEqual([{ type: 'operation.result', op, status: 'failed' }]);
    expect(JSON.stringify(g.got('dev1'))).not.toContain('secret');
  });

  it('a value off the desktop\'s bounds never reaches the daemon', async () => {
    const g = setup({ settings: true });
    g.send('dev1', { type: 'context.set', op: randomUUID(), near: 0.2 });
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'error', code: 'invalid', request: 'context.set' }]);
    expect(g.dispatched).toEqual([]);
  });
});
