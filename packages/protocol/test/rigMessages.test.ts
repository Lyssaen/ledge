import { describe, it, expect } from 'vitest';
import { parseRigPrompt, rigCommand, rigCommandResult, rigKey, OpenRigRowStateSchema, ThreadItemSchema, type RigBlock } from '../src/index.js';

/** Real prompts, copied from Ledge's journals (`~/.ledge/history`) and from the seats' terminals on 2026-11-02. */
const AT = '2026-11-02T22:00:00.000Z';
const lead = (body: string, sent = 'Sent: 11-02 21:12Z · gen 45f7085e') =>
  `From: pilot-lead@ledge-dev-2\nTo: dev-back@ledge-dev-2\n${sent}\n---\n${body}\n---\n↩ Reply: rig send pilot-lead@ledge-dev-2 "..."`;
const paste = (text: string, id = '8fc5') => `\n\n<pasted_content id="${id}">\n${text}\n</pasted_content id="${id}">\n`;
const one = (text: string): RigBlock => { const b = parseRigPrompt(text, AT); expect(b).toHaveLength(1); return b![0]!; };

describe('parseRigPrompt', () => {
  it('reads a message: sender, recipient, stamp, gen and body, the raw kept', () => {
    const text = lead('Validation maquette encoche (qitem-20261102184644). Ses mots : « Tout est ok, sauf le bouton play ».\n\nSecond paragraphe.\n---\nune ligne --- dans le corps');
    expect(one(text)).toEqual({
      kind: 'message', from: 'pilot-lead@ledge-dev-2', to: 'dev-back@ledge-dev-2', sentAt: '2026-11-02T21:12:00.000Z', gen: '45f7085e',
      body: 'Validation maquette encoche (qitem-20261102184644). Ses mots : « Tout est ok, sauf le bouton play ».\n\nSecond paragraphe.\n---\nune ligne --- dans le corps',
      raw: text
    });
  });

  it('reads it through Claude Code\'s paste tags', () => {
    const b = one(paste(lead('Queue handoff: qitem-20261102211216-d6159d44d566f343 - check your queue. Summary: Back messages OpenRig : parseur partagé + éléments de fil + client de queue (maquette 028c9402 validée), contrat d\'abord')));
    expect(b).toMatchObject({ kind: 'handoff', qitem: 'qitem-20261102211216-d6159d44d566f343', summary: 'Back messages OpenRig : parseur partagé + éléments de fil + client de queue (maquette 028c9402 validée), contrat d\'abord' });
    expect(b.kind !== 'text' && b.raw.startsWith('From: pilot-lead@ledge-dev-2\n')).toBe(true);
  });

  it('reads a handoff without summary, and a stamp without gen or with a delivery delay', () => {
    expect(one(lead('Queue handoff: qitem-20261023090936-14ceed8d - check your queue.', 'Sent: 10-23 09:09Z'))).toMatchObject({ kind: 'handoff', qitem: 'qitem-20261023090936-14ceed8d', sentAt: '2026-10-23T09:09:00.000Z' });
    const b = one(lead('hello', 'Sent: 11-02 21:12Z · gen 45f7085e · delivered +12s'));
    expect(b).toMatchObject({ kind: 'message', gen: '45f7085e', sentAt: '2026-11-02T21:12:00.000Z' });
    expect(one(lead('hello', ''.padEnd(0)).replace('\n\n---', '\n---'))).toMatchObject({ kind: 'message', body: 'hello' });
  });

  it('reads a blocker cleared', () => {
    expect(one(paste(`From: review-qa@ledge-dev
To: pilot-lead@ledge-dev
Sent: 11-02 19:55Z · gen 7254cdee
---
Blocker qitem-20261102195145-4c7203f8 resolved; parked qitem qitem-20261102183615-614acb2be7567669 is pending. Resume the recorded continuation and update the row.
---
↩ Reply: rig send review-qa@ledge-dev "..."`, 'eb26'))).toMatchObject({ kind: 'unblocked', blocker: 'qitem-20261102195145-4c7203f8', qitem: 'qitem-20261102183615-614acb2be7567669' });
  });

  it('reads OpenRig\'s own notices: a stuck sweep names the stalled row, a custody check too', () => {
    expect(one(`From: daemon@kernel
To: pilot-lead@ledge-dev-2
Sent: 11-02 18:54Z
---
Queue handoff: qitem-recovery-a665841e4deeba48 - check your queue. Summary: Stuck sweep: stalled-after-claim on qitem-20261102184222-c844fa05df894750 (7 min)
---
↩ Sent by OpenRig itself, not by a seat. Act on the row it names.`)).toMatchObject({
      kind: 'openrig', alert: 'stalled', qitem: 'qitem-20261102184222-c844fa05df894750', minutes: 7, recovery: 'qitem-recovery-a665841e4deeba48',
      summary: 'Stuck sweep: stalled-after-claim on qitem-20261102184222-c844fa05df894750 (7 min)'
    });
    expect(one(`From: daemon@kernel
To: dev-front@ledge-dev
Sent: 11-02 19:34Z
---
Queue handoff: qitem-recovery-06e20a3c0f7001b6 - check your queue. Summary: Custody not checked: no successor of qitem-20261102185916-b2cb1eaf in this store (4 min)
---
↩ Sent by OpenRig itself, not by a seat. Act on the row it names.`)).toMatchObject({ kind: 'openrig', alert: 'custody', qitem: 'qitem-20261102185916-b2cb1eaf', minutes: 4, recovery: 'qitem-recovery-06e20a3c0f7001b6' });
    // a system actor, with any body: OpenRig's, no alert, the row it names
    expect(one(`From: system:health\nTo: dev-back@ledge-dev-2\n---\nQueue handoff: qitem-recovery-1 - check your queue.\n---\n↩ Sent by OpenRig itself, not by a seat. Act on the row it names.`))
      .toMatchObject({ kind: 'openrig', qitem: 'qitem-recovery-1', recovery: 'qitem-recovery-1' });
  });

  it('marks a recovered delivery', () => {
    const b = parseRigPrompt(paste(`Recovered queue notification: delivery may repeat after an earlier unconfirmed attempt.
From: operator-agent@kernel
To: pilot-lead@ledge-dev-2
Sent: 11-02 18:43Z · gen 6a740950
---
Queue handoff: qitem-20261102184344-0c981326289b30b8 - check your queue. Summary: Réponses utilisateur
---
↩ Reply: rig send operator-agent@kernel "..."`, 'ee09'), AT);
    expect(b).toEqual([expect.objectContaining({ kind: 'handoff', recovered: true, qitem: 'qitem-20261102184344-0c981326289b30b8' })]);
    expect(b![0]!.kind !== 'text' && b![0]!.raw.startsWith('From: ')).toBe(true);
  });

  it('reads blocks pasted together, and the scheduler\'s note glued to the last footer', () => {
    const b = parseRigPrompt(`From: research-analyst@epic-discovery
To: orch-lead@epic-discovery
Sent: 10-23 12:23Z · gen d990cac4
---
Blocker qitem-20261023121505-b0e71b4c58784a26 resolved; parked qitem qitem-20261023121706-f4355679 is pending. Resume the recorded continuation and update the row.
---
↩ Reply: rig send research-analyst@epic-discovery "..."
From: research-analyst@epic-discovery
To: orch-lead@epic-discovery
Sent: 10-23 12:23Z · gen d990cac4
---
Queue handoff: qitem-20261023122333-69f935e8 - check your queue. Summary: SBT-259 : analysis.md prêt
---
↩ Reply: rig send research-analyst@epic-discovery "..."[OpenRig watchdog scheduler · policy: parked-owner-consumer · job: 01M5MAT00EP51G9HH0X9S15V37]
You are parked (arbitrated: idle at prompt) while holding 1 open obligation: qitem-20261023121706-f4355679.`, AT)!;
    expect(b.map(x => x.kind)).toEqual(['unblocked', 'handoff', 'openrig']);
    expect(b[1]!.kind !== 'text' && b[1]!.raw.endsWith('↩ Reply: rig send research-analyst@epic-discovery "..."')).toBe(true);
    expect(b[2]).toMatchObject({ kind: 'openrig', body: expect.stringMatching(/^\[OpenRig watchdog scheduler[\s\S]*1 open obligation/) });
  });

  it('reads a person\'s message through Ledge and its own footer', () => {
    expect(one(`From: ledge@external\nTo: dev-review@starter\nSent: 10-31 18:03Z\n---\nQueue handoff: qitem-20261031180316-05eeb59cad49e50f - check your queue. Summary: Réponse de Ledge : Bleu\n---\n↩ Reply if needed: rig queue create --destination ledge@external --summary "<one line>" --body "..." --verify`))
      .toMatchObject({ kind: 'handoff', from: 'ledge@external', qitem: 'qitem-20261031180316-05eeb59cad49e50f' });
    expect(one(`From: <unknown sender>\nTo: orch-lead@epic-discovery\nSent: 10-24 10:07Z\n---\nNouvelles consignes\n---\n↩ Reply: rig send <unknown sender> "..."`))
      .toMatchObject({ kind: 'message', from: '<unknown sender>', body: 'Nouvelles consignes' });
  });

  it('keeps the user\'s own words around the blocks as theirs', () => {
    const b = parseRigPrompt(`Ok pour moi le notch. \n\n\n${lead('dev-front : « À toi »')}\nEt regarde aussi le mobile.`, AT)!;
    expect(b.map(x => x.kind)).toEqual(['text', 'message', 'text']);
    expect(b[0]).toEqual({ kind: 'text', text: 'Ok pour moi le notch.' });
    expect(b[2]).toEqual({ kind: 'text', text: 'Et regarde aussi le mobile.' });
  });

  it('shows a block that does not read to its end as unreadable, never as the user\'s', () => {
    // the mockup's case: no Sent, no footer
    const bad = 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nRelance : la maquette est-elle prête ?';
    expect(parseRigPrompt(bad, AT)).toEqual([{ kind: 'unreadable', raw: bad }]);
    // a prompt cut by an older hook (500 characters), then a whole block after an unreadable one
    const cut = 'From: review-reviewer@epic-discovery\nTo: orch-lead@epic-discovery\nSent: 10-24 10:41Z · gen 765c83b7\n---\nQueue handoff: qitem-20261024104119-ba9e93';
    expect(parseRigPrompt(`${cut}\n${lead('suite')}`, AT)!.map(x => x.kind)).toEqual(['unreadable', 'message']);
  });

  it('leaves the user\'s prompts alone', () => {
    expect(parseRigPrompt('Corrige le test', AT)).toBeUndefined();
    expect(parseRigPrompt('', AT)).toBeUndefined();
    expect(parseRigPrompt(paste('du code collé'), AT)).toBeUndefined();
    // the user's words, then something that only looks like an envelope: still the user's
    expect(parseRigPrompt('Regarde ce mail :\nFrom: a@b.c\nTo: d@e.f\nSubject: hi', AT)).toBeUndefined();
    // a From line without To
    expect(parseRigPrompt('From: here we go', AT)).toBeUndefined();
  });

  it('dates a stamp of late December received in January in the year before', () => {
    expect(parseRigPrompt(lead('x', 'Sent: 12-31 23:59Z'), '2027-01-01T00:01:00.000Z')![0]).toMatchObject({ sentAt: '2026-12-31T23:59:00.000Z' });
  });
});

describe('rigKey', () => {
  it('tells a repeated delivery from another message of the same generation', () => {
    const [a] = parseRigPrompt(lead('Ligne créée pour toi'), AT)!;
    const [again] = parseRigPrompt(`Recovered queue notification: delivery may repeat after an earlier unconfirmed attempt.\n${lead('Ligne créée pour toi')}`, AT)!;
    const [other] = parseRigPrompt(lead('Autre chose'), AT)!;
    expect(rigKey(a as never)).toBe(rigKey(again as never));
    expect(rigKey(a as never)).not.toBe(rigKey(other as never));
    expect(rigKey({ from: 'a', body: 'x' })).toBeUndefined(); // no stamp: nothing tells them apart
  });
});

describe('rigCommand', () => {
  it('reads the seat\'s own rig send', () => {
    expect(rigCommand('rig send dev-front@ledge-dev-2 "dev-back : contrat posé, commit 1a2b3c"')).toEqual({ kind: 'message', to: 'dev-front@ledge-dev-2', body: 'dev-back : contrat posé, commit 1a2b3c' });
    expect(rigCommand("rig send review-qa@ledge-dev-2 'l\\'essai' --verify")).toBeUndefined(); // an unclosed quote
    expect(rigCommand('rig send review-qa@ledge-dev-2 "ok" --verify --wait-for-idle 30')).toEqual({ kind: 'message', to: 'review-qa@ledge-dev-2', body: 'ok' });
    expect(rigCommand('cd ~/w && rig send a@b "x \\"y\\""')).toEqual({ kind: 'message', to: 'a@b', body: 'x "y"' });
    expect(rigCommand('rig send --to a@b,c@d "both"')).toEqual({ kind: 'message', to: 'a@b,c@d', body: 'both' });
  });

  it('reads its handoffs and creates', () => {
    expect(rigCommand('rig queue handoff qitem-20261102205801-ae61eb9d7f1f4b49 --to pilot-lead@ledge-dev-2 --body-file /tmp/r.md --tags overlay-activity --summary "Installateur NSIS 0.36.0 construit" --note "ok"'))
      .toEqual({ kind: 'handoff', op: 'handoff', to: 'pilot-lead@ledge-dev-2', from: 'qitem-20261102205801-ae61eb9d7f1f4b49', summary: 'Installateur NSIS 0.36.0 construit' });
    expect(rigCommand('rig queue create --source me@r --destination review-qa@ledge-dev-2 --summary="Revue 3" --body "voir commit"'))
      .toEqual({ kind: 'handoff', op: 'create', to: 'review-qa@ledge-dev-2', summary: 'Revue 3', body: 'voir commit' });
  });

  it('leaves any other command a Bash row', () => {
    for (const c of ['rig queue show qitem-1 --json', 'rig send a@b "x" | tail', 'rig send a@b "$(cat f)"', 'rig send a@b --raw "x"', 'echo rig send a@b "x"',
      'rig queue handoff qitem-1 --summary x', 'rig send a@b "x" && rig send c@d "y"', 'rig queue create --summary x <<EOF'])
      expect(rigCommand(c), c).toBeUndefined();
  });

  it('reads what the command printed', () => {
    const send = rigCommand('rig send a@b "x"')!;
    expect(rigCommandResult(send, 'Sent to a@b\nVerified: yes', false)).toEqual({ status: 'delivered' });
    expect(rigCommandResult(send, 'Retained, not delivered to a@b.', false)).toEqual({ status: 'failed' });
    expect(rigCommandResult(send, '{"ok":true}', false)).toEqual({ status: 'delivered' });
    expect(rigCommandResult(send, 'error', true)).toEqual({ status: 'failed' });
    const handoff = rigCommand('rig queue handoff qitem-1-a --to a@b')!;
    expect(rigCommandResult(handoff, '{"closed":{"qitemId":"qitem-1-a"},"qitemId":"qitem-2-b"}', false)).toEqual({ status: 'delivered', qitem: 'qitem-2-b' });
  });
});

describe('the contract', () => {
  it('carries rig on received, sent and notice items, and a row\'s state', () => {
    const rig = { kind: 'handoff' as const, from: 'pilot-lead@ledge-dev-2', to: 'dev-back@ledge-dev-2', qitem: 'qitem-1-a', raw: 'From: …', count: 2, packet: { id: 'prompt-3', index: 0, count: 2 } };
    expect(ThreadItemSchema.parse({ kind: 'notice', id: 'n', at: AT, turn: 1, notice: 'other', text: 'Queue handoff', rig }).kind).toBe('notice');
    expect(ThreadItemSchema.parse({ kind: 'received', id: 'r', at: AT, turn: 1, from: 'pilot-lead@ledge-dev-2', text: 'x', rig: { ...rig, kind: 'message' } }).kind).toBe('received');
    expect(() => ThreadItemSchema.parse({ kind: 'notice', id: 'n', at: AT, turn: 1, notice: 'other', text: 'x', rig: { ...rig, count: 1 } })).toThrow();
    expect(OpenRigRowStateSchema.parse({ type: 'openrig.rowState', requestId: 'q', qitem: 'qitem-1-a', row: { id: 'qitem-1-a', state: 'handed-off', from: 'a@r', to: 'b@r', handedOffTo: 'c@r', createdAt: AT, updatedAt: AT, at: AT } }).row?.handedOffTo).toBe('c@r');
  });
});
