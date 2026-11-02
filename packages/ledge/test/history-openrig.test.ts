import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, SessionEvent, ThreadItem } from '@ledge/protocol';
import { ThreadItemSchema } from '@ledge/protocol';
import { History } from '../src/daemon/history.js';
import { reduce } from '../src/daemon/state.js';

/** OpenRig's blocks in a seat's thread (docs/mockups/ledge-openrig-messages.html): real envelopes from the seats' terminals. */
const T0 = '2026-11-02T21:12:16.000Z';
const later = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const ev = (name: SessionEvent['name'], extra: Partial<SessionEvent> = {}, s = 0): SessionEvent => ({ name, at: later(s), source: 'hook', ...extra });
const prompt = (text: string, s = 0) => ev('UserPromptSubmit', { text }, s);
const envelope = (from: string, body: string, sent = 'Sent: 11-02 21:12Z · gen 45f7085e', to = 'dev-back@ledge-dev-2') =>
  `From: ${from}\nTo: ${to}\n${sent}\n---\n${body}\n---\n↩ Reply: rig send ${from} "..."`;
const paste = (text: string) => `\n\n<pasted_content id="8fc5">\n${text}\n</pasted_content id="8fc5">\n`;
const HANDOFF = envelope('pilot-lead@ledge-dev-2', 'Queue handoff: qitem-20261102211216-d6159d44d566f343 - check your queue. Summary: Back messages OpenRig');
const STALLED = 'From: daemon@kernel\nTo: dev-back@ledge-dev-2\nSent: 11-02 20:44Z\n---\nQueue handoff: qitem-recovery-18c2afe3c0e67db0 - check your queue. Summary: Stuck sweep: stalled-after-claim on qitem-20261102203919-24b65ee8 (4 min)\n---\n↩ Sent by OpenRig itself, not by a seat. Act on the row it names.';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-')); process.env.LEDGE_HOME = dir; });
const valid = (items: ThreadItem[]) => items.forEach(i => expect(() => ThreadItemSchema.parse(i)).not.toThrow());

