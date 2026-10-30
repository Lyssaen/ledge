import { describe, expect, it } from 'vitest';
import { agentsOf } from '../../src/model/agents';
import { closeCuts, closedHere, closeHeld, closingHere, endedAtLabel, endingOf, resumeHeld, SETTLE_MS } from '../../src/model/sessionEnd';
import { threadItems } from '../../src/model/thread';
import type { Op } from '../../src/state/operations';
import { pending, session } from './fixtures';

const AT = '2026-10-29T18:41:00.000Z';
const NOW = Date.parse(AT) + 1_000;
const ASSERTION = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };
let n = 0;
/** This phone's close (or resume) of session `a`, sent at AT. */
const op = (phase: Op['phase'], extra: Partial<Op> & { type?: 'session.close' | 'session.resume' } = {}): Record<string, Op> => {
  const { type = 'session.close', ...rest } = extra;
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  return { [id]: { op: id, message: { type, op: id, id: 'a', assertion: ASSERTION }, phase, at: AT, ...rest } };
};
const nova = (extra: Parameters<typeof session>[1] = {}) => session('a', { name: 'Nova', ...extra });

describe('a session closed from the phone, as its page shows it', () => {
  it('is open with nothing of this phone, ended once exited', () => {
    expect(endingOf(nova(), {}, NOW)).toEqual({ kind: 'open', error: null });
    expect(endingOf(nova({ state: 'exited' }), {}, NOW)).toEqual({ kind: 'ended', killed: false, error: null });
  });

  it('is closing while the close is on its way, and while the PC applied it but the session does not say it ended yet', () => {
    expect(endingOf(nova(), op('sending'), NOW).kind).toBe('closing');
    expect(endingOf(nova(), op('applied'), NOW).kind).toBe('closing');
    // Past the window, an applied close no longer holds the page: the session was started again from elsewhere.
    expect(endingOf(nova(), op('applied'), Date.parse(AT) + SETTLE_MS)).toEqual({ kind: 'open', error: null });
  });

  it('reads a close under way elsewhere as closing, and one the PC says already ended as ended, never an error', () => {
    expect(endingOf(nova(), op('rejected', { reason: 'busy' }), NOW).kind).toBe('closing');
    expect(endingOf(nova(), op('rejected', { reason: 'ended' }), NOW)).toEqual({ kind: 'ended', killed: false, error: null });
    expect(endingOf(nova({ state: 'exited' }), op('rejected', { reason: 'ended' }), NOW)).toEqual({ kind: 'ended', killed: false, error: null });
  });

  it('says killed only for its own close that had to force the agent', () => {
    expect(endingOf(nova({ state: 'exited' }), op('applied', { how: 'killed' }), NOW)).toMatchObject({ kind: 'ended', killed: true });
    expect(endingOf(nova({ state: 'exited' }), op('applied', { how: 'exit' }), NOW)).toMatchObject({ kind: 'ended', killed: false });
  });

  it('gives a refusal its words: failed with a retry, read-only without, a lost link with a reconnect', () => {
    expect(endingOf(nova(), op('failed'), NOW)).toMatchObject({ kind: 'open', error: { title: 'Nova n’a pas été fermée', body: 'Le PC n’a pas pu arrêter l’agent. Vérifiez sur le PC, ou réessayez.', retry: true } });
    expect(endingOf(nova(), op('rejected', { reason: 'assertion_expired' }), NOW)).toMatchObject({ error: { retry: true } });
    const ro = endingOf(nova(), op('rejected', { reason: 'read_only' }), NOW);
    expect(ro).toMatchObject({ error: { body: 'Elle a été démarrée hors de Ledge : fermez-la dans son terminal sur le PC.' } });
    expect(ro.kind === 'open' && ro.error).not.toHaveProperty('retry');
    expect(endingOf(nova(), op('uncertain'), NOW)).toMatchObject({ error: { title: 'Fermeture non confirmée', body: 'La connexion a été perdue. Nova est peut-être déjà fermée : son état se mettra à jour à la reconnexion.', reconnect: true } });
  });

  it('follows a resume: under way, then the session back; a refusal keeps the ended card with its words', () => {
    const ended = nova({ state: 'exited' });
    expect(endingOf(ended, op('sending', { type: 'session.resume' }), NOW).kind).toBe('resuming');
    expect(endingOf(ended, op('applied', { type: 'session.resume' }), NOW).kind).toBe('resuming');
    expect(endingOf(nova({ state: 'starting' }), op('applied', { type: 'session.resume' }), NOW)).toEqual({ kind: 'open', error: null });
    expect(endingOf(ended, op('rejected', { type: 'session.resume', reason: 'no_conversation' }), NOW)).toMatchObject({ kind: 'ended', error: { title: 'Nova n’a pas repris', body: 'Aucune conversation à reprendre pour cette session.' } });
    expect(endingOf(ended, op('failed', { type: 'session.resume' }), NOW)).toMatchObject({ kind: 'ended', error: { body: 'Le PC n’a pas pu relancer l’agent. Vérifiez sur le PC, ou réessayez.', retry: true } });
  });

  it('follows the latest of a close and a resume', () => {
    const ops = { ...op('applied', { how: 'killed' }), ...op('sending', { type: 'session.resume' }) };
    // The resume was sent after the close (same `at`, later id): sort by time keeps the order they were made in.
    const resume = Object.values(ops).find(o => o.message.type === 'session.resume')!;
    resume.at = '2026-10-29T18:50:00.000Z';
    expect(endingOf(nova({ state: 'exited' }), ops, Date.parse(resume.at)).kind).toBe('resuming');
    expect(closedHere(nova({ state: 'exited' }), ops)).toBe(false);
  });

  it('a close the PC says already ended reads as ended for a moment, before the session’s update', () => {
    expect(endingOf(nova(), op('rejected', { reason: 'ended' }), NOW)).toEqual({ kind: 'ended', killed: false, error: null });
    expect(endingOf(nova(), op('rejected', { reason: 'ended' }), Date.parse(AT) + SETTLE_MS)).toEqual({ kind: 'open', error: null });
  });

  it('ties a close to the run it ended, and a resume to the run it started, by the session’s startedAt', () => {
    const first = nova().startedAt, second = '2026-10-29T19:00:00.000Z';
    const closed = op('applied', { how: 'killed', startedAt: first });
    // Its end: killed, closed here. Resumed from the PC (a new run): open at once. That run's end: not its own.
    expect(endingOf(nova({ state: 'exited', exitedAt: AT }), closed, NOW)).toMatchObject({ kind: 'ended', killed: true });
    expect(closedHere(nova({ state: 'exited', exitedAt: AT }), closed)).toBe(true);
    expect(endingOf(nova({ startedAt: second }), closed, NOW)).toEqual({ kind: 'open', error: null });
    const later = nova({ state: 'exited', exitedAt: '2026-10-29T20:42:00.000Z', startedAt: second });
    expect(endingOf(later, closed, NOW)).toMatchObject({ kind: 'ended', killed: false });
    expect(closedHere(later, closed)).toBe(false);
    const resumed = op('applied', { type: 'session.resume', startedAt: first });
    // Taken (a new run), then ended again at once: the ended card, not « Reprise… ».
    expect(endingOf(nova({ state: 'exited', startedAt: second }), resumed, NOW)).toEqual({ kind: 'ended', killed: false, error: null });
    expect(endingOf(nova({ state: 'exited' }), resumed, NOW).kind).toBe('resuming');
  });

  it('holds « Fermer » while a close is under way, or unknown and still sent again by itself', () => {
    expect(closeHeld(nova(), op('sending'), null, NOW)).toBe(true);
    expect(closeHeld(nova(), op('uncertain'), null, NOW)).toBe(true);
    // Received by a PC that has restarted since: it may never go again, a new close is the way.
    expect(closeHeld(nova(), op('uncertain', { received: true, boot: 'old' }), 'new', NOW)).toBe(false);
    expect(closeHeld(nova(), op('failed'), null, NOW)).toBe(false);
  });

  it('a refused device check is said as such, not as the PC failing to stop or start the agent, with a retry', () => {
    for (const [reason, body] of [['assertion_expired', 'La vérification a expiré. Recommencez.'], ['assertion_invalid', 'La vérification de l’appareil n’a pas abouti. Rien n’a été envoyé. Réessayez.'], ['confirm_required', 'La vérification de l’appareil n’a pas abouti. Rien n’a été envoyé. Réessayez.']] as const) {
      expect(endingOf(nova(), op('rejected', { reason }), NOW)).toMatchObject({ kind: 'open', error: { title: 'Nova n’a pas été fermée', body, retry: true } });
      expect(endingOf(nova({ state: 'exited' }), op('rejected', { type: 'session.resume', reason }), NOW)).toMatchObject({ kind: 'ended', error: { title: 'Nova n’a pas repris', body, retry: true } });
    }
  });

  it('a resume of unknown outcome is not shown as under way: the ended card, waiting for the link, or failed once it will not go again', () => {
    const ended = nova({ state: 'exited' });
    const ops = op('uncertain', { type: 'session.resume', received: true, boot: 'b1' });
    const waiting = { kind: 'ended', killed: false, error: { title: 'Reprise non confirmée', body: 'La connexion a été perdue. Nova a peut-être déjà repris : son état se mettra à jour à la reconnexion.', reconnect: true } };
    expect(endingOf(ended, ops, NOW)).toMatchObject(waiting);
    expect(endingOf(ended, ops, NOW, { fresh: false, boot: 'b1' })).toMatchObject(waiting);
    expect(resumeHeld(ended, ops, 'b1', NOW)).toBe(true);
    // The PC restarted: it will never be sent again. Failed, retried by hand.
    expect(endingOf(ended, ops, NOW, { fresh: true, boot: 'b2' })).toMatchObject({ kind: 'ended', error: { title: 'Nova n’a pas repris', body: 'Le PC n’a pas pu relancer l’agent. Vérifiez sur le PC, ou réessayez.', retry: true } });
    expect(resumeHeld(ended, ops, 'b2', NOW)).toBe(false);
    // Too old to go again, too.
    expect(endingOf(ended, ops, Date.parse(AT) + 300_000, { fresh: true, boot: 'b1' })).toMatchObject({ error: { retry: true } });
  });

  it('a close of unknown outcome that will not go again, the link back, is a failure to retry, not a wait', () => {
    const ops = op('uncertain', { received: true, boot: 'b1' });
    expect(endingOf(nova(), ops, NOW, { fresh: false, boot: 'b1' })).toMatchObject({ error: { title: 'Fermeture non confirmée', reconnect: true } });
    expect(endingOf(nova(), ops, NOW, { fresh: true, boot: 'b2' })).toMatchObject({ kind: 'open', error: { title: 'Nova n’a pas été fermée', body: 'Le PC n’a pas pu arrêter l’agent. Vérifiez sur le PC, ou réessayez.', retry: true } });
  });

  it('closingHere is what the list says « Fermeture… » for', () => {
    expect(closingHere(nova(), op('sending'), NOW)).toBe(true);
    expect(closingHere(nova({ state: 'exited' }), op('applied'), NOW)).toBe(false);
    expect(closingHere(nova(), {}, NOW)).toBe(false);
  });
});

