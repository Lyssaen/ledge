import { describe, expect, it } from 'vitest';
import xterm from '@xterm/headless';
import { captureLines } from '../src/panes/capture.js';

const term = async (data: string, cols = 20, rows = 10) => {
  const t = new xterm.Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
  await new Promise<void>(r => t.write(data, r));
  return t;
};

describe('captureLines', () => {
  it('joins a soft-wrapped line, keeps hard breaks', async () => {
    const t = await term('a'.repeat(25) + '\r\nnext');
    expect(captureLines(t.buffer.active, 10)).toBe('a'.repeat(25) + '\nnext');
  });
  it('keeps a space that falls on the wrap', async () => {
    const t = await term('a'.repeat(19) + ' b');
    expect(captureLines(t.buffer.active, 10)).toBe('a'.repeat(19) + ' b');
  });
  it('with join off, keeps a wrapped row apart (ConPTY flags the row after a full one as wrapped)', async () => {
    const t = await term('─'.repeat(20) + ' Create file');
    expect(captureLines(t.buffer.active, 10, { join: false }).split('\n')).toEqual(['─'.repeat(20), ' Create file']);
  });
  it('keeps the last N lines, history included', async () => {
    const t = await term(Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\r\n'));
    expect(captureLines(t.buffer.active, 5)).toBe(['line 56', 'line 57', 'line 58', 'line 59', 'line 60'].join('\n'));
  });
  it('a full-width rule then a CRLF prompt stays two lines', async () => {
    const t = await term('─'.repeat(20) + '\r\n> hi');
    expect(captureLines(t.buffer.active, 10).split('\n')).toEqual(['─'.repeat(20), '> hi']);
  });
});
