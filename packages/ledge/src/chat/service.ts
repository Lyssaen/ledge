import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { extractProposal, isArchived, LEGACY_FENCE_ACTION, MAX_PROPOSALS, proposalRows, parseActionBlock, parseProjectBlock, parseCloseBlock, parseRelayBlock, parseTaskBlock, parseTeamBlock, projectOf, type BlockKind, type ChatAction, type ChatClose, type ChatProjectProposal, type ChatProposal, type ChatRelay, type ChatTaskProposal, type ChatTeamProposal, type CloseHow, type ChatTurn, type AttachmentRef, type Projects, type ServerMessage, type Session, type Task, type Team, type Tool } from '@ledge/protocol';
import { listDefinitions, resolveSeats, templateExists } from '../daemon/teams.js';
import { resolveAction } from '../daemon/actions.js';
import { findRole } from '../daemon/roles.js';
import { resolveFolder } from '../daemon/folders.js';
import type { Store } from '../daemon/store.js';
import type { Tmux } from '../tmux.js';
import { gitSummary } from '../daemon/git.js';
import { writeContext, stepFor } from './context.js';
import { asksForge, type Forge } from './forge.js';
import { runClaude, type ClaudeEvent, type RunHandle, type RunOptions } from './claude.js';
import { runCodex } from './codex.js';
import { runCursor } from './cursor.js';
import { runOmp } from './omp.js';
import { log } from '../log.js';

export type ChatMessage = Extract<ServerMessage, { type: 'chat.history' | 'chat.step' | 'chat.delta' | 'chat.done' | 'chat.error' }>;
export interface Chat {
  ask(qid: string, text: string, emit: (m: ChatMessage) => void, tool?: Tool, images?: AttachmentRef[]): Promise<void>;
  /** The ids of the images the day's turns hold. */
  attachmentIds(): string[];
  cancel(qid: string): void; reset(emit: (m: ChatMessage) => void): Promise<void>; history(): ChatTurn[];
  /** The turn's session proposal (spec 2026-10-12 §4) at that row of its card (#24, the first by default), if the turn is still in the day's history. */
  proposal(qid: string, row?: number): ChatProposal | undefined;
  /** The card row's launch went through (`launchedId`) or failed (`error`); every client gets the new history. */
  markLaunched(qid: string, id: string, emit: (m: ChatMessage) => void, row?: number): void; markFailed(qid: string, message: string, emit: (m: ChatMessage) => void, row?: number): void;
  /** The turn's relay (spec 2026-10-12 relay §4), if the turn is still in the day's history. */
  relay(qid: string): ChatRelay | undefined;
  /** The card's state: queued, sent, failed, or `{}` back to proposed; every client gets the new history. */
  markRelay(qid: string, patch: Pick<ChatRelay, 'status' | 'sentAt' | 'error'>, emit: (m: ChatMessage) => void): void;
  /** Today's queued relays, oldest turn first. */
  queuedRelays(emit?: (m: ChatMessage) => void): Array<{ qid: string; relay: ChatRelay; askedAt: string }>;
  /** The turn's close card row (spec 2026-10-21 close §4), if the turn is still in the day's history. */
  close(qid: string, row: number): ChatClose | undefined;
  /** The row's session was closed (`how`); every client gets the new history. */
  markClosed(qid: string, row: number, how: CloseHow, emit: (m: ChatMessage) => void): void;
  /** The row's close failed (`error`); every client gets the new history. */
  markCloseFailed(qid: string, row: number, message: string, emit: (m: ChatMessage) => void): void;
  /** The turn's team card (roles spec §3.8), if the turn is still in the day's history. */
  team(qid: string): ChatTeamProposal | undefined;
  /** The team card's outcome: launched (`teamId`, `launchedAt`), failed (`error`), saved (`savedPath`); every client gets the new history. */
  markTeam(qid: string, patch: Partial<Pick<ChatTeamProposal, 'teamId' | 'launchedAt' | 'error' | 'savedPath'>>, emit: (m: ChatMessage) => void): void;
  /** The turn's task card row. */
  task(qid: string, row: number): ChatTaskProposal | undefined;
  /** The row's task was given (its id and state) or the give failed (`error`). */
  markTask(qid: string, row: number, patch: Partial<Pick<ChatTaskProposal, 'taskId' | 'ownerName' | 'state' | 'givenAt' | 'error'>>, emit: (m: ChatMessage) => void): void;
  /** A task Ledge gave changed: the card that gave it follows it (« prise », then « finie »). */
  followTask(task: Task, emit: (m: ChatMessage) => void): void;
  /** The turn's generic card row (spec 2026-10-26 action registry §5). */
  action(qid: string, row: number): ChatAction | undefined;
  /** The row is running, done (`doneAt`) or failed (`error`); every client gets the new history. */
  markAction(qid: string, row: number, patch: Partial<Pick<ChatAction, 'state' | 'doneAt' | 'error' | 'code'>>, emit: (m: ChatMessage) => void): void;
  /** « Ignorer » the turn's cards (`undo`: « Revoir », open again): why not, or null once every client has the turn's
   *  `ignoredAt`. Ledge hears of a card set aside at the next question, unless it was opened again meanwhile. */
  ignore(qid: string, undo: boolean, emit: (m: ChatMessage) => void): string | null;
  /** The turn's cards were set aside: none of them applies. */
  ignored(qid: string): boolean;
  /** Resolves once no question is running (at once when there is none). */
  idle(): Promise<void>;
}
export interface ChatDeps {
  store: Store; tmux: Pick<Tmux, 'capture'>; home: string;
  /** Where a proposal's `~` resolves (the user's home, as for session.launch). */
  userHome?: string;
  /** The environment the chat process runs in (the login shell's PATH, like a launched agent). */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** The projects and folder rules as the daemon holds them now (read at each question); a daemon with none omits it. */
  projects?: () => Projects;
  /** The live teams and the tasks (roles spec §3.8): the context's teams.md and tasks.md. */
  teams?: () => Team[];
  tasks?: () => Task[];
  /** Reads the projects' GitHub/GitLab (#23) into the context, for a question that asks about issues, PR/MR or CI. */
  forge?: Forge;
  /** A pool shared by several chats: a question takes a place while it runs. */
  slots?: { take(): boolean; give(): void };
  /** Resolves an attached image's id to its file (the daemon's attachment store). */
  attachments?: { path(id: string): string | null };
  now?: () => string; today?: () => string; uuid?: () => string; bin?: string[]; bins?: Partial<Record<Tool, string[]>>; spawn?: typeof nodeSpawn; timeoutMs?: number;
}

