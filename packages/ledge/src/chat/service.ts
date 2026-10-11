import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChatTurn, ServerMessage, Session } from '@ledge/protocol';
import type { Store } from '../daemon/store.js';
import type { Tmux } from '../tmux.js';
import { gitSummary } from '../daemon/git.js';
import { writeContext, stepFor } from './context.js';
import { runClaude, type RunHandle } from './claude.js';
import { log } from '../log.js';

export type ChatMessage = Extract<ServerMessage, { type: 'chat.history' | 'chat.step' | 'chat.delta' | 'chat.done' | 'chat.error' }>;
export interface Chat { ask(qid: string, text: string, emit: (m: ChatMessage) => void): Promise<void>; cancel(qid: string): void; reset(emit: (m: ChatMessage) => void): Promise<void>; history(): ChatTurn[] }
export interface ChatDeps {
  store: Store; tmux: Pick<Tmux, 'capture'>; home: string;
  /** The environment the chat process runs in (the login shell's PATH, like a launched agent). */
  env: () => Promise<NodeJS.ProcessEnv>;
  now?: () => string; today?: () => string; uuid?: () => string; bin?: string[]; spawn?: typeof nodeSpawn; timeoutMs?: number;
}

export const ONE_AT_A_TIME = 'one question at a time: wait for the answer';
/** How many of the day's turns are kept for a client that connects later. */
const HISTORY_MAX = 50;
/** The lines of a terminal Ledge gets to read. */
const PANE_LINES = 40;

const sameStep = (a: ChatTurn['steps'][number], b: ChatTurn['steps'][number]) => a.kind === b.kind && a.id === b.id && a.path === b.path;

