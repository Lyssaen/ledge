import { z } from 'zod';

/**
 * A harness's usage limits, per account (docs/mockups/ledge-harness-usage.html, v2 variant B). The daemon of each machine
 * reads them: Claude Code from Anthropic's usage API with the token Claude Code keeps (read only, never refreshed nor
 * rewritten), Codex from its transcripts (`token_count.rate_limits`). Never the token, the plan nor the subscription.
 */

export const UsageHarnessSchema = z.enum(['claude', 'codex']);
export type UsageHarness = z.infer<typeof UsageHarnessSchema>;

/** One window of an account's limits: the 5 hours, the week, or one model's own week (`model`, as the harness names it). */
export const UsageWindowSchema = z.object({
  kind: z.enum(['five_hour', 'seven_day', 'model']),
  model: z.string().min(1).max(80).optional(),
  /** How much of it is used, in percent (rounded); 100 or more: reached. */
  pct: z.number().int().min(0).max(1000),
  /** When it starts again from zero; null when the harness does not say. */
  resetsAt: z.string().datetime().nullable()
});
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

/**
 * Where a harness's limits stand on this machine:
 * - `ok`: read less than 5 minutes ago;
 * - `loading`: not read yet since the daemon started;
 * - `stale`: no read for more than 5 minutes (the last one did not fail: paused, a 429's backoff);
 * - `unreachable`: the last read failed (network, proxy, the API's error); `readAt` says when it last succeeded;
 * - `expired`: Claude Code's session has expired: sign in again in Claude Code (Ledge never refreshes it).
 * Values read more than an hour ago are never sent: `windows` is then empty.
 */
export const UsageStatusSchema = z.enum(['ok', 'loading', 'stale', 'unreachable', 'expired']);
export type UsageStatus = z.infer<typeof UsageStatusSchema>;

/** Past this share of a window, « À toi » warns (Settings › General « Alerte de limite d'usage »). */
export const USAGE_ALERT = 0.8;
export const USAGE_ALERT_MIN = 0.5;
export const USAGE_ALERT_MAX = 0.95;
export const UsagePrefsSchema = z.object({ alert: z.number().min(USAGE_ALERT_MIN).max(USAGE_ALERT_MAX) });
export type UsagePrefs = z.infer<typeof UsagePrefsSchema>;

/**
 * A harness's limits on a machine. `account`: an opaque id of the account (12 hex), the same on two machines signed in to the
 * same account, so a front shows one group for both; null when it cannot be told (Codex). Codex is listed only when its
 * transcripts carry windows (a plan that gives none: nothing at all, not even the logo); Claude Code only when it is signed in.
 */
export const HarnessUsageSchema = z.object({
  harness: UsageHarnessSchema,
  account: z.string().regex(/^[0-9a-f]{12}$/).nullable(),
  status: UsageStatusSchema,
  /** The last read that succeeded; null when none did. */
  readAt: z.string().datetime().nullable(),
  /** The 5 hours and the week first, then one window per model. Empty while loading, expired, or read more than an hour ago. */
  windows: z.array(UsageWindowSchema).max(20)
});
export type HarnessUsage = z.infer<typeof HarnessUsageSchema>;

/**
 * A window past the threshold (`threshold`) or reached (`full`), once per window and per reset: « Compris » (`usage.ack`)
 * puts it away until the window starts again. A front notifies the system (or the phone) only for `full`, once: `at` is when
 * the daemon first saw it (kept across its restarts), so a front that starts again does not notify an old one.
 * `id` is stable for that window, level and reset, and the same on every machine signed in to the account: « Compris » goes to
 * each machine that has it, and a machine that does not ignores it.
 */
export const UsageAlertSchema = z.object({
  id: z.string().min(1).max(200),
  harness: UsageHarnessSchema,
  account: z.string().regex(/^[0-9a-f]{12}$/).nullable(),
  window: UsageWindowSchema,
  level: z.enum(['threshold', 'full']),
  at: z.string().datetime()
});
export type UsageAlert = z.infer<typeof UsageAlertSchema>;

/** The daemon's usage, after every snapshot and on each change: the harnesses, the open alerts, the threshold it keeps. */
export const UsageStateMessageSchema = z.object({
  type: z.literal('usage.state'), machineId: z.string().optional(),
  harnesses: z.array(HarnessUsageSchema).max(4),
  alerts: z.array(UsageAlertSchema).max(40),
  prefs: UsagePrefsSchema
});
export type UsageStateMessage = z.infer<typeof UsageStateMessageSchema>;

/** The threshold, kept by each daemon as « Contexte max » is (a front sends it to every machine): every front gets it back in `usage.state`. */
export const UsageSetSchema = z.object({ type: z.literal('usage.set'), prefs: UsagePrefsSchema, machineId: z.string().optional() });
/** « Compris » on an alert: put away until its window starts again. */
export const UsageAckSchema = z.object({ type: z.literal('usage.ack'), id: z.string().min(1).max(200), machineId: z.string().optional() });
export type UsageSet = z.infer<typeof UsageSetSchema>;
export type UsageAck = z.infer<typeof UsageAckSchema>;

/** The stable id of an alert: harness, account, window (and model), level and reset. */
export const usageAlertId = (harness: UsageHarness, account: string | null, w: Pick<UsageWindow, 'kind' | 'model' | 'resetsAt'>, level: 'threshold' | 'full'): string =>
  [harness, account ?? '-', w.kind, w.model ?? '-', level, w.resetsAt ?? '-'].join('|').slice(0, 200);
