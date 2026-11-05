import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhoneServerMessageSchema, type ClientMessage, type Projects } from '@ledge/protocol';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

// Réglages › Projets › a project's folders from the phone: browsing this PC's folders, its recent ones, adding one with the
// device's check, removing one.

afterEach(stopAll);

type G = ReturnType<typeof setup>;
const rp = { rpId: 'relay.test', origin: 'https://relay.test' };

/** A home with `code/ledge` (a Git repository on `main`), `code/notes`, a hidden folder and a file. */
function home(): string {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'ledge-phone-folders-')));
  mkdirSync(join(h, 'code', 'ledge', '.git'), { recursive: true });
  writeFileSync(join(h, 'code', 'ledge', '.git', 'HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(join(h, 'code', 'notes'), { recursive: true });
  mkdirSync(join(h, '.secret'));
  writeFileSync(join(h, 'file.txt'), 'x');
  return h;
}

function make(o: { recents?: string[] } = {}) {
  const h = home();
  const box = {
    state: {
      projects: [
        { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'srv', path: '/srv/ledge' }] },
        { id: 'bots', name: 'Bots', color: 'green', description: '', repos: [{ machine: 'local', path: join(h, 'code', 'notes') }] }
      ],
      rules: []
    } as Projects,
    sets: [] as Projects[]
  };
  const g = setup({
    deps: { projects: () => box.state, folders: { home: h, recents: () => o.recents ?? [join(h, 'code', 'ledge'), 'relative/x', join(h, 'code', 'ledge') + '/'], machineLabel: id => (id === 'srv' ? 'Serveur' : undefined) } },
    dispatch: async (msg: ClientMessage) => { if (msg.type === 'projects.set') { box.sets.push(msg.projects); box.state = msg.projects; } }
  });
  return { g, box, h };
}
const last = (g: G, type: string) => g.got('dev1').filter(m => m.type === type).at(-1);
const outcome = (g: G, op: string) => g.results('dev1').filter(r => r.type === 'operation.result' && r.op === op && r.status !== 'received').at(-1);
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };
const send = async (g: G, msg: object) => { const op = randomUUID(); g.send('dev1', { ...msg, op }); await until(() => !!outcome(g, op)); return outcome(g, op); };

const enroll = async (g: G) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
const challenge = async (g: G, project: string, path: string) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: 'folder', project, path });
  await flush();
  const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge' || x.type === 'error');
  return m;
};

describe('phone folders: what the PC offers', () => {
  it('a daemon with folders says projectFolders; without, the reads are refused', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.daemon.projectFolders).toBe(true);
    const bare = setup({ deps: { projects: () => ({ projects: [], rules: [] }) } });
    bare.send('dev1', { type: 'folder.list' });
    bare.send('dev1', { type: 'folder.recents' });
    await flush();
    expect(bare.got('dev1')).toEqual([{ type: 'error', code: 'invalid', request: 'folder.list' }, { type: 'error', code: 'invalid', request: 'folder.recents' }]);
  });
});

