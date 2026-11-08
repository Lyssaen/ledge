import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ForgeActReply, ForgeDetailReply, ForgeStateMessage, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { createForgeService } from '../src/daemon/forge/service.js';
import type { ForgeReader, ReadPr } from '../src/daemon/forge/types.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}
const AT = '2026-11-08T10:00:00.000Z';
const mk = (id: string, branch: string): Session => ({ id, name: id, tool: 'claude', cwd: '/w', project: 'w', title: id, tmuxSession: null, state: 'idle', helpers: [], startedAt: AT, lastActivityAt: AT, source: 'hook_only', repoId: 'github.com/Lyssaen/ledge', branch });
const pr = (n: number, branch: string, extra: Partial<ReadPr> = {}): ReadPr => ({
  id: `github.com/Lyssaen/ledge#${n}`, forge: 'github', host: 'github.com', repo: 'Lyssaen/ledge', number: n, ref: `#${n}`, url: `https://github.com/Lyssaen/ledge/pull/${n}`, title: `PR ${n}`,
  state: 'open', branch, target: 'main', headSha: 'a'.repeat(40), pipeline: 'fail', approvals: { given: 1 }, mergeable: true, openThreads: 0, updatedAt: AT, blockers: [], head: 'Lyssaen/ledge', ...extra
});
/** A gh reader on doubles: the requests are those of `prs`. */
function reader(prs: ReadPr[]): ForgeReader {
  return {
    async list(_r, targets) { return prs.filter(p => targets.some(t => t.branch === p.branch && t.head === p.head)); },
    async detail(_r, n) { const p = prs.find(x => x.number === n)!; return { pr: p, description: 'd', author: 'pim', reviewers: [], labels: [], issues: [], jobs: [], threads: [], files: [], commits: [], mergeCommand: 'gh pr merge', mergeBlockers: ['pipeline'] }; },
    async act() { return { command: 'gh pr comment 226 -R Lyssaen/ledge --body-file -' }; },
    async defaultBranch() { return 'main'; }
  };
}

/** No git configuration: every branch is taken as pushed to origin. */
const noGit = async () => ({ code: 1, stdout: '', stderr: '' });
let srv: Awaited<ReturnType<typeof startServer>> | undefined; let store: Store; let c: Client | undefined;
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-forge-srv-')); store = new Store(); });
afterEach(async () => { await c?.close(); await srv?.close(); srv = undefined; c = undefined; });

describe('server: pull and merge requests', () => {
  it('says it serves them, sends forge.state after the snapshot, then on each change', async () => {
    store.upsert(mk('s1', 'feat/ide-shell'));
    const prs = [pr(226, 'feat/ide-shell'), pr(227, 'feat/other')];
    const forge = createForgeService({ store, run: noGit, readers: { gh: reader(prs) } });
    await forge.refresh();
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false }, forge });
    c = await connect({ port: srv.port });
    expect((await c.next('snapshot')).daemon?.forge).toBe(true);
    const first = await c.next('forge.state') as ForgeStateMessage;
    expect(first.prs.map(p => [p.ref, p.sessions])).toEqual([['#226', ['s1']]]);
    store.upsert(mk('s2', 'feat/other'));
    await forge.refresh();
    const next = await c.next('forge.state') as ForgeStateMessage;
    expect(next.prs.map(p => p.ref).sort()).toEqual(['#226', '#227']);
  });

  it('answers forge.detail and forge.act with the same requestId; a refusal carries its code; an unknown request is unavailable', async () => {
    store.upsert(mk('s1', 'feat/ide-shell'));
    const forge = createForgeService({ store, run: noGit, readers: { gh: reader([pr(226, 'feat/ide-shell')]) } });
    await forge.refresh();
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, forge });
    c = await connect({ port: srv.port });
    await c.next('snapshot');
    c.send({ type: 'forge.detail', requestId: 'd1', prId: 'github.com/Lyssaen/ledge#226' });
    const d = await c.next('forge.detail.reply') as ForgeDetailReply;
    expect(d).toMatchObject({ requestId: 'd1', ok: true, detail: { author: 'pim', pr: { sessions: ['s1'] } } });
    c.send({ type: 'forge.act', requestId: 'a1', prId: 'github.com/Lyssaen/ledge#226', action: { kind: 'merge', headSha: 'a'.repeat(40) } });
    const refused = await c.next('forge.act.reply') as ForgeActReply;
    expect(refused).toMatchObject({ requestId: 'a1', ok: false, code: 'not_offered', message: 'the pipeline is not green' });
    c.send({ type: 'forge.act', requestId: 'a2', prId: 'github.com/Lyssaen/ledge#226', action: { kind: 'comment', body: 'Vu.' } });
    expect(await c.next('forge.act.reply')).toMatchObject({ requestId: 'a2', ok: true, command: 'gh pr comment 226 -R Lyssaen/ledge --body-file -' });
    c.send({ type: 'forge.detail', requestId: 'd2', prId: 'github.com/x/y#1' });
    expect(await c.next('forge.detail.reply')).toMatchObject({ requestId: 'd2', ok: false, code: 'unavailable' });
    c.send({ type: 'forge.act', requestId: 'a3', prId: 'github.com/x/y#1', action: { kind: 'rerun' } });
    expect(await c.next('forge.act.reply')).toMatchObject({ requestId: 'a3', ok: false, code: 'unavailable' });
  });

  it('an older daemon\'s place: without the service, no flag and no forge.state; a request is unavailable', async () => {
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false } });
    c = await connect({ port: srv.port });
    expect((await c.next('snapshot')).daemon?.forge).toBeUndefined();
    c.send({ type: 'forge.detail', requestId: 'd1', prId: 'github.com/x/y#1' });
    expect(await c.next('forge.detail.reply')).toMatchObject({ requestId: 'd1', ok: false, code: 'unavailable' });
  });
});
