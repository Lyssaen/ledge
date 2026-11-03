import { describe, expect, it } from 'vitest';
import { frameLines, panehostPath, PANEHOST_PROTOCOL, proof } from '../src/panes/protocol.js';

describe('frameLines', () => {
  it('joins a frame split across chunks and splits two frames in one chunk', () => {
    const got: string[] = [];
    const feed = frameLines(l => got.push(l));
    feed('{"id":1,'); feed(Buffer.from('"op":"listSessions"}\n{"id":2}\n{"id"'));
    expect(got).toEqual(['{"id":1,"op":"listSessions"}', '{"id":2}']);
    feed(':3}\n');
    expect(got.at(-1)).toBe('{"id":3}');
  });
  it('keeps a multi-byte character split across chunks whole', () => {
    const got: string[] = [];
    const feed = frameLines(l => got.push(l));
    const bytes = Buffer.from('"é"\n');
    feed(bytes.subarray(0, 2)); feed(bytes.subarray(2));
    expect(got).toEqual(['"é"']);
  });
  it('throws past 4 MiB without a newline', () => {
    const feed = frameLines(() => {});
    expect(() => feed('x'.repeat(4 * 1024 * 1024 + 1))).toThrow(/too long/);
  });
});

describe('panehostPath', () => {
  it('on Windows a named pipe named after the token: another account cannot know it ahead of the host', () => {
    const a = panehostPath('win32', 'C:\\Users\\a\\.ledge', 'a'.repeat(64));
    expect(a).toMatch(/^\\\\\.\\pipe\\ledge-panes-[0-9a-f]{32}$/);
    expect(panehostPath('win32', 'C:\\Users\\a\\.ledge', 'b'.repeat(64))).not.toBe(a);
    expect(a).not.toContain('a'.repeat(16));
  });
  it('elsewhere a socket in the Ledge folder', () => expect(panehostPath('linux', '/h/.ledge', 'a'.repeat(64))).toBe('/h/.ledge/panes.sock'));
  it('speaks protocol 1', () => expect(PANEHOST_PROTOCOL).toBe(1));
});

describe('proof', () => {
  it('binds the token, the side and both nonces, and never contains the token', () => {
    const t = 'f'.repeat(64);
    const p = proof(t, 'host', 'n1', 'n2');
    expect(p).toMatch(/^[0-9a-f]{64}$/);
    expect(p).not.toContain(t);
    expect(proof(t, 'client', 'n1', 'n2')).not.toBe(p);
    expect(proof(t, 'host', 'n1', 'n3')).not.toBe(p);
    expect(proof('e'.repeat(64), 'host', 'n1', 'n2')).not.toBe(p);
  });
});
