import { z } from 'zod';

/** How much a request can do if accepted blindly: `high` needs a fresh device check on the phone. */
export const RiskSchema = z.enum(['low', 'high']);
export type Risk = z.infer<typeof RiskSchema>;

export const RiskReasonSchema = z.enum(['question', 'read_only_command', 'edit_inside_folder', 'pushes', 'destroys', 'deploys', 'publishes', 'pipes_to_shell', 'network', 'writes_outside_folder', 'sensitive_path', 'unsafe_flag', 'shell_syntax', 'script', 'plan', 'unknown']);
export type RiskReason = z.infer<typeof RiskReasonSchema>;

/** A phone-made operation is named by a uuid it generates, so a retry after a lost connection is recognised. */
export const OperationIdSchema = z.string().uuid();
export type OperationId = z.infer<typeof OperationIdSchema>;

export const OperationStatusSchema = z.enum(['received', 'applied', 'rejected', 'failed', 'unknown']);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

/** Why an operation was refused. Also the `message` of an `error` answering a failed `decide.prepare`. */
export const OperationReasonSchema = z.enum(['stale', 'changed', 'assertion_required', 'assertion_invalid', 'assertion_expired', 'not_taken', 'no_prompt', 'read_only', 'busy', 'forbidden', 'conflict', 'agent_busy', 'unsupported', 'invalid']);
export type OperationReason = z.infer<typeof OperationReasonSchema>;

/** A WebAuthn assertion as the browser serialises it (the counterpart of `RegistrationJsonSchema`). */
export const AuthenticationJsonSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal('public-key'),
  response: z.object({ clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string() }).passthrough()
}).passthrough();
export type AuthenticationJson = z.infer<typeof AuthenticationJsonSchema>;
