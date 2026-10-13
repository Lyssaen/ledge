import { z } from 'zod';

export const DOCUMENT_MAX_BYTES = 1_048_576;
const path = z.string().min(1).max(4096);
const requestId = z.string().min(1);

export const DocumentReadSchema = z.object({
  type: z.literal('document.read'), requestId, path,
  machineId: z.string().optional(),
  sessionId: z.string().min(1).optional(), basePath: path.optional()
});
export const DocumentContentSchema = z.object({
  type: z.literal('document.content'), requestId, path, text: z.string(),
  bytes: z.number().int().nonnegative(), modifiedAt: z.string().datetime()
});
export const DocumentErrorCodeSchema = z.enum([
  'not_found', 'not_file', 'unsupported_path', 'unsupported_type', 'permission_denied',
  'too_large', 'invalid_utf8', 'ambiguous_path', 'session_missing', 'read_failed'
]);
export const DocumentErrorSchema = z.object({
  type: z.literal('document.error'), requestId, path, code: DocumentErrorCodeSchema
});
export type DocumentRead = z.infer<typeof DocumentReadSchema>;
export type DocumentContent = z.infer<typeof DocumentContentSchema>;
export type DocumentErrorCode = z.infer<typeof DocumentErrorCodeSchema>;
export type DocumentError = z.infer<typeof DocumentErrorSchema>;