/** One conversation with Ledge per day, run by `claude -p` (spec 2026-10-11 §5). */
export function createChat(deps: ChatDeps): Chat {
  const now = deps.now ?? (() => new Date().toISOString());
  const today = deps.today ?? (() => now().slice(0, 10));
  const uuid = deps.uuid ?? randomUUID;
  const dayFile = join(deps.home, 'chat.json');
  let turns: ChatTurn[] = []; let turnsDay = '';
  /** Set the moment a question is accepted. */
  let busy = false;
  /** Set by a reset: the next question starts a new Claude session (`--session-id`) instead of resuming the day's. */
  let freshNext = false;
  /** The running question, from its first line (so a Stop while the context is built counts); `handle` once Claude Code has spawned. */
  type Running = { qid: string; handle: RunHandle | null; cancelled: boolean };
  let current: Running | null = null;
  const CANCELLED = { ok: false as const, message: 'cancelled', resumed: false };

  /** A new day starts an empty history; the day file decides the Claude session separately. */
  function rollDay(): void { const day = today(); if (turnsDay !== day) { turns = []; turnsDay = day; } }

  /** Today's Claude session: resumed from the day file when it names today, else a fresh id written there (`fresh` forces one). */
  async function daySession(fresh: boolean): Promise<{ sessionId: string; resume: boolean }> {
    const day = today();
    if (!fresh && !freshNext) {
      try { const saved = JSON.parse(await readFile(dayFile, 'utf8')) as { day?: string; sessionId?: string }; if (saved.day === day && saved.sessionId) return { sessionId: saved.sessionId, resume: true }; } catch { /* none yet */ }
    }
    const sessionId = uuid();
    await mkdir(dirname(dayFile), { recursive: true }); await writeFile(dayFile, JSON.stringify({ day, sessionId })); freshNext = false;
    return { sessionId, resume: false };
  }

  const capture = async (s: Session) => { if (!s.tmuxSession) return null; const p = await deps.tmux.capture(s.tmuxSession, PANE_LINES); return p === null ? null : p.split('\n'); };

  const contextDir = join(deps.home, 'chat', 'context');

  /** One run; the context folder (terminal tails, last replies) is removed once it ends, whatever the outcome. */
  async function attempt(turn: ChatTurn, emit: (m: ChatMessage) => void, fresh: boolean, mine: Running): Promise<{ ok: true } | { ok: false; message: string; resumed: boolean }> {
    try { return await run(turn, emit, fresh, mine); } finally { mine.handle = null; await rm(contextDir, { recursive: true, force: true }).catch(() => {}); }
  }

  async function run(turn: ChatTurn, emit: (m: ChatMessage) => void, fresh: boolean, mine: Running): Promise<{ ok: true } | { ok: false; message: string; resumed: boolean }> {
    const ctx = await writeContext(contextDir, { sessions: deps.store.all(), now: now(), capture, git: cwd => gitSummary(cwd) });
    if (mine.cancelled) return CANCELLED;
    const { sessionId, resume } = await daySession(fresh);
    // The chat runs on the CLI's own login: an API key the daemon inherited is never billed (spec §5.2).
    const env: NodeJS.ProcessEnv = { ...(await deps.env()), LEDGE_CHAT: '1' }; delete env.LEDGE_SESSION; delete env.LEDGE_NAME; delete env.ANTHROPIC_API_KEY;
    if (mine.cancelled) return CANCELLED;
    let answer = ''; let resultError: string | null = null;
    const handle = runClaude({ question: turn.question, cwd: ctx.dir, addDirs: ctx.repoPaths, sessionId, resume, env, bin: deps.bin }, e => {
      if (e.type === 'tool') { const step = e.path ? stepFor(e.path, ctx) : null; if (step && !turn.steps.some(s => sameStep(s, step))) { turn.steps.push(step); emit({ type: 'chat.step', qid: turn.qid, step }); } }
      else if (e.type === 'delta') { answer += e.text; emit({ type: 'chat.delta', qid: turn.qid, text: e.text }); }
      else if (e.type === 'result') { if (e.text) answer = e.text; if (e.isError) resultError = e.text || 'Claude Code reported an error'; }
    }, deps.spawn);
    mine.handle = handle;
    let timedOut = false;
    const timer = setTimeout(() => { log(`chat ${turn.qid}: timed out`); timedOut = true; handle.kill(); }, deps.timeoutMs ?? 180_000);
    const r = await handle.done; clearTimeout(timer);
    if (mine.cancelled) return CANCELLED;
    if (timedOut) return { ok: false, message: 'Claude Code did not answer within 3 minutes', resumed: false };
    if (r.code !== 0) return { ok: false, message: r.code === null ? `Claude Code could not start: ${r.stderr.trim() || 'not found in PATH'}` : r.stderr.trim() || `Claude Code exited with code ${r.code}`, resumed: resume };
    if (resultError) return { ok: false, message: resultError, resumed: false };
    turn.answer = answer; turn.answeredAt = now();
    emit({ type: 'chat.done', qid: turn.qid, text: answer, at: turn.answeredAt });
    return { ok: true };
  }

  return {
    history: () => turns,
    cancel(qid) { if (current?.qid === qid) { current.cancelled = true; current.handle?.kill(); } },
    async reset(emit) {
      // The overlay only offers it between questions; a reset racing a question is dropped rather than orphaning its turn.
      if (busy) { log('chat reset ignored: a question is running'); return; }
      freshNext = true; turns = []; turnsDay = today();
      emit({ type: 'chat.history', turns });
      // Without a day file a restarted daemon also starts fresh.
      await rm(dayFile, { force: true }).catch(e => log(`chat reset: day file not removed: ${(e as Error).message}`));
    },
    async ask(qid, text, emit) {
      if (busy) return emit({ type: 'chat.error', qid, message: ONE_AT_A_TIME });
      busy = true;
      const mine: Running = current = { qid, handle: null, cancelled: false };
      const turn: ChatTurn = { qid, question: text, askedAt: now(), steps: [] };
      try {
        rollDay();
        turns = [...turns, turn].slice(-HISTORY_MAX);
        // Every client learns the turn before it streams, including one connected before the question (its steps would map over nothing).
        emit({ type: 'chat.history', turns });
        let r = await attempt(turn, emit, false, mine);
        // A day session whose transcript is gone (or a CLI that forgot it): once more, from a fresh conversation.
        if (!r.ok && r.resumed && !mine.cancelled) { log(`chat ${qid}: resume failed (${r.message}), starting a new day session`); turn.steps.length = 0; r = await attempt(turn, emit, true, mine); }
        if (!r.ok) { turn.error = r.message; emit({ type: 'chat.error', qid, message: r.message }); }
      } catch (e) {
        // The context folder or the day file could not be written: the overlay still needs its unlock.
        log(`chat ${qid} failed: ${(e as Error).message}`);
        turn.error = (e as Error).message; emit({ type: 'chat.error', qid, message: turn.error });
      } finally { busy = false; current = null; }
    }
  };
}