const TOOL_LABEL: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', omp: 'OMP' };
const runTool = (tool: Tool, o: RunOptions, onEvent: (e: ClaudeEvent) => void, spawn?: typeof nodeSpawn) =>
  tool === 'omp' ? runOmp(o, onEvent, spawn) : tool === 'codex' ? runCodex(o, onEvent, spawn) : tool === 'cursor' ? runCursor(o, onEvent, spawn) : runClaude(o, onEvent, spawn);

export const ONE_AT_A_TIME = 'one question at a time: wait for the answer';
export const TOO_MANY = 'too many questions at once: try again in a moment';
/** How many of the day's turns are kept for a client that connects later. */
const HISTORY_MAX = 50;
/** The lines of a terminal Ledge gets to read. */
const PANE_LINES = 40;

/** A home folder (`/root`, `/home/<user>`, `/Users/<user>`): never a project's repository (the fleet's proposals.ts rule). */
const HOME = /^\/(?:root|home\/[^/]+|Users\/[^/]+|mnt\/[^/]+\/Users\/[^/]+)$/;
/** Where homes live: `/home`, `/Users`, a WSL drive (`/mnt/c`) and its `Users`. */
const HOMES = /^\/(?:home|Users|mnt\/[^/]+(?:\/Users)?)$/;

/** Why a project path from the chat is too wide to propose (it would swallow every repository below it), or null: the root, a home
 *  (anyone's, WSL's Windows ones included, or the user's), a folder of homes, a folder that holds the user's home, a top-level folder
 *  (`/x`). `path` and `userHome` are resolved. */