describe('what the close cuts', () => {
  it('says nothing of a session at rest', () => {
    expect(closeCuts(nova())).toEqual([]);
  });
  it('says the turn, the request and the helpers, in that order', () => {
    const helper = (id: string, state: 'working' | 'exited') => ({ id, kind: 'Explore', task: 't', state });
    expect(closeCuts(nova({ state: 'working', helpers: [helper('h1', 'working'), helper('h2', 'working'), helper('h3', 'exited')] }))).toEqual([
      'Nova travaille : son tour en cours sera interrompu. Ce qui est déjà fait reste fait.',
      '2 sous-agents s’arrêtent avec la session.'
    ]);
    // Waiting on a request, the turn is interrupted too, but the agent is not « at work »: its own words.
    const turn = 'Le tour en cours de Nova sera interrompu. Ce qui est déjà fait reste fait.';
    expect(closeCuts(nova({ state: 'waiting_permission', pending: pending() }))).toEqual([turn, 'La demande en attente sera refusée.']);
    expect(closeCuts(nova({ state: 'waiting_permission', pending: pending(), helpers: [helper('h1', 'working')] }))).toEqual([turn, 'La demande en attente sera refusée.', '1 sous-agent s’arrête avec la session.']);
    expect(closeCuts(nova({ state: 'waiting_input', pending: pending({ kind: 'question' }) }))).toEqual([turn, 'La question en attente restera sans réponse.']);
    expect(closeCuts(nova({ state: 'waiting_permission', pending: pending() })).join(' ')).not.toMatch(/travaille/);
  });
});

