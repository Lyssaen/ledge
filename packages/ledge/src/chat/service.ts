import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { extractProposal, parseProjectBlock, parseProposalBlock, parseRelayBlock, type ChatProjectProposal, type ChatProposal, type ChatRelay, type ChatTurn, type Projects, type ServerMessage, type Session, type Tool } from '@ledge/protocol';
import { resolveFolder } from '../daemon/folders.js';
import type { Store } from '../daemon/store.js';
import type { Tmux } from '../tmux.js';
import { gitSummary } from '../daemon/git.js';
import { writeContext, stepFor } from './context.js';
import { runClaude, type ClaudeEvent, type RunHandle, type RunOptions } from './claude.js';
import { runCodex } from './codex.js';
import { runCursor } from './cursor.js';
import { log } from '../log.js';

export type ChatMessage = Extract<ServerMessage, { type: 'chat.history' | 'chat.step' | 'chat.delta' | 'chat.done' | 'chat.error' }>;
export interface Chat {
  ask(qid: string, text: string, emit: (m: ChatMessage) => void, tool?: Tool): Promise<void>; cancel(qid: string): void; reset(emit: (m: ChatMessage) => void): Promise<void>; history(): ChatTurn[];
  /** The turn's session proposal (spec 2026-10-12 §4), if the turn is still in the day's history. */
  proposal(qid: string): ChatProposal | undefined;
  /** The card's launch went through (`launchedId`) or failed (`error`); every client gets the new history. */
  markLaunched(qid: string, id: string, emit: (m: ChatMessage) => void): void; markFailed(qid: string, message: string, emit: (m: ChatMessage) => void): void;
  /** The turn's relay (spec 2026-10-12 relay §4), if the turn is still in the day's history. */
  relay(qid: string): ChatRelay | undefined;
  /** The card's state: queued, sent, failed, or `{}` back to proposed; every client gets the new history. */
  markRelay(qid: string, patch: Pick<ChatRelay, 'status' | 'sentAt' | 'error'>, emit: (m: ChatMessage) => void): void;
  /** Today's queued relays, oldest turn first. */
  queuedRelays(emit?: (m: ChatMessage) => void): Array<{ qid: string; relay: ChatRelay }>;
}
export interface ChatDeps {
  store: Store; tmux: Pick<Tmux, 'capture'>; home: string;
  /** Where a proposal's `~` resolves (the user's home, as for session.launch). */
  userHome?: string;
  /** The environment the chat process runs in (the login shell's PATH, like a launched agent). */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** The projects and folder rules as the daemon holds them now (read at each question); a daemon with none omits it. */
  projects?: () => Projects;
  now?: () => string; today?: () => string; uuid?: () => string; bin?: string[]; bins?: Partial<Record<Tool, string[]>>; spawn?: typeof nodeSpawn; timeoutMs?: number;
}

const TOOL_LABEL: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };
const runTool = (tool: Tool, o: RunOptions, onEvent: (e: ClaudeEvent) => void, spawn?: typeof nodeSpawn) =>
  tool === 'codex' ? runCodex(o, onEvent, spawn) : tool === 'cursor' ? runCursor(o, onEvent, spawn) : runClaude(o, onEvent, spawn);

export const ONE_AT_A_TIME = 'one question at a time: wait for the answer';
/** How many of the day's turns are kept for a client that connects later. */
const HISTORY_MAX = 50;
/** The lines of a terminal Ledge gets to read. */
const PANE_LINES = 40;

/** A home folder (`/root`, `/home/<user>`, `/Users/<user>`): never a project's repository (the fleet's proposals.ts rule). */
const HOME = /^\/(?:root|home\/[^/]+|Users\/[^/]+)$/;
const sameStep = (a: ChatTurn['steps'][number], b: ChatTurn['steps'][number]) => a.kind === b.kind && a.id === b.id && a.path === b.path;