export function tooWide(path: string, userHome: string): string | null {
  if (path === '/') return 'the root';
  if (HOME.test(path) || path === userHome) return 'a home folder';
  if (HOMES.test(path)) return 'a folder of homes';
  if (userHome.startsWith(`${path}/`)) return 'a folder holding the home';
  if (/^\/[^/]+$/.test(path)) return 'a top-level folder';
  return null;
}
/** The earlier fence each earlier card's action is read as, so a ledge-action block for it reaches the same validator. */
const FENCE_OF = new Map(Object.entries(LEGACY_FENCE_ACTION).map(([kind, id]) => [id as string, kind as BlockKind]));
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
  type Running = { qid: string; handle: RunHandle | null; cancelled: boolean; told: { text: string; qids: string[] } };
  let current: Running | null = null;
  let idleWaiters: Array<() => void> = [];
  const CANCELLED = { ok: false as const, message: 'cancelled', resumed: false };
  /** The turns set aside since Ledge last heard: it is told before the next question, so it does not propose them again. */
  const setAside = new Map<string, { question: string; partly: boolean }>();
  const tell = () => ({ qids: [...setAside.keys()], text: [...setAside.values()].map(a => `[Ledge] L'utilisateur a ignoré ta proposition en réponse à « ${a.question} » : `
    + `${a.partly ? 'une partie était déjà faite, le reste n\'en a pas été appliqué' : 'rien n\'en a été appliqué'}. Ne la propose plus, sauf s'il la redemande.`).join('\n') });
  /** Something of the turn's cards was already applied, or is under way: Ledge is not told that nothing was. */
  const partly = (t: ChatTurn) => !!(proposalRows(t).some(p => p.launchedId) || t.relay?.status === 'sent' || t.relay?.sentAt || t.closes?.some(c => c.closedAt)
    || t.team?.teamId || t.tasks?.some(c => c.taskId) || t.actions?.some(a => a.state === 'done'));

  /** A new day starts an empty history; the day file decides the Claude session separately. */
  function rollDay(): boolean { const day = today(); if (turnsDay === day) return false; turns = []; turnsDay = day; setAside.clear(); return true; }

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
    const parsed = parseActionBlock('session', raw);
    if ('error' in parsed) { log(`chat ${qid}: proposal ignored, invalid block: ${raw.slice(0, 200)}`); return undefined; }
    const block = parsed.args as { cwd: string; prompt?: string; model?: string; effort?: ChatProposal['effort'] };
    try {
      const cwd = await resolveFolder(block.cwd, deps.userHome);
      const prompt = block.prompt?.trim();
      // launchArgs passes the prompt as a bare argv entry: a leading `-` would be read as a flag by the agent CLI.
      if (prompt?.startsWith('-')) { log(`chat ${qid}: proposal ignored: prompt starts with "-"`); return undefined; }
      return { cwd, project: basename(cwd), tool, ...(prompt ? { prompt } : {}), ...(block.model ? { model: block.model } : {}), ...(block.effort ? { effort: block.effort } : {}) };
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
  /** The close blocks as rows: each session must be tracked, writable, still running now and not already a row; the others are dropped with a log line. */
  function closesFrom(blocks: Array<{ raw: string }>, qid: string): ChatClose[] {
    const rows: ChatClose[] = [];
    for (const { raw } of blocks) {
      const block = parseCloseBlock(raw);
      if (!block) { log(`chat ${qid}: close ignored, invalid block: ${raw.slice(0, 200)}`); continue; }
      const s = deps.store.get(block.session);
      const why = !s ? 'unknown session' : s.source === 'hook_only' ? 'read-only session' : s.state === 'exited' ? 'session has exited' : rows.some(r => r.id === s.id) ? 'duplicate session' : null;
      if (why) { log(`chat ${qid}: close ignored: ${why} ${block.session}`); continue; }
      rows.push({ id: s!.id, name: s!.name, tool: s!.tool });
    }
    return rows;
  }
  /** A project block as a card (lot 11, task 5): only the paths that are folders on this machine now stay (resolved, `~` included,
   *  once each), never one `tooWide` names (it would swallow every repository, as the Settings proposer knows); the others are dropped with
   *  a log line, and with none left there is no card. Nothing is created here. */
  async function projectFrom(raw: string, qid: string): Promise<ChatProjectProposal | undefined> {
    const block = parseProjectBlock(raw);
    if (!block) { log(`chat ${qid}: project ignored, invalid block: ${raw.slice(0, 200)}`); return undefined; }
    const repos: ChatProjectProposal['repos'] = [];
    for (const r of block.repos) {
      try {
        const path = await resolveFolder(r.path, deps.userHome);
        const wide = tooWide(path, resolve(deps.userHome ?? homedir()));
        if (wide) { log(`chat ${qid}: project path dropped: ${wide}: ${path}`); continue; }
        if (!repos.some(x => x.path === path)) repos.push({ path, why: r.why });
      } catch (e) { log(`chat ${qid}: project path dropped: ${(e as Error).message}`); }
    }
    if (repos.length === 0) { log(`chat ${qid}: project ignored: no path exists on this machine`); return undefined; }
    const description = block.description?.trim();
    return { name: block.name, ...(description ? { description } : {}), repos, ...(block.addTo ? { addTo: block.addTo } : {}) };
  }
  /** A team block as a card: its folder must exist and every role be known there; the seats are resolved as `team.launch`
   *  would launch them, so the card shows each one's agent, model, effort and autonomy. Otherwise no card and a log line. */
  async function teamFrom(raw: string, tool: Tool, qid: string): Promise<ChatTeamProposal | undefined> {
    const block = parseTeamBlock(raw);
    if (!block) { log(`chat ${qid}: team ignored, invalid block: ${raw.slice(0, 200)}`); return undefined; }
    let cwd: string;
    try { cwd = await resolveFolder(block.cwd, deps.userHome); } catch (e) { log(`chat ${qid}: team ignored: ${(e as Error).message}`); return undefined; }
    const wide = tooWide(cwd, resolve(deps.userHome ?? homedir()));
    if (wide) { log(`chat ${qid}: team ignored: the folder is ${wide}`); return undefined; }
    const defs = listDefinitions(cwd);
    const template = block.template ? defs.templates.find(t => t.id === block.template) : undefined;
    if (block.template && !template) { log(`chat ${qid}: team ignored: unknown template ${block.template}`); return undefined; }
    const seats = template?.seats ?? block.seats!;
    const resolved = resolveSeats(seats as Parameters<typeof resolveSeats>[0], defs.roles, { tool });
    if ('unknown' in resolved) { log(`chat ${qid}: team ignored: unknown roles ${resolved.unknown.join(', ')}`); return undefined; }
    const projects = deps.projects?.();
    const project = projects ? projectOf({ cwd }, projects) : null;
    const projectName = project ? projects!.projects.find(p => p.id === project)?.name : undefined;
    return { cwd, project: project ?? basename(cwd), ...(projectName ? { projectName } : {}), name: block.name ?? template?.name ?? basename(cwd), ...(template ? { template: template.id } : {}),
      seats: resolved.map(r => ({ role: r.role.id, label: r.role.label, tool: r.tool, ...(r.model ? { model: r.model } : {}), ...(r.effort ? { effort: r.effort } : {}), ...(r.role.autonomy ? { autonomy: r.role.autonomy } : {}), ...(r.name ? { name: r.name } : {}) })) };
  }
  /** The task blocks as rows: a session id must be a live session Ledge launched; `@role` is kept as written (resolved at the click). */
  function tasksFrom(blocks: Array<{ raw: string }>, qid: string, team: ChatTeamProposal | undefined): ChatTaskProposal[] {
    const rows: ChatTaskProposal[] = [];
    for (const { raw } of blocks) {
      const block = parseTaskBlock(raw);
      if (!block) { log(`chat ${qid}: task ignored, invalid block: ${raw.slice(0, 200)}`); continue; }
      if (block.to.startsWith('@')) {
        // `@role` names a seat of the team proposed with it, or of a live team the block names.
        const live = block.team ? deps.teams?.().find(t => t.id === block.team && t.state !== 'dissolved') : undefined;
        if (!team && !live) { log(`chat ${qid}: task ignored: ${block.to} without a team`); continue; }
        if (team && !block.team && !team.seats.some(x => `@${x.role}` === block.to)) { log(`chat ${qid}: task ignored: ${block.to} is not a seat of ${team.name}`); continue; }
        rows.push({ to: block.to, ...(live ? { team: live.id } : {}), title: block.title, ...(block.text?.trim() ? { text: block.text.trim() } : {}) });
        continue;
      }
      const s = deps.store.get(block.to) ?? deps.store.all().find(x => x.name === block.to && x.state !== 'exited');
      const why = !s ? 'unknown session' : s.source === 'hook_only' ? 'read-only session' : s.state === 'exited' ? 'session has exited' : null;
      if (why) { log(`chat ${qid}: task ignored: ${why} ${block.to}`); continue; }
      rows.push({ to: s!.id, toName: s!.name, ...(s!.team ? { team: s!.team } : {}), title: block.title, ...(block.text?.trim() ? { text: block.text.trim() } : {}) });
    }
    return rows;
  }
  /** The generic blocks as rows (spec §9.2, one plan): each resolved against the state now, at most `max` per action and 8 in all; a refused,
   *  repeated or capped one is dropped with a log line. */
  function actionsFrom(blocks: Array<{ id: string; args: unknown; max: number }>, qid: string, closing: ReadonlySet<string>): ChatAction[] {
    const ctx = { sessions: deps.store.all(), teams: deps.teams?.() ?? [], tasks: deps.tasks?.() ?? [], findRole, templateExists: (name: string) => templateExists(name), closing };
    const rows: ChatAction[] = []; const per = new Map<string, number>(); const over = new Map<string, number>(); let beyond = 0;
    for (const b of blocks) {
      if ((per.get(b.id) ?? 0) >= b.max) { over.set(b.id, (over.get(b.id) ?? 0) + 1); continue; }
      if (rows.length >= MAX_PROPOSALS) { beyond++; continue; }
      const r = resolveAction(b.id, b.args, ctx);
      if ('refused' in r) { log(`chat ${qid}: action ignored: ${r.refused}`); continue; }
      if (rows.some(x => x.action === r.action && JSON.stringify(x.args) === JSON.stringify(r.args))) { log(`chat ${qid}: action ignored: duplicate ${r.action}`); continue; }
      per.set(b.id, (per.get(b.id) ?? 0) + 1); rows.push(r);
    }
    for (const [id, n] of over) log(`chat ${qid}: ${n} ${id} beyond ${actionMax(blocks, id)} ignored`);
    if (beyond > 0) log(`chat ${qid}: ${beyond} actions beyond ${MAX_PROPOSALS} ignored`);
    return rows;
  }
  const actionMax = (blocks: Array<{ id: string; max: number }>, id: string) => blocks.find(b => b.id === id)!.max;
  const turnOf = (qid: string) => turns.find(t => t.qid === qid);
  /** Sets a row and keeps `proposal` the first row, for the clients from before #24. */
  function setRow(t: ChatTurn, row: number, next: ChatProposal) {
    const rows = [...proposalRows(t)]; rows[row] = next; t.proposals = rows; t.proposal = rows[0];
  }

  /** One run; the context folder (terminal tails, last replies) is removed once it ends, whatever the outcome. */
  async function attempt(turn: ChatTurn, emit: (m: ChatMessage) => void, fresh: boolean, mine: Running, tool: Tool): Promise<{ ok: true } | { ok: false; message: string; resumed: boolean }> {
    try { return await run(turn, emit, fresh, mine, tool); } finally { mine.handle = null; await rm(contextDir, { recursive: true, force: true }).catch(() => {}); }
  }

  async function run(turn: ChatTurn, emit: (m: ChatMessage) => void, fresh: boolean, mine: Running, tool: Tool): Promise<{ ok: true } | { ok: false; message: string; resumed: boolean }> {
    const ctx = await writeContext(contextDir, { sessions: deps.store.all().filter(s => !isArchived(s)), recents: deps.store.recents(), projects: deps.projects?.(), teams: deps.teams?.(), tasks: deps.tasks?.(), now: now(), capture, git: cwd => gitSummary(cwd) });
    // Only a question about the forge runs gh/glab: the others never wait on the network.
    if (deps.forge && asksForge(turn.question)) await deps.forge.write(ctx, deps.projects?.() ?? { projects: [], rules: [] }).catch(e => log(`chat ${turn.qid}: forge files not written (${e instanceof Error ? e.message : String(e)})`));
    if (mine.cancelled) return CANCELLED;
    const { sessionId, resume } = await daySession(fresh, tool);
    const label = TOOL_LABEL[tool];
    const images = (turn.attachments ?? []).flatMap(a => { const path = deps.attachments?.path(a.id); return path ? [{ path, mime: a.mime }] : []; });
    // The chat runs on the CLI's own login: an API key the daemon inherited is never billed (spec §5.2).
    const env: NodeJS.ProcessEnv = { ...(await deps.env()), LEDGE_CHAT: '1' }; delete env.LEDGE_SESSION; delete env.LEDGE_NAME; delete env.ANTHROPIC_API_KEY;
    if (mine.cancelled) return CANCELLED;
    let answer = ''; let resultError: string | null = null;
    const handle = runTool(tool, { question: mine.told.text ? `${mine.told.text}\n\n${turn.question}` : turn.question, cwd: ctx.dir, addDirs: ctx.repoPaths, sessionId, resume, env, bin: deps.bins?.[tool] ?? deps.bin, ...(images.length > 0 ? { images } : {}), ...(tool === 'omp' ? { sessionDir: join(deps.home, 'chat', 'omp', sessionId) } : {}) }, e => {
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
    const { text, blocks: found } = extractProposal(answer);
    // A ledge-action block for an earlier card is read as that card's fence; the generic ones never decide which earlier card the turn gets.
    const blocks: Array<{ kind: BlockKind; raw: string }> = []; const generic: Array<{ id: string; args: unknown; max: number }> = [];
    for (const b of found) {
      if (b.kind !== 'action') { blocks.push(b); continue; }
      const r = parseActionBlock('action', b.raw);
      if ('error' in r) { log(`chat ${turn.qid}: action ignored: ${r.error}`); continue; }
      if (r.action.card === 'generic') generic.push({ id: r.action.id, args: r.args, max: r.action.max });
      else blocks.push({ kind: FENCE_OF.get(r.action.id)!, raw: JSON.stringify(r.args) });
    }
    const kind = blocks.at(-1)?.kind ?? null; const raw = blocks.at(-1)?.raw ?? null;
    // Every session block is a row of the card (#24); the last block's kind still decides which card the turn gets.
    const sessionBlocks = kind === 'session' ? blocks.filter(b => b.kind === 'session') : [];
    if (sessionBlocks.length > MAX_PROPOSALS) log(`chat ${turn.qid}: ${sessionBlocks.length - MAX_PROPOSALS} sessions beyond ${MAX_PROPOSALS} ignored`);
    const proposals: ChatProposal[] = [];
    for (const b of sessionBlocks.slice(0, MAX_PROPOSALS)) { const p = await proposalFrom(b.raw, tool, turn.qid); if (p) proposals.push(p); }
    const proposal = proposals[0];
    const relay = kind === 'relay' ? relayFrom(raw!, turn.qid) : undefined;
    const closeBlocks = kind === 'close' ? blocks.filter(b => b.kind === 'close') : [];
    if (closeBlocks.length > MAX_PROPOSALS) log(`chat ${turn.qid}: ${closeBlocks.length - MAX_PROPOSALS} sessions beyond ${MAX_PROPOSALS} ignored`);
    const closes = closesFrom(closeBlocks.slice(0, MAX_PROPOSALS), turn.qid);
    const projectProposal = kind === 'project' ? await projectFrom(raw!, turn.qid) : undefined;
    // A team card and its first tasks may come in one answer (§3.8): both are read whatever the last block is.
    const teamBlock = blocks.filter(b => b.kind === 'team').at(-1);
    const team = teamBlock ? await teamFrom(teamBlock.raw, tool, turn.qid) : undefined;
    const taskBlocks = blocks.filter(b => b.kind === 'task');
    if (taskBlocks.length > MAX_PROPOSALS) log(`chat ${turn.qid}: ${taskBlocks.length - MAX_PROPOSALS} tasks beyond ${MAX_PROPOSALS} ignored`);
    const tasks = tasksFrom(taskBlocks.slice(0, MAX_PROPOSALS), turn.qid, team);
    const actions = actionsFrom(generic, turn.qid, new Set(closes.map(c => c.id)));
    turn.answer = text; turn.answeredAt = now();
    if (proposal) { turn.proposal = proposal; turn.proposals = proposals; }
    if (relay) turn.relay = relay;
    if (closes.length > 0) turn.closes = closes;
    if (projectProposal) turn.projectProposal = projectProposal;
    if (team) turn.team = team;
    if (tasks.length > 0) turn.tasks = tasks;
    if (actions.length > 0) turn.actions = actions;
    emit({ type: 'chat.done', qid: turn.qid, text, at: turn.answeredAt, ...(proposal ? { proposal, proposals } : {}), ...(relay ? { relay } : {}), ...(closes.length > 0 ? { closes } : {}), ...(projectProposal ? { projectProposal } : {}), ...(team ? { team } : {}), ...(tasks.length > 0 ? { tasks } : {}), ...(actions.length > 0 ? { actions } : {}) });
    return { ok: true };
  }

  return {
    history: () => turns,
    attachmentIds: () => turns.flatMap(t => t.attachments?.map(a => a.id) ?? []),
    proposal: (qid, row = 0) => proposalRows(turnOf(qid))[row],
    markLaunched(qid, id, emit, row = 0) {
      const t = turnOf(qid); const p = proposalRows(t)[row]; if (!t || !p) return;
      const next = { ...p, launchedId: id }; delete next.error; setRow(t, row, next);
      emit({ type: 'chat.history', turns });
    },
    markFailed(qid, message, emit, row = 0) {
      const t = turnOf(qid); const p = proposalRows(t)[row]; if (!t || !p) return;
      setRow(t, row, { ...p, error: message });
      emit({ type: 'chat.history', turns });
    },
    relay: qid => { rollDay(); return turnOf(qid)?.relay; },
    markRelay(qid, patch, emit) {
      const t = turnOf(qid); if (!t?.relay) return;
      const { id, name, tool, text } = t.relay; t.relay = { id, name, tool, text, ...patch };
      emit({ type: 'chat.history', turns });
    },
    close: (qid, row) => { rollDay(); return turnOf(qid)?.closes?.[row]; },
    markClosed(qid, row, how, emit) {
      const t = turnOf(qid); const c = t?.closes?.[row]; if (!t || !c) return;
      const next: ChatClose = { ...c, closedAt: now(), how }; delete next.error;
      t.closes = t.closes!.map((r, i) => (i === row ? next : r));
      emit({ type: 'chat.history', turns });
    },
    markCloseFailed(qid, row, message, emit) {
      const t = turnOf(qid); const c = t?.closes?.[row]; if (!t || !c) return;
      t.closes = t.closes!.map((r, i) => (i === row ? { ...c, error: message } : r));
      emit({ type: 'chat.history', turns });
    },
    // A roll caught here is silent otherwise: the overlays would keep showing yesterday's queued card.
    queuedRelays(emit) { if (rollDay()) emit?.({ type: 'chat.history', turns }); return turns.flatMap(t => (t.relay?.status === 'queued' ? [{ qid: t.qid, relay: t.relay, askedAt: t.askedAt }] : [])); },
    team: qid => { rollDay(); return turnOf(qid)?.team; },
    markTeam(qid, patch, emit) {
      const t = turnOf(qid); if (!t?.team) return;
      const next: ChatTeamProposal = { ...t.team, ...patch };
      if (patch.teamId) delete next.error;
      t.team = next;
      emit({ type: 'chat.history', turns });
    },
    task: (qid, row) => { rollDay(); return turnOf(qid)?.tasks?.[row]; },
    markTask(qid, row, patch, emit) {
      const t = turnOf(qid); const c = t?.tasks?.[row]; if (!t || !c) return;
      const next: ChatTaskProposal = { ...c, ...patch };
      if (patch.taskId) delete next.error;
      t.tasks = t.tasks!.map((r, i) => (i === row ? next : r));
      emit({ type: 'chat.history', turns });
    },
    followTask(task, emit) {
      let changed = false;
      for (const t of turns) {
        if (!t.tasks?.some(c => c.taskId === task.id)) continue;
        t.tasks = t.tasks.map(c => (c.taskId === task.id && (c.state !== task.state || c.ownerName !== task.ownerName) ? (changed = true, { ...c, state: task.state, ownerName: task.ownerName }) : c));
      }
      if (changed) emit({ type: 'chat.history', turns });
    },
    action: (qid, row) => { rollDay(); return turnOf(qid)?.actions?.[row]; },
    markAction(qid, row, patch, emit) {
      const t = turnOf(qid); const a = t?.actions?.[row]; if (!t || !a) return;
      const next: ChatAction = { ...a, ...patch };
      if (patch.state !== 'failed' && patch.state !== 'refused') { delete next.error; delete next.code; }
      if (patch.state !== 'done' && patch.state !== 'denied') delete next.doneAt;
      t.actions = t.actions!.map((r, i) => (i === row ? next : r));
      emit({ type: 'chat.history', turns });
    },
    ignore(qid, undo, emit) {
      rollDay();
      const t = turnOf(qid);
      if (!t) return 'unknown card';
      if (!t.proposal && !t.relay && !t.closes && !t.projectProposal && !t.team && !t.tasks && !t.actions) return 'no card to ignore';
      if (undo) {
        if (!t.ignoredAt) return null;
        delete t.ignoredAt; setAside.delete(qid);
      } else {
        if (t.ignoredAt) return null;
        // A queued instruction or a row being applied is under way: it is stopped first (« Annuler »), then set aside.
        if (t.relay?.status === 'queued' || t.actions?.some(a => a.state === 'running')) return 'the card is under way';
        t.ignoredAt = now(); setAside.set(qid, { question: t.question.slice(0, 200), partly: partly(t) });
      }
      emit({ type: 'chat.history', turns });
      return null;
    },
    ignored: qid => turnOf(qid)?.ignoredAt !== undefined,
    idle: () => (busy ? new Promise<void>(res => { idleWaiters.push(res); }) : Promise.resolve()),
    cancel(qid) { if (current?.qid === qid) { current.cancelled = true; current.handle?.kill(); } },
    async reset(emit) {
      // The overlay only offers it between questions; a reset racing a question is dropped rather than orphaning its turn.
      if (busy) { log('chat reset ignored: a question is running'); return; }
      freshNext = true; turns = []; turnsDay = today(); setAside.clear();
      emit({ type: 'chat.history', turns });
      // Without a day file a restarted daemon also starts fresh.
      await rm(dayFile, { force: true }).catch(e => log(`chat reset: day file not removed: ${(e as Error).message}`));
    },
    async ask(qid, text, emit, tool = 'claude', images = []) {
      if (busy) return emit({ type: 'chat.error', qid, message: ONE_AT_A_TIME });
      if (deps.slots && !deps.slots.take()) return emit({ type: 'chat.error', qid, message: TOO_MANY });
      busy = true;
      try {
        const mine: Running = current = { qid, handle: null, cancelled: false, told: tell() };
        const turn: ChatTurn = { qid, question: text, askedAt: now(), steps: [], ...(images.length > 0 ? { attachments: images } : {}) };
        try {
          rollDay();
          turns = [...turns, turn].slice(-HISTORY_MAX);
          // Every client learns the turn before it streams, including one connected before the question (its steps would map over nothing).
          emit({ type: 'chat.history', turns });
          let r = await attempt(turn, emit, false, mine, tool);
          // A day session whose transcript is gone (or a CLI that forgot it): once more, from a fresh conversation.
          if (!r.ok && r.resumed && !mine.cancelled) { log(`chat ${qid}: resume failed (${r.message}), starting a new day session`); turn.steps.length = 0; r = await attempt(turn, emit, true, mine, tool); }
          if (!r.ok) { turn.error = r.message; emit({ type: 'chat.error', qid, message: r.message }); }
          // Only what was said: a card set aside while this question ran is told at the next one.
          else for (const q of mine.told.qids) setAside.delete(q);
        } catch (e) {
          // The context folder or the day file could not be written: the overlay still needs its unlock.
          log(`chat ${qid} failed: ${(e as Error).message}`);
          turn.error = (e as Error).message; emit({ type: 'chat.error', qid, message: turn.error });
        } finally { busy = false; current = null; }
      } finally {
        deps.slots?.give();
        const waiting = idleWaiters; idleWaiters = []; for (const res of waiting) res();
      }
    }
  };
}
