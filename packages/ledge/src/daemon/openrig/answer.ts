import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Escalation, OpenRigStatus, RigResultCode } from '@ledge/protocol';
import { log } from '../../log.js';
import type { Asks } from '../asks.js';
import type { EscalationPatch } from './bridge.js';
import type { RigCli } from './cli.js';
import type { OpenRigHttp } from './http.js';
import { HUMAN_ADDRESS, type AnswerPathKind } from './facts.js';

/** What the lot 0 facts sheet settled (`ANSWER_PATH` in facts.ts). */
export type AnswerPath = { kind: AnswerPathKind };
export const ANSWER_CODES = ['already_answered', 'openrig_down', 'unreachable', 'failed', 'invalid'] as const satisfies readonly RigResultCode[];
export type AnswerCode = typeof ANSWER_CODES[number];
export type AnswerResult = { ok: true; escalation: Escalation } | { ok: false; code: AnswerCode; reason: string };
export interface Answers {
  answer(id: string, answers: Record<string, string>, by: 'user' | 'ledge', o?: { rule?: string }): Promise<AnswerResult>;
  /** Called once per successful answer (lot 7 hooks decisions and memory there); returns its unsubscribe. */
  onAnswered(fn: (e: Escalation) => void): () => void;
}
/** The slice of the OpenRig bridge answers need (`patch` = `bridge.patchEscalation`). */
export interface AnswerPort {
  escalation(id: string): Escalation | undefined;
  patch(id: string, p: EscalationPatch): Escalation | undefined;
  status(): OpenRigStatus;
  cli(): Pick<RigCli, 'queueCreate'>;
  http(): Pick<OpenRigHttp, 'action'> | null;
  replyRow(id: string): string | undefined;
  setReplyRow(id: string, row: string): void;
}
export interface AnswersDeps {
  port: AnswerPort;
  /** Lot 1 asks (`ask-<id>` escalations are answered there, without OpenRig). */
  asks?: Pick<Asks, 'answer'>;
  path: AnswerPath;
  localMachine: string;
  now?: () => string;
}

const PREFIX = 'Réponse de Ledge : ';
const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '';
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Each answered question as `<question> → <option label>`; a value that is no option id is free text, quoted as is. */
function answeredLines(e: Escalation, answers: Record<string, string>): string[] {
  return e.questions.flatMap(q => {
    const v = answers[q.id]; if (blank(v)) return [];
    return [`${q.question} → ${q.options.find(o => o.id === v)?.label ?? v!.trim()}`];
  });
}

/** « Réponse de Ledge : <question> → <label> », one line per question; without questions, the free text (`text`) itself. */
export function answerBody(e: Escalation, answers: Record<string, string>): string {
  if (!e.questions.length) return (answers.text ?? '').trim();
  const lines = answeredLines(e, answers).map(l => `${PREFIX}${l}`);
  if (!blank(answers.text)) lines.push(`${PREFIX}${answers.text!.trim()}`);
  return lines.join('\n');
}

/** The reply row's summary: the seat sees only it (facts D6), so it carries the whole answer on one line. */
function answerSummary(e: Escalation, answers: Record<string, string>): string {
  const parts = e.questions.length ? answeredLines(e, answers) : [];
  if (!blank(answers.text)) parts.push(answers.text!);
  return oneLine(`${PREFIX}${parts.join(' ; ')}`);
}

/** The sheet's « Chemin de réponse : … » line, bare or as a list item; absent → reply-and-approve (logged). */
export function readAnswerPath(factsMarkdown: string): AnswerPath {
  const m = /^[ \t]*(?:[-*][ \t]+)?Chemin de réponse[ \t]*:[ \t]*(reply-and-approve|approve-only|resolve)\b/m.exec(factsMarkdown);
  if (m) return { kind: m[1] as AnswerPathKind };
  log('openrig facts: no « Chemin de réponse » line, answering with reply-and-approve');
  return { kind: 'reply-and-approve' };
}

/** A refusal before anything is sent; null when the answer is complete. An `update` answered with nothing is a « seen ». */
function invalid(e: Escalation, answers: Record<string, string>): string | null {
  if (e.intent === 'update' && e.source !== 'ask' && Object.keys(answers).length === 0) return null;
  if (!e.questions.length) return blank(answers.text) ? 'la réponse est vide' : null;
  const missing = e.questions.filter(q => blank(answers[q.id]));
  return missing.length ? `sans réponse : ${missing.map(q => q.question).join(', ')}` : null;
}

/**
 * Answers an escalation once: the first answer wins. The check and the mark happen before the first await (the daemon is
 * single-threaded), the escalation turns `answered` at once and goes back to its state before on failure. The reply row is
 * noted before the approve, so a retry never creates a second one.
 */
