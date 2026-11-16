import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { terminalIo } from '../src/launch/terminal.js';

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (c: Buffer) => { written += c.toString(); });
  const io = terminalIo(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream);
  return { input, io, written: () => written };
}

describe('terminalIo', () => {
  it('prompts and reads a normal answer', async () => {
    const t = streams();
    const a = t.io.ask('Name', { default: 'bob' });
    t.input.write('alice\n');
    expect(await a).toBe('alice');
    expect(t.written()).toContain('Name [bob]: ');
    t.io.close();
  });

  it('never writes a secret answer to the output', async () => {
    const t = streams();
    const a = t.io.ask('Secret', { secret: true });
    t.input.write('hunter2-secret\n');
    expect(await a).toBe('hunter2-secret');
    expect(t.written()).toContain('Secret: ');
    expect(t.written()).not.toContain('hunter2');
    t.io.close();
  });

  it('rejects a pending ask when the input ends, and any later one', async () => {
    const t = streams();
    const a = t.io.ask('Name');
    t.input.end();
    await expect(a).rejects.toThrow();
    await expect(t.io.ask('Again')).rejects.toThrow();
  });
});