describe('when an ended session ended', () => {
  const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime();
  it('is a time today, « hier », else the day', () => {
    const now = local(2026, 10, 29, 20, 0);
    expect(endedAtLabel(new Date(local(2026, 10, 29, 18, 42)).toISOString(), now)).toBe('à 18:42');
    expect(endedAtLabel(new Date(local(2026, 10, 28, 23, 59)).toISOString(), now)).toBe('hier');
    expect(endedAtLabel(new Date(local(2026, 10, 27, 9, 0)).toISOString(), now)).toBe('le 27 oct.');
  });
  it('rides on the row of an ended session only', () => {
    const [g] = agentsOf([nova({ state: 'exited', exitedAt: AT }), session('b', { exitedAt: AT })]);
    expect(g!.rows.map(r => r.endedAt)).toEqual([AT, undefined]);
    expect(g!.rows[0]!.status).toEqual({ tone: 'muted', label: 'Terminée' });
  });
});

describe('the thread of a session closed from the phone', () => {
  it('ends with the close, at the moment the session ended', () => {
    const ended = nova({ state: 'exited', exitedAt: AT });
    const items = threadItems([{ kind: 'reply', id: 'r1', at: '2026-10-29T18:30:00.000Z', turn: 1, text: 'Fait.' }], ended, op('applied', { how: 'exit' }));
    const time = new Date(AT).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    expect(items.at(-1)).toEqual({ key: `closed-${AT}`, kind: 'event', label: `Session fermée depuis le téléphone · ${time}`, at: AT });
    // Ended without this phone: no such line.
    expect(threadItems([], ended, {}).some(i => i.kind === 'event')).toBe(false);
  });
});