/** One conversation with Ledge per day, run by the chosen harness (spec 2026-10-11 §5). */
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
  function rollDay(): boolean { const day = today(); if (turnsDay === day) return false; turns = []; turnsDay = day; return true; }

  /** Today's session for this harness: resumed from the day file when it names today and the same tool, else a fresh id. */
  async function daySession(fresh: boolean, tool: Tool): Promise<{ sessionId: string; resume: boolean }> {
    const day = today();
    if (!fresh && !freshNext) {
      try {
        const saved = JSON.parse(await readFile(dayFile, 'utf8')) as { day?: string; sessionId?: string; tool?: string };
        if (saved.day === day && saved.sessionId && (saved.tool ?? 'claude') === tool) return { sessionId: saved.sessionId, resume: true };
      } catch { /* none yet */ }
    }
    const sessionId = uuid();
    await mkdir(dirname(dayFile), { recursive: true }); await writeFile(dayFile, JSON.stringify({ day, sessionId, tool })); freshNext = false;
    return { sessionId, resume: false };
  }

  const capture = async (s: Session) => { if (!s.tmuxSession) return null; const p = await deps.tmux.capture(s.tmuxSession, PANE_LINES); return p === null ? null : p.split('\n'); };

  const contextDir = join(deps.home, 'chat', 'context');

  /** A block as a card: its folder must exist now; a bad block or a missing folder gives no card and a log line. */
  async function proposalFrom(raw: string, tool: Tool, qid: string): Promise<ChatProposal | undefined> {
    const block = parseProposalBlock(raw);
    if (!block) { log(`chat ${qid}: proposal ignored, invalid block: ${raw.slice(0, 200)}`); return undefined; }
    try {
      const cwd = await resolveFolder(block.cwd, deps.userHome);
      const prompt = block.prompt?.trim();
      // launchArgs passes the prompt as a bare argv entry: a leading `-` would be read as a flag by the agent CLI.
      if (prompt?.startsWith('-')) { log(`chat ${qid}: proposal ignored: prompt starts with "-"`); return undefined; }
      return { cwd, project: basename(cwd), tool, ...(prompt ? { prompt } : {}) };
    } catch (e) { log(`chat ${qid}: proposal ignored: ${(e as Error).message}`); return undefined; }
  }
  /** A relay block as a card: its session must be tracked, writable and still running now; otherwise no card and a log line. */
  function relayFrom(raw: string, qid: string): ChatRelay | undefined {
    const block = parseRelayBlock(raw);
    if (!block) { log(`chat ${qid}: relay ignored, invalid block: ${raw.slice(0, 200)}`); return undefined; }
    // A leading `!` would put Claude Code in bash mode, and the chat model can be steered by pane or repo content.
    if (block.text.trimStart().startsWith('!')) { log(`chat ${qid}: relay ignored: bash-mode instruction ${block.session}`); return undefined; }
    const s = deps.store.get(block.session);
    const why = !s ? 'unknown session' : s.source === 'hook_only' ? 'read-only session' : s.state === 'exited' ? 'session has exited' : null;
    if (why) { log(`chat ${qid}: relay ignored: ${why} ${block.session}`); return undefined; }
    return { id: s!.id, name: s!.name, tool: s!.tool, text: block.text };
  }
  /** A project block as a card (lot 11, task 5): only the paths that are folders on this machine now stay (resolved, `~` included,
   *  once each), never `/` nor a home (it would swallow every repository, as the Settings proposer knows); the others are dropped with
   *  a log line, and with none left there is no card. Nothing is created here. */
  async function projectFrom(raw: string, qid: string): Promise<ChatProjectProposal | undefined> {
    const block = parseProjectBlock(raw);
    if (!block) { log(`chat ${qid}: project ignored, invalid block: ${raw.slice(0, 200)}`); return undefined; }
    const repos: ChatProjectProposal['repos'] = [];
    for (const r of block.repos) {
      try {
        const path = await resolveFolder(r.path, deps.userHome);
        if (path === '/' || HOME.test(path) || path === resolve(deps.userHome ?? homedir())) { log(`chat ${qid}: project path dropped: a root or home folder: ${path}`); continue; }
        if (!repos.some(x => x.path === path)) repos.push({ path, why: r.why });
      } catch (e) { log(`chat ${qid}: project path dropped: ${(e as Error).message}`); }
    }
    if (repos.length === 0) { log(`chat ${qid}: project ignored: no path exists on this machine`); return undefined; }
    const description = block.description?.trim();
    return { name: block.name, ...(description ? { description } : {}), repos, ...(block.addTo ? { addTo: block.addTo } : {}) };
  }
  const turnOf = (qid: string) => turns.find(t => t.qid === qid);

  /** One run; the context folder (terminal tails, last replies) is removed once it ends, whatever the outcome. */
  async function attempt(turn: ChatTurn, emit: (m: ChatMessage) => void, fresh: boolean, mine: Running, tool: Tool): Promise<{ ok: true } | { ok: false; message: string; resumed: boolean }> {
    try { return await run(turn, emit, fresh, mine, tool); } finally { mine.handle = null; await rm(contextDir, { recursive: true, force: true }).catch(() => {}); }
  }

  async function run(turn: ChatTurn, emit: (m: ChatMessage) => void, fresh: boolean, mine: Running, tool: Tool): Promise<{ ok: true } | { ok: false; message: string; resumed: boolean }> {
    const ctx = await writeContext(contextDir, { sessions: deps.store.all(), recents: deps.store.recents(), projects: deps.projects?.(), now: now(), capture, git: cwd => gitSummary(cwd) });
    if (mine.cancelled) return CANCELLED;
    const { sessionId, resume } = await daySession(fresh, tool);
    const label = TOOL_LABEL[tool];
    // The chat runs on the CLI's own login: an API key the daemon inherited is never billed (spec §5.2).
    const env: NodeJS.ProcessEnv = { ...(await deps.env()), LEDGE_CHAT: '1' }; delete env.LEDGE_SESSION; delete env.LEDGE_NAME; delete env.ANTHROPIC_API_KEY;
    if (mine.cancelled) return CANCELLED;
    let answer = ''; let resultError: string | null = null;
    const handle = runTool(tool, { question: turn.question, cwd: ctx.dir, addDirs: ctx.repoPaths, sessionId, resume, env, bin: deps.bins?.[tool] ?? deps.bin }, e => {
      if (e.type === 'tool') { const step = e.path ? stepFor(e.path, ctx) : null; if (step && !turn.steps.some(s => sameStep(s, step))) { turn.steps.push(step); emit({ type: 'chat.step', qid: turn.qid, step }); } }
      else if (e.type === 'delta') { answer += e.text; emit({ type: 'chat.delta', qid: turn.qid, text: e.text }); }
      else if (e.type === 'result') { if (e.text) answer = e.text; if (e.isError) resultError = e.text || `${label} reported an error`; }
    }, deps.spawn);
    mine.handle = handle;
    let timedOut = false;
    const timer = setTimeout(() => { log(`chat ${turn.qid}: timed out`); timedOut = true; handle.kill(); }, deps.timeoutMs ?? 180_000);
    const r = await handle.done; clearTimeout(timer);
    if (mine.cancelled) return CANCELLED;
    if (timedOut) return { ok: false, message: `${label} did not answer within 3 minutes`, resumed: false };
    if (r.code !== 0) return { ok: false, message: r.code === null ? `${label} could not start: ${r.stderr.trim() || 'not found in PATH'}` : r.stderr.trim() || `${label} exited with code ${r.code}`, resumed: resume };
    if (resultError) return { ok: false, message: resultError, resumed: false };
    // The proposal block never reaches the reader: the card stands for it (spec 2026-10-12 §3-4).
    const { text, kind, raw } = extractProposal(answer);
    const proposal = kind === 'session' ? await proposalFrom(raw!, tool, turn.qid) : undefined;
    const relay = kind === 'relay' ? relayFrom(raw!, turn.qid) : undefined;
    const projectProposal = kind === 'project' ? await projectFrom(raw!, turn.qid) : undefined;
    turn.answer = text; turn.answeredAt = now();
    if (proposal) turn.proposal = proposal;
    if (relay) turn.relay = relay;
    if (projectProposal) turn.projectProposal = projectProposal;
    emit({ type: 'chat.done', qid: turn.qid, text, at: turn.answeredAt, ...(proposal ? { proposal } : {}), ...(relay ? { relay } : {}), ...(projectProposal ? { projectProposal } : {}) });
    return { ok: true };
  }

  return {
    history: () => turns,
    proposal: qid => turnOf(qid)?.proposal,
    markLaunched(qid, id, emit) {
      const t = turnOf(qid); if (!t?.proposal) return;
      const next = { ...t.proposal, launchedId: id }; delete next.error; t.proposal = next;
      emit({ type: 'chat.history', turns });
    },
    markFailed(qid, message, emit) {
      const t = turnOf(qid); if (!t?.proposal) return;
      t.proposal = { ...t.proposal, error: message };
      emit({ type: 'chat.history', turns });
    },
    relay: qid => { rollDay(); return turnOf(qid)?.relay; },
    markRelay(qid, patch, emit) {
      const t = turnOf(qid); if (!t?.relay) return;
      const { id, name, tool, text } = t.relay; t.relay = { id, name, tool, text, ...patch };
      emit({ type: 'chat.history', turns });
    },
    // A roll caught here is silent otherwise: the overlays would keep showing yesterday's queued card.
    queuedRelays(emit) { if (rollDay()) emit?.({ type: 'chat.history', turns }); return turns.flatMap(t => (t.relay?.status === 'queued' ? [{ qid: t.qid, relay: t.relay }] : [])); },
    cancel(qid) { if (current?.qid === qid) { current.cancelled = true; current.handle?.kill(); } },
    async reset(emit) {
      // The overlay only offers it between questions; a reset racing a question is dropped rather than orphaning its turn.
      if (busy) { log('chat reset ignored: a question is running'); return; }
      freshNext = true; turns = []; turnsDay = today();
      emit({ type: 'chat.history', turns });
      // Without a day file a restarted daemon also starts fresh.
      await rm(dayFile, { force: true }).catch(e => log(`chat reset: day file not removed: ${(e as Error).message}`));
    },
    async ask(qid, text, emit, tool = 'claude') {
      if (busy) return emit({ type: 'chat.error', qid, message: ONE_AT_A_TIME });
      busy = true;
      const mine: Running = current = { qid, handle: null, cancelled: false };
      const turn: ChatTurn = { qid, question: text, askedAt: now(), steps: [] };
      try {
        rollDay();
        turns = [...turns, turn].slice(-HISTORY_MAX);
        // Every client learns the turn before it streams, including one connected before the question (its steps would map over nothing).
        emit({ type: 'chat.history', turns });
        let r = await attempt(turn, emit, false, mine, tool);
        // A day session whose transcript is gone (or a CLI that forgot it): once more, from a fresh conversation.
        if (!r.ok && r.resumed && !mine.cancelled) { log(`chat ${qid}: resume failed (${r.message}), starting a new day session`); turn.steps.length = 0; r = await attempt(turn, emit, true, mine, tool); }
        if (!r.ok) { turn.error = r.message; emit({ type: 'chat.error', qid, message: r.message }); }
      } catch (e) {
        // The context folder or the day file could not be written: the overlay still needs its unlock.
        log(`chat ${qid} failed: ${(e as Error).message}`);
        turn.error = (e as Error).message; emit({ type: 'chat.error', qid, message: turn.error });
      } finally { busy = false; current = null; }
    }
  };
}
