import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerMessage, AttachmentRefSchema, b64Max, ATTACHMENT_MAX, ATTACHMENT_LOCAL_MAX } from '../src/index.js';

const ID = 'a'.repeat(64);

describe('attachments', () => {
  it('accepts a put and refuses a type that is not an accepted image', () => {
    const put = { type: 'attachment.put', requestId: 'r1', image: { mime: 'image/png', data: 'iVBORw0KGgo=' } };
    expect(parseClientMessage(put)).toEqual(put);
    expect(parseClientMessage({ ...put, id: 's1', image: { ...put.image, preview: { mime: 'image/webp', data: 'AAAA' } } }).type).toBe('attachment.put');
    expect(() => parseClientMessage({ ...put, image: { ...put.image, mime: 'image/bmp' } })).toThrow();
    expect(() => parseClientMessage({ ...put, image: { mime: 'image/png', data: '' } })).toThrow();
    expect(() => parseClientMessage({ ...put, image: { mime: 'image/png', data: 'A'.repeat(b64Max(ATTACHMENT_LOCAL_MAX) + 1) } })).toThrow();
  });

  it('accepts a get by a sha256 id only', () => {
    const get = { type: 'attachment.get', requestId: 'r1', attachment: ID };
    expect(parseClientMessage(get)).toEqual(get);
    expect(parseClientMessage({ ...get, preview: true, machine: 'm1' }).type).toBe('attachment.get');
    for (const attachment of ['ABC', '../x', 'a'.repeat(63), 'A'.repeat(64)]) expect(() => parseClientMessage({ ...get, attachment })).toThrow();
  });

  it('round-trips a ref', () => {
    const ref = { id: ID, mime: 'image/webp', width: 1440, height: 900, bytes: 212_000, preview: true };
    expect(AttachmentRefSchema.parse(ref)).toEqual(ref);
    expect(() => AttachmentRefSchema.parse({ ...ref, width: 0 })).toThrow();
    expect(() => AttachmentRefSchema.parse({ ...ref, preview: undefined })).toThrow();
  });

  it('carries the three answers', () => {
    const ref = { id: ID, mime: 'image/gif', width: 2, height: 2, bytes: 40, preview: false };
    expect(parseServerMessage({ type: 'attachment.stored', requestId: 'r1', ref }).type).toBe('attachment.stored');
    expect(parseServerMessage({ type: 'attachment.data', requestId: 'r1', attachment: ID, mime: 'image/gif', data: 'R0lG' }).type).toBe('attachment.data');
    for (const reason of ['too_large', 'not_image', 'unreadable', 'not_found', 'offline']) expect(parseServerMessage({ type: 'attachment.error', requestId: 'r1', reason }).type).toBe('attachment.error');
    expect(() => parseServerMessage({ type: 'attachment.error', requestId: 'r1', reason: 'nope' })).toThrow();
  });

  it('sizes base64 like the encoder', () => {
    expect(b64Max(3)).toBe(4);
    expect(b64Max(4)).toBe(8);
    expect(Buffer.from(Buffer.alloc(ATTACHMENT_MAX)).toString('base64').length).toBeLessThanOrEqual(b64Max(ATTACHMENT_MAX));
  });
});
