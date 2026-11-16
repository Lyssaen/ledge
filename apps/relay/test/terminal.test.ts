import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { terminalIo } from '../src/launch/terminal.js';

function streams() {
  // isTTY makes readline run in terminal mode, where it echoes typed characters: the only mode in which muting matters.
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new PassThrough(), { isTTY: true });
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

  it('echoes a normal answer in terminal mode, which proves the secret test can fail', async () => {
    const t = streams();
    const a = t.io.ask('Name');
    t.input.write('visible-answer\n');
    await a;
    expect(t.written()).toContain('visible-answer');
    t.io.close();
  });

  it('leaves the question on screen in terminal mode: nothing clears the line after it', async () => {
    const t = streams();
    const a = t.io.ask('Name', { default: 'bob' });
    t.input.write('alicx\x7fe\n');
    expect(await a).toBe('alice');
    const after = t.written().slice(t.written().lastIndexOf('Name [bob]: '));
    expect(after.startsWith('Name [bob]: ')).toBe(true);
    expect(after).not.toContain('\x1b[0J');
    t.io.close();
  });

  it('leaves a secret question on screen in terminal mode', async () => {
    const t = streams();
    const a = t.io.ask('Secret', { secret: true });
    t.input.write('hunter2-secrex\x7ft\n');
    expect(await a).toBe('hunter2-secret');
    const after = t.written().slice(t.written().lastIndexOf('Secret: '));
    expect(after.startsWith('Secret: ')).toBe(true);
    expect(after).not.toContain('\x1b[0J');
    expect(t.written()).not.toContain('hunter2');
    t.io.close();
  });

  it('rejects a pending ask on Ctrl-C', async () => {
    const t = streams();
    const a = t.io.ask('Name');
    t.input.write('\x03');
    await expect(a).rejects.toThrow();
  });

  it('rejects a pending ask when the input ends, and any later one', async () => {
    const t = streams();
    const a = t.io.ask('Name');
    t.input.end();
    await expect(a).rejects.toThrow();
    await expect(t.io.ask('Again')).rejects.toThrow();
  });
});
