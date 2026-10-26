import { z } from 'zod';

/** Images pasted into a prompt or a chat question (spec 2026-10-26 image paste §5). */

/** An attachment's id: the lowercase hex sha256 of its stored bytes. The daemon serves files by id only. */
export const ATTACHMENT_ID = /^[0-9a-f]{64}$/;
export const AttachmentIdSchema = z.string().regex(ATTACHMENT_ID);

export const IMAGE_MIMES = ['image/webp', 'image/jpeg', 'image/png', 'image/gif'] as const;
export const ImageMimeSchema = z.enum(IMAGE_MIMES);
export type ImageMime = z.infer<typeof ImageMimeSchema>;

/** Encoded size of an image from a phone or the fleet, of a local one, and of a preview (bytes). */
export const ATTACHMENT_MAX = 400_000;
export const ATTACHMENT_LOCAL_MAX = 2_000_000;
export const PREVIEW_MAX = 40_000;
/** Images per message. */
export const ATTACHMENTS_MAX = 5;
/** Long side of an encoded image and of its preview (pixels). */
export const IMAGE_LONG_SIDE = 1_600;
export const PREVIEW_LONG_SIDE = 480;

/** The most base64 characters that `bytes` bytes encode to. */
export const b64Max = (bytes: number): number => Math.ceil(bytes / 3) * 4;

/** A stored image as a client sees it; `preview`: whether a preview exists (the TUI makes none on Linux or macOS). */
export const AttachmentRefSchema = z.object({
  id: AttachmentIdSchema, mime: ImageMimeSchema, width: z.number().int().positive(), height: z.number().int().positive(), bytes: z.number().int().positive(), preview: z.boolean()
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

/** An image to store, base64 without a data-URL prefix; the stored type is sniffed from the bytes, not taken from `mime`. */
export const ImageUploadSchema = z.object({
  mime: ImageMimeSchema, data: z.string().min(1).max(b64Max(ATTACHMENT_LOCAL_MAX)),
  preview: z.object({ mime: ImageMimeSchema, data: z.string().min(1).max(b64Max(PREVIEW_MAX)) }).optional()
});
export type ImageUpload = z.infer<typeof ImageUploadSchema>;

/** `offline` is only emitted by the fleet, when the target machine is not connected. */
export const AttachmentErrorReasonSchema = z.enum(['too_large', 'not_image', 'unreadable', 'not_found', 'offline']);
export type AttachmentErrorReason = z.infer<typeof AttachmentErrorReasonSchema>;

const requestId = z.string().min(1).max(100);

/** Stores an image. `id`: the session it is for, qualified by the fleet, which routes by it (the local machine when absent). */
export const AttachmentPutSchema = z.object({ type: z.literal('attachment.put'), requestId, id: z.string().optional(), image: ImageUploadSchema });
/** Reads a stored image or its preview. Routed by the session `id` or by `machine` (a chat turn's machine); local when neither. */
export const AttachmentGetSchema = z.object({ type: z.literal('attachment.get'), requestId, attachment: AttachmentIdSchema, preview: z.boolean().optional(), id: z.string().optional(), machine: z.string().optional() });

export const AttachmentStoredSchema = z.object({ type: z.literal('attachment.stored'), requestId, ref: AttachmentRefSchema });
export const AttachmentDataSchema = z.object({ type: z.literal('attachment.data'), requestId, attachment: AttachmentIdSchema, mime: ImageMimeSchema, data: z.string() });
export const AttachmentErrorSchema = z.object({ type: z.literal('attachment.error'), requestId, reason: AttachmentErrorReasonSchema });
