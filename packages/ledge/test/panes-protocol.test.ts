import { describe, expect, it } from 'vitest';
import { frameLines, panehostPath, PANEHOST_PROTOCOL } from '../src/panes/protocol.js';

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
  it('is a named pipe per Ledge folder on Windows, a socket in it elsewhere', () => {
    const a = panehostPath('win32', {}, 'C:\\Users\\a\\.ledge');
    expect(a).toMatch(/^\\\\\.\\pipe\\ledge-panes-[0-9a-f]{16}$/);
    expect(panehostPath('win32', {}, 'C:\\Users\\b\\.ledge')).not.toBe(a);
    expect(panehostPath('linux', {}, '/h/.ledge')).toBe('/h/.ledge/panes.sock');
  });
  it('speaks protocol 1', () => expect(PANEHOST_PROTOCOL).toBe(1));
});