describe('OpenRig in a seat\'s thread', () => {
  it('makes a message a received bubble, never a prompt of the user\'s', () => {
    const h = new History({ peerOf: t => (t === 'pilot-lead@ledge-dev-2' ? 'lead' : undefined) });
    const raw = envelope('pilot-lead@ledge-dev-2', 'Ta ligne est prête.\nVoir le commit.');
    h.record('s', prompt(paste(raw)));
    expect(h.items('s')).toEqual([{
      kind: 'received', id: 'rig-1-0', at: T0, turn: 1, from: 'pilot-lead@ledge-dev-2', peer: 'lead', text: 'Ta ligne est prête.\nVoir le commit.',
      rig: { kind: 'message', from: 'pilot-lead@ledge-dev-2', to: 'dev-back@ledge-dev-2', sentAt: '2026-11-02T21:12:00.000Z', gen: '45f7085e', raw }
    }]);
    valid(h.items('s'));
  });

  it('makes a handoff, a blocker cleared, a stuck sweep and an unreadable block notices', () => {
    const h = new History();
    h.record('s', prompt(HANDOFF));
    h.record('s', prompt(envelope('review-qa@ledge-dev-2', 'Blocker qitem-20261102195145-4c7203f8 resolved; parked qitem qitem-20261102183615-614acb2be7567669 is pending. Resume the recorded continuation and update the row.'), 1));
    h.record('s', prompt(STALLED, 2));
    h.record('s', prompt('From: pilot-lead@ledge-dev-2\nTo: dev-back@ledge-dev-2\n---\nRelance : prêt ?', 3));
    const [handoff, unblocked, stalled, bad] = h.items('s');
    expect(handoff).toMatchObject({ kind: 'notice', notice: 'other', name: 'pilot-lead@ledge-dev-2', summary: 'Back messages OpenRig', rig: { kind: 'handoff', qitem: 'qitem-20261102211216-d6159d44d566f343' } });
    expect(unblocked).toMatchObject({ kind: 'notice', rig: { kind: 'unblocked', qitem: 'qitem-20261102183615-614acb2be7567669', blocker: 'qitem-20261102195145-4c7203f8' } });
    expect(stalled).toMatchObject({ kind: 'notice', name: 'daemon@kernel', rig: { kind: 'openrig', alert: 'stalled', qitem: 'qitem-20261102203919-24b65ee8', minutes: 4, recovery: 'qitem-recovery-18c2afe3c0e67db0' } });
    expect(bad).toMatchObject({ kind: 'notice', text: 'From: pilot-lead@ledge-dev-2\nTo: dev-back@ledge-dev-2\n---\nRelance : prêt ?', rig: { kind: 'unreadable' } });
    expect(h.items('s').map(i => i.turn)).toEqual([1, 2, 3, 4]);
    valid(h.items('s'));
  });

  it('counts a repeated delivery on the item it repeats, with every raw', () => {
    const h = new History();
    h.record('s', prompt(HANDOFF));
    h.record('s', prompt(`Recovered queue notification: delivery may repeat after an earlier unconfirmed attempt.\n${HANDOFF}`, 5));
    expect(h.items('s')).toHaveLength(1);
    expect(h.items('s')[0]).toMatchObject({ id: 'rig-1-0', rig: { count: 2, raw: `${HANDOFF}\n\n${HANDOFF}` } });
    // another message of the same generation is not a repeat
    h.record('s', prompt(envelope('pilot-lead@ledge-dev-2', 'Autre chose'), 6));
    expect(h.items('s')).toHaveLength(2);
    // nor a recovered delivery of a new one
    h.record('s', prompt(`Recovered queue notification: delivery may repeat after an earlier unconfirmed attempt.\n${envelope('pilot-lead@ledge-dev-2', 'Encore autre chose')}`, 7));
    expect(h.items('s')[2]).toMatchObject({ kind: 'received', rig: { recovered: true } });
    const third = h.items('s')[2]!;
    expect(third.kind === 'received' ? third.rig?.count : 'not received').toBeUndefined();
  });

  it('gives blocks pasted together one packet, and keeps the user\'s own words as a prompt', () => {
    const h = new History();
    h.record('s', prompt(`Ok pour moi.\n\n${HANDOFF}\n${STALLED}`));
    expect(h.items('s').map(i => i.kind)).toEqual(['prompt', 'notice', 'notice']);
    expect(h.items('s')[0]).toMatchObject({ id: 'prompt-1', text: 'Ok pour moi.' });
    expect(h.items('s').slice(1).map(i => (i.kind === 'notice' ? i.rig?.packet : null))).toEqual([{ id: 'rig-1', index: 0, count: 2 }, { id: 'rig-1', index: 1, count: 2 }]);
  });

  it('keeps a whole envelope quoted in a message inside that message\'s bubble', () => {
    const h = new History();
    const inner = envelope('other@rig', 'Le texte cité', 'Sent: 11-02 19:00Z · gen 11111111', 'pilot-lead@ledge-dev-2');
    h.record('s', prompt(paste(envelope('pilot-lead@ledge-dev-2', `Voici le message cité :\n${inner}\nMerci de vérifier.`))));
    expect(h.items('s')).toHaveLength(1);
    expect(h.items('s')[0]).toMatchObject({ kind: 'received', from: 'pilot-lead@ledge-dev-2', text: `Voici le message cité :\n${inner}\nMerci de vérifier.` });
  });

  it('leaves the user\'s prompts alone', () => {
    const h = new History();
    h.record('s', prompt('Corrige le test'));
    expect(h.items('s')).toEqual([{ kind: 'prompt', id: 'prompt-1', at: T0, turn: 1, text: 'Corrige le test' }]);
  });

  it('pairs a bubble with the sending seat\'s own rig send, which reads as a sent card, delivered then read', () => {
    const peers: Record<string, string> = { 'dev-front@ledge-dev-2': 'front', 'dev-back@ledge-dev-2': 'back' };
    const h = new History({ peerOf: t => peers[t] });
    const command = 'rig send dev-front@ledge-dev-2 "dev-back : contrat posé, commit 2cf469af"';
    h.record('back', ev('PreToolUse', { tool: 'Bash', text: `Bash · ${command}`, toolUseId: 'toolu_1', toolInput: { command } }));
    expect(h.items('back')).toEqual([{ kind: 'sent', id: 'toolu_1', at: T0, turn: 0, to: 'dev-front@ledge-dev-2', peer: 'front', text: 'dev-back : contrat posé, commit 2cf469af', status: 'sending',
      rig: { kind: 'message', to: 'dev-front@ledge-dev-2', command, raw: command } }]);
    h.record('back', ev('PostToolUse', { tool: 'Bash', toolUseId: 'toolu_1', toolInput: { command }, output: 'Sent to dev-front@ledge-dev-2' }, 1));
    expect(h.items('back')[0]).toMatchObject({ status: 'delivered', at: T0, rig: { raw: `${command}\nSent to dev-front@ledge-dev-2` } });
    h.record('front', prompt(envelope('dev-back@ledge-dev-2', 'dev-back : contrat posé, commit 2cf469af', 'Sent: 11-02 21:12Z', 'dev-front@ledge-dev-2'), 2));
    expect(h.items('front')[0]).toMatchObject({ kind: 'received', peer: 'back', sent: 'toolu_1' });
    expect(h.items('back')[0]).toMatchObject({ status: 'read', received: 'rig-1-0' });
    valid([...h.items('back'), ...h.items('front')]);
  });

  it('makes the seat\'s own handoff an outgoing row card, with the new row from its output', () => {
    const h = new History();
    const command = 'rig queue handoff qitem-20261102205801-ae61eb9d7f1f4b49 --to pilot-lead@ledge-dev-2 --body-file /tmp/r.md --summary "Installateur construit"';
    h.record('s', ev('PreToolUse', { tool: 'Bash', toolUseId: 'toolu_2', toolInput: { command } }));
    expect(h.items('s')[0]).toMatchObject({ kind: 'notice', outgoing: true, name: 'pilot-lead@ledge-dev-2', summary: 'Installateur construit', rig: { kind: 'handoff', to: 'pilot-lead@ledge-dev-2', command } });
    h.record('s', ev('PostToolUse', { tool: 'Bash', toolUseId: 'toolu_2', toolInput: { command }, output: '{"closed":{"qitemId":"qitem-20261102205801-ae61eb9d7f1f4b49"},"created":{"qitemId":"qitem-20261102211500-0123456789abcdef"}}' }, 1));
    expect(h.items('s')[0]).toMatchObject({ status: 'delivered', rig: { qitem: 'qitem-20261102211500-0123456789abcdef' } });
    h.record('s', ev('PreToolUse', { tool: 'Bash', toolUseId: 'toolu_3', toolInput: { command } }, 2));
    h.record('s', ev('PostToolUseFailure', { tool: 'Bash', toolUseId: 'toolu_3', toolInput: { command }, error: 'Exit code 1' }, 3));
    expect(h.items('s')[1]).toMatchObject({ status: 'refused', rig: { raw: `${command}\nExit code 1` } });
    valid(h.items('s'));
  });

  it('makes a handoff-and-complete an outgoing row card too', () => {
    const h = new History();
    const command = 'rig queue handoff-and-complete qitem-20261102205801-ae61eb9d7f1f4b49 --to dev-front@ledge-dev-2 --summary "Front à reprendre"';
    h.record('s', ev('PreToolUse', { tool: 'Bash', toolUseId: 'toolu_4', toolInput: { command } }));
    expect(h.items('s')[0]).toMatchObject({ kind: 'notice', outgoing: true, name: 'dev-front@ledge-dev-2', rig: { kind: 'handoff', to: 'dev-front@ledge-dev-2', command } });
    const output = ['closed qitem-20261102205801-ae61eb9d7f1f4b49 · done · owner dev-back@ledge-dev-2', '  handed off from qitem-20261102184222-c844fa05df894750',
      'created qitem-20261102213800-feedfacecafe0001 · pending · owner dev-front@ledge-dev-2'].join('\n');
    h.record('s', ev('PostToolUse', { tool: 'Bash', toolUseId: 'toolu_4', toolInput: { command }, output }, 1));
    expect(h.items('s')).toHaveLength(1);
    expect(h.items('s')[0]).toMatchObject({ status: 'delivered', rig: { qitem: 'qitem-20261102213800-feedfacecafe0001' } });
    valid(h.items('s'));
  });

  it('keeps any other Bash call an action row', () => {
    const h = new History();
    for (const [k, command] of ['rig queue show qitem-1 --json', 'rig send a@b "x" | tail -1', 'pnpm test'].entries()) {
      h.record('s', ev('PreToolUse', { tool: 'Bash', toolUseId: `t${k}`, toolInput: { command } }, k));
      h.record('s', ev('PostToolUse', { tool: 'Bash', toolUseId: `t${k}`, toolInput: { command }, output: 'ok' }, k));
    }
    expect(h.items('s').map(i => i.kind)).toEqual(['tool', 'tool', 'tool']);
  });
});

describe('OpenRig and the session\'s subject', () => {
  it('takes no subject from OpenRig\'s blocks', () => {
    const base: Session = { id: 's', name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge', tmuxSession: 'ledge-s', state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'rig' };
    const after = reduce(base, prompt(HANDOFF, 1));
    expect(after.state).toBe('working');
    expect(after.topic).toBeUndefined();
    expect(reduce(after, prompt('Corrige le test', 2)).topic).toBeDefined();
  });
});