describe('phone folders: browsing', () => {
  it('home first: its subfolders, hidden ones and files left out; then a folder with its repositories and branch', async () => {
    const { g, h } = make();
    g.send('dev1', { type: 'folder.list' });
    await until(() => !!last(g, 'folder.listing'));
    expect(PhoneServerMessageSchema.parse(last(g, 'folder.listing'))).toEqual({ type: 'folder.listing', path: h, parent: expect.any(String), entries: ['code'], repos: [] });
    g.send('dev1', { type: 'folder.list', path: join(h, 'code') });
    await until(() => g.got('dev1').filter(m => m.type === 'folder.listing').length === 2);
    expect(last(g, 'folder.listing')).toEqual({ type: 'folder.listing', path: join(h, 'code'), parent: h, entries: ['ledge', 'notes'], repos: [{ name: 'ledge', branch: 'main' }] });
  });

  it('a folder that is not there, or a file, is a code, never the PC\'s words; a relative path never reaches the PC', async () => {
    const { g, h } = make();
    g.send('dev1', { type: 'folder.list', path: join(h, 'nope') });
    await until(() => !!last(g, 'folder.listing'));
    expect(last(g, 'folder.listing')).toEqual({ type: 'folder.listing', path: join(h, 'nope'), parent: null, entries: [], repos: [], error: 'not_found' });
    g.send('dev1', { type: 'folder.list', path: join(h, 'file.txt') });
    await until(() => g.got('dev1').filter(m => m.type === 'folder.listing').length === 2);
    expect(last(g, 'folder.listing')).toMatchObject({ error: 'not_folder' });
    g.send('dev1', { type: 'folder.list', path: 'code/../..' });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'error', code: 'invalid', request: 'folder.list' });
  });

  it('recents: this PC\'s absolute folders, once each, newest first', async () => {
    const { g, h } = make();
    g.send('dev1', { type: 'folder.recents' });
    await flush();
    expect(last(g, 'folder.recents')).toEqual({ type: 'folder.recents', paths: [join(h, 'code', 'ledge')] });
  });

  it('a project\'s folders: this PC\'s by path, another machine\'s with its label; an unknown project is gone', async () => {
    const { g, h } = make();
    g.send('dev1', { type: 'project.folders', id: 'ledge' });
    g.send('dev1', { type: 'project.folders', id: 'bots' });
    g.send('dev1', { type: 'project.folders', id: 'nope' });
    await flush();
    expect(g.got('dev1').filter(m => m.type === 'project.folders')).toEqual([
      { type: 'project.folders', id: 'ledge', folders: [{ machine: 'srv', label: 'Serveur', path: '/srv/ledge' }] },
      { type: 'project.folders', id: 'bots', folders: [{ machine: 'local', path: join(h, 'code', 'notes') }] },
      { type: 'project.folders', id: 'nope', folders: [], gone: true }
    ]);
  });
});

describe('phone folders: add and remove', () => {
  it('adding needs the device\'s check: without a passkey, confirm_required, nothing written', async () => {
    const { g, box, h } = make();
    expect(await send(g, { type: 'project.folder.add', id: 'ledge', path: join(h, 'code', 'ledge') })).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(box.sets).toEqual([]);
  });

  it('with its check: this PC\'s folder joins the project, the others kept', async () => {
    const { g, box, h } = make();
    const auth = await enroll(g);
    const path = join(h, 'code', 'ledge');
    const ch = await challenge(g, 'ledge', path);
    if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await send(g, { type: 'project.folder.add', id: 'ledge', path, assertion: auth.get(rp, ch.challenge, { counter: 1 }) })).toMatchObject({ status: 'applied' });
    expect(box.state.projects[0]!.repos).toEqual([{ machine: 'srv', path: '/srv/ledge' }, { machine: 'local', path }]);
  });

  it('a check covers that folder for that project only', async () => {
    const { g, box, h } = make();
    const auth = await enroll(g);
    const ch = await challenge(g, 'ledge', join(h, 'code', 'ledge'));
    if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await send(g, { type: 'project.folder.add', id: 'ledge', path: h, assertion: auth.get(rp, ch.challenge, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(box.sets).toEqual([]);
  });

  it('a folder another project has is folder_taken; one that is not there is not_found', async () => {
    const { g, box, h } = make();
    const auth = await enroll(g);
    const taken = join(h, 'code', 'notes');
    const ch = await challenge(g, 'ledge', taken);
    if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await send(g, { type: 'project.folder.add', id: 'ledge', path: taken, assertion: auth.get(rp, ch.challenge, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'folder_taken' });
    const gone = join(h, 'gone');
    const ch2 = await challenge(g, 'ledge', gone);
    if (ch2?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await send(g, { type: 'project.folder.add', id: 'ledge', path: gone, assertion: auth.get(rp, ch2.challenge, { counter: 2 }) })).toMatchObject({ status: 'rejected', reason: 'not_found' });
    expect(box.sets).toEqual([]);
  });

  it('no challenge for an unknown project, nor without a passkey', async () => {
    const { g, h } = make();
    expect(await challenge(g, 'ledge', h)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    await enroll(g);
    expect(await challenge(g, 'nope', h)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
  });

  it('removing needs no check: the folder leaves its project, any machine\'s; one it does not have is stale', async () => {
    const { g, box } = make();
    expect(await send(g, { type: 'project.folder.remove', id: 'ledge', machine: 'srv', path: '/srv/ledge' })).toMatchObject({ status: 'applied' });
    expect(box.state.projects[0]!.repos).toEqual([]);
    expect(await send(g, { type: 'project.folder.remove', id: 'ledge', machine: 'srv', path: '/srv/ledge' })).toMatchObject({ status: 'rejected', reason: 'stale' });
  });
});
