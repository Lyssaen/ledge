import { z } from 'zod';
import { RefusalCodeSchema } from './refusal.js';

/**
 * GitHub pull requests and GitLab merge requests (IDE lot 8a, docs/ide-workspace.md « MR et PR »). Each daemon reads, with the
 * machine's own `gh` and `glab`, the requests whose source branch is the branch of one of its sessions or OpenRig seats, and
 * pushes them in `forge.state`. The detail and the actions are requests answered with the same `requestId`. No token ever
 * travels here: the CLIs use the machine's own sign-in.
 */

const FORGE_KINDS = ['github', 'gitlab'] as const;
export const ForgeKindSchema = z.enum(FORGE_KINDS);
export type ForgeKind = z.infer<typeof ForgeKindSchema>;

/** A pipeline's or a job's state; `none`: no pipeline at all. */
const PIPE_STATUSES = ['ok', 'run', 'fail', 'wait', 'skip', 'none'] as const;
export const PipeStatusSchema = z.enum(PIPE_STATUSES);
export type PipeStatus = z.infer<typeof PipeStatusSchema>;

/** `review`: reviewers are awaited or asked for changes; `open` otherwise (R4). */
const PR_STATES = ['draft', 'open', 'review', 'merged', 'closed'] as const;
export const PrStateSchema = z.enum(PR_STATES);
export type PrState = z.infer<typeof PrStateSchema>;

/** The longest comment or reply a front may send (64 KiB). */
export const FORGE_BODY_MAX = 65536;

/** The stable id of a request: its host, its repository path and its number. */
export const prIdOf = (host: string, path: string, number: number): string => `${host}/${path}#${number}`;