export function createAnswers(d: AnswersDeps): Answers {
  const now = d.now ?? (() => new Date().toISOString());
  const inFlight = new Set<string>();
  const listeners = new Set<(e: Escalation) => void>();
  const refuse = (code: AnswerCode, reason: string): AnswerResult => ({ ok: false, code, reason });

  /** The mission-control action; 409 qitem_already_terminal = closed elsewhere (facts D7). */
  async function act(http: Pick<OpenRigHttp, 'action'>, body: Record<string, unknown>): Promise<AnswerResult | null> {
    const r = await http.action(body, { session: HUMAN_ADDRESS });   // header X-OpenRig-Session, no actorSession (facts D8)
    if (r.status >= 200 && r.status < 300) return null;
    const err = (r.json as { error?: unknown } | null)?.error;
    if (r.status === 409 && err === 'qitem_already_terminal') return refuse('already_answered', 'déjà fermée dans OpenRig');
    return refuse('failed', `OpenRig a répondu ${r.status}${typeof err === 'string' ? ` (${err})` : ''}`);
  }

  /** Reply row to the seat, unless one is already noted for this escalation. */
  async function replyRow(e: Escalation, answers: Record<string, string>): Promise<AnswerResult | null> {
    if (d.port.replyRow(e.id)) return null;
    const dir = await mkdtemp(join(tmpdir(), 'ledge-reply-'));
    try {
      const file = join(dir, 'reply.md'); await writeFile(file, answerBody(e, answers));
      const r = await d.port.cli().queueCreate({ source: HUMAN_ADDRESS, destination: e.from, summary: answerSummary(e, answers), bodyFile: file,
        ...(e.intent === 'update' ? { replyTo: e.id } : {}) });
      if (!r.ok) return refuse('failed', r.detail ?? 'rig queue create a échoué');
      if (!r.qitemId) log(`openrig: reply row for ${e.id} created, its id not read from the output`);
      d.port.setReplyRow(e.id, r.qitemId ?? '?');
      return null;
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }

  /** Sends the answer to OpenRig; null on success. */
  async function deliver(e: Escalation, answers: Record<string, string>): Promise<AnswerResult | null> {
    const http = d.port.http(); if (!http) return refuse('openrig_down', "OpenRig n'est pas joignable");
    const body = answerBody(e, answers);
    const seen = e.intent === 'update' && Object.keys(answers).length === 0;
    if (seen) return act(http, { verb: 'approve', qitemId: e.id, annotation: 'Vu' });
    switch (d.path.kind) {
      case 'reply-and-approve': {
        // A reply row noted before this try means an earlier try sent it, then lost its approve's answer (a timeout): if
        // OpenRig applied that approve, the retry's 409 terminal is our own answer landing, not someone else's.
        const retry = d.port.replyRow(e.id) !== undefined;
        const r = (await replyRow(e, answers)) ?? await act(http, { verb: 'approve', qitemId: e.id, annotation: body });
        return retry && r && !r.ok && r.code === 'already_answered' ? null : r;
      }
      case 'approve-only': return act(http, { verb: 'approve', qitemId: e.id, annotation: body });
      case 'resolve': return act(http, { verb: 'resolve', qitemId: e.id, decision: body });   // facts D9 (plan B, not used)
    }
  }

  function viaAsk(e: Escalation, answers: Record<string, string>): AnswerResult | null {
    if (!d.asks) return refuse('failed', 'les décisions de session ne sont pas branchées');
    const r = d.asks.answer(e.id.slice('ask-'.length), answerBody(e, answers));
    if (!('code' in r)) return null;
    return r.code === 'closed' ? refuse('already_answered', r.reason) : refuse('failed', r.reason);
  }

  return {
    async answer(id, answers, by, o) {
      const e = d.port.escalation(id);
      if (!e) return refuse('failed', `aucune escalade ${id}`);
      // Check and mark, synchronously (no await before inFlight.add): the first answer wins, whatever a later one holds.
      if (inFlight.has(id) || e.state === 'answered' || e.state === 'closed') return refuse('already_answered', 'déjà répondue');
      const bad = invalid(e, answers); if (bad) return refuse('invalid', bad);
      if (e.machine !== d.localMachine) return refuse('unreachable', 'réponse à distance : lot 6');
      const ask = e.source === 'ask';
      if (!ask && d.port.status().state !== 'running') return refuse('openrig_down', "OpenRig n'est pas lancé");
      inFlight.add(id);
      const before: EscalationPatch = { state: e.state, graceUntil: e.graceUntil, answer: undefined };
      d.port.patch(id, { state: 'answered', answer: { by, answers, at: now(), ...(o?.rule ? { rule: o.rule } : {}) } });
      let fail: AnswerResult | null;
      try { fail = ask ? viaAsk(e, answers) : await deliver(e, answers); }
      catch (err) { fail = refuse('failed', (err as Error).message); }
      finally { inFlight.delete(id); }
      if (fail) {
        // Closed elsewhere: no answer of ours to show. Any other failure: back to the state before.
        d.port.patch(id, !fail.ok && fail.code === 'already_answered' ? { state: 'closed', answer: undefined } : before);
        log(`openrig: answer to ${id} not delivered (${!fail.ok ? `${fail.code}: ${fail.reason}` : ''})`);
        return fail;
      }
      const done = d.port.escalation(id) ?? { ...e, state: 'answered' };
      for (const fn of listeners) { try { fn(done); } catch (err) { log(`openrig: onAnswered listener threw: ${(err as Error).message}`); } }
      return { ok: true, escalation: done };
    },
    onAnswered(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