export const PullRequestSchema = z.object({
  /** `${host}/${repo}#${number}`, stable. */
  id: z.string().min(1),
  forge: ForgeKindSchema,
  host: z.string().min(1),
  /** The repository's path: `owner/name`, or `group/sub/project`. */
  repo: z.string().min(1),
  number: z.number().int().positive(),
  /** As the forge shows it: `#226` (GitHub) or `!41` (GitLab). */
  ref: z.string(),
  /** « Ouvrir sur GitHub / GitLab »: the front opens it itself (R11). */
  url: z.string().url(),
  title: z.string(),
  state: PrStateSchema,
  /** The source branch, and the branch it goes into. */
  branch: z.string(), target: z.string(),
  headSha: z.string(),
  pipeline: PipeStatusSchema,
  /** `required` when the forge gives it (GitLab); GitHub leaves it out. */
  approvals: z.object({ given: z.number().int().min(0), required: z.number().int().min(0).optional() }),
  /** The mockup's `ok`: all that a merge needs (R5), the pipeline set apart. */
  mergeable: z.boolean(),
  /** Threads that can be resolved and are not. */
  openThreads: z.number().int().min(0),
  updatedAt: z.string().datetime(),
  /** The daemon's sessions on that branch, most recently active first (R12); the fleet qualifies them `machine:id`. */
  sessions: z.array(z.string())
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

/**
 * A session the daemon follows (its branch is not its repository's default one): the forge and host its repository is on, so a
 * front can tell « no request » from « that forge cannot be read here » (the chip « PR ? »). The fleet qualifies `session`.
 */
export const FollowedSessionSchema = z.object({ session: z.string(), forge: ForgeKindSchema, host: z.string(), repo: z.string() });
export type FollowedSession = z.infer<typeof FollowedSessionSchema>;

/** Whether a forge could be read on the machine: its CLI missing, not signed in, or another error, with its (redacted) message. */
export const ForgeStatusSchema = z.object({
  forge: ForgeKindSchema, host: z.string(),
  status: z.enum(['ok', 'missing', 'unauthenticated', 'error']),
  message: z.string().optional(),
  at: z.string().datetime(),
  /** Not `ok`: since when the forge cannot be read, whatever its messages since (« le relevé échoue depuis 10:42 »). */
  since: z.string().datetime().optional(),
  /** After a failed read (`error` mostly): when the daemon reads it again, its backoff of 2 to 10 minutes (« Nouvel essai à 10:50 »). */
  retryAt: z.string().datetime().optional(),
  /** Not `ok`: when its requests, still shown, were last read; absent when they never were. */
  readAt: z.string().datetime().optional()
});
export type ForgeStatus = z.infer<typeof ForgeStatusSchema>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const known = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);

/** Tolerance for a front older than its daemon: a request whose forge, state or pipeline it does not know is dropped, not the message. */
export const dropUnknownPrs = (raw: unknown): unknown =>
  Array.isArray(raw) ? raw.filter(p => isRecord(p) && known(FORGE_KINDS, p.forge) && known(PR_STATES, p.state) && known(PIPE_STATUSES, p.pipeline)) : raw;
/** The same for the forges' statuses: an unknown forge is dropped. */
export const dropUnknownForges = (raw: unknown): unknown => (Array.isArray(raw) ? raw.filter(f => isRecord(f) && known(FORGE_KINDS, f.forge)) : raw);

/** The daemon's requests and forges, after each snapshot and on every change. */
export const ForgeStateMessageSchema = z.object({
  type: z.literal('forge.state'),
  prs: z.preprocess(dropUnknownPrs, z.array(PullRequestSchema)),
  forges: z.preprocess(dropUnknownForges, z.array(ForgeStatusSchema)),
  /** Absent from a daemon older than this field. */
  followed: z.preprocess(dropUnknownForges, z.array(FollowedSessionSchema)).optional(),
  machineId: z.string().optional()
});
export type ForgeStateMessage = z.infer<typeof ForgeStateMessageSchema>;

/**
 * A pipeline's job, for the graph (R7): GitLab, `column` is its stage's index; GitHub, one column per workflow. An unknown
 * status reads `none`.
 */
export const PrJobSchema = z.object({
  id: z.string(), name: z.string(),
  column: z.number().int().min(0), columnName: z.string(),
  status: z.preprocess(s => (known(PIPE_STATUSES, s) ? s : 'none'), PipeStatusSchema),
  durationS: z.number().min(0).optional()
});
export type PrJob = z.infer<typeof PrJobSchema>;

export const PrCommentSchema = z.object({ id: z.string(), author: z.string(), at: z.string().datetime(), body: z.string() });
export type PrComment = z.infer<typeof PrCommentSchema>;
/**
 * A discussion: a review thread on a line (`file`, `line`, the diff's line as `code`), or a comment on the request itself
 * (not resolvable). The first comment opens it, the others are its replies.
 */
export const PrThreadSchema = z.object({
  id: z.string(), resolvable: z.boolean(), resolved: z.boolean(),
  file: z.string().optional(), line: z.number().int().optional(), code: z.string().optional(),
  comments: z.array(PrCommentSchema).min(1)
});
export type PrThread = z.infer<typeof PrThreadSchema>;
/** A changed file; its `patch` left out past 200 KiB for the whole request. */
export const PrFileSchema = z.object({ path: z.string(), added: z.number().int().min(0), removed: z.number().int().min(0), patch: z.string().optional() });
export type PrFile = z.infer<typeof PrFileSchema>;
export const PrReviewerSchema = z.object({ name: z.string(), state: z.enum(['approved', 'changes', 'pending']) });
export type PrReviewer = z.infer<typeof PrReviewerSchema>;
export const PrCommitSchema = z.object({ sha: z.string(), title: z.string(), author: z.string(), at: z.string().datetime() });
export type PrCommit = z.infer<typeof PrCommitSchema>;

export const PrDetailSchema = z.object({
  pr: PullRequestSchema,
  description: z.string(), author: z.string(),
  reviewers: z.array(PrReviewerSchema),
  labels: z.array(z.string()),
  /** The tickets it closes, as the forge shows them (`#38`). */
  issues: z.array(z.string()),
  jobs: z.array(PrJobSchema),
  /** A job's log when asked (`forge.detail` with `log`): its last 60 lines, no ANSI, redacted. */
  log: z.object({ jobId: z.string(), text: z.string() }).optional(),
  threads: z.array(PrThreadSchema),
  files: z.array(PrFileSchema),
  commits: z.array(PrCommitSchema),
  /** The exact command a merge runs, for the front's confirmation (R5). */
  mergeCommand: z.string(),
  /**
   * Why a merge is refused now, as codes; empty: it can be merged (R5). `not_open`, `draft`, `approvals`, `changes_requested`;
   * `pipeline`: the pipeline is not green (`pr.pipeline` says how); `pipeline_not_started`: no pipeline yet on the head, in a
   * repository with CI or whose CI is unknown (`pr.pipeline` reads `wait`). A repository without any CI gives `none` and no code.
   * A front shows a code it does not know as is.
   */
  mergeBlockers: z.array(z.string())
});
export type PrDetail = z.infer<typeof PrDetailSchema>;

/** The closed list of what a front may do on a request (R5, R6). */
export const ForgeActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rerun') }),
  /** `headSha`: the head the person saw; `stale` when it has moved. */
  z.object({ kind: z.literal('merge'), headSha: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('comment'), body: z.string().min(1).max(FORGE_BODY_MAX) }),
  z.object({ kind: z.literal('reply'), threadId: z.string().min(1).max(200), body: z.string().min(1).max(FORGE_BODY_MAX) }),
  z.object({ kind: z.literal('resolve'), threadId: z.string().min(1).max(200) })
]);
export type ForgeAction = z.infer<typeof ForgeActionSchema>;

/** Client → daemon: a request's detail (`log`: also a job's log, by job id). Routed by the fleet with `machineId`. */
export const ForgeDetailSchema = z.object({ type: z.literal('forge.detail'), requestId: z.string().min(1).max(100), prId: z.string().min(1).max(500), log: z.string().min(1).max(40).optional(), machineId: z.string().optional() });
export type ForgeDetail = z.infer<typeof ForgeDetailSchema>;
export const ForgeActSchema = z.object({ type: z.literal('forge.act'), requestId: z.string().min(1).max(100), prId: z.string().min(1).max(500), machineId: z.string().optional(), action: ForgeActionSchema });
export type ForgeAct = z.infer<typeof ForgeActSchema>;

/** Daemon → its requester. */
export const ForgeDetailReplySchema = z.object({ type: z.literal('forge.detail.reply'), requestId: z.string(), ok: z.boolean(), detail: PrDetailSchema.optional(), message: z.string().optional(), code: RefusalCodeSchema.optional() });
export type ForgeDetailReply = z.infer<typeof ForgeDetailReplySchema>;
/** `command`: what was run; a refusal carries its `code` (`not_offered` with the reason, `stale`, `busy`, `unavailable`). */
export const ForgeActReplySchema = z.object({ type: z.literal('forge.act.reply'), requestId: z.string(), ok: z.boolean(), command: z.string().optional(), message: z.string().optional(), code: RefusalCodeSchema.optional() });
export type ForgeActReply = z.infer<typeof ForgeActReplySchema>;
