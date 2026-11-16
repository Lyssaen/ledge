import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import type { SetupIo } from './setup.js';

/** The dialogue on a real terminal; a secret answer is not echoed, and Ctrl-C or end of input rejects the pending question. */
export function terminalIo(input: NodeJS.ReadStream, output: NodeJS.WriteStream): SetupIo & { close(): void } {
  let muted = false;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) output.write(chunk);
      cb();
    }
  });
  const rl = createInterface({ input, output: sink, terminal: Boolean(input.isTTY) });
  let rejectPending: ((e: Error) => void) | null = null;
  let ended = false;
  const end = () => {
    ended = true;
    rejectPending?.(new Error('input ended'));
    rejectPending = null;
  };
  rl.on('close', end);
  rl.on('SIGINT', () => { rl.close(); });

  return {
    ask(question, o) {
      if (ended) return Promise.reject(new Error('input ended'));
      return new Promise<string>((resolve, reject) => {
        rejectPending = reject;
        output.write(`${question}${o?.default ? ` [${o.default}]` : ''}: `);
        muted = Boolean(o?.secret);
        rl.question('', (answer) => {
          muted = false;
          rejectPending = null;
          if (o?.secret) output.write('\n');
          resolve(answer);
        });
      });
    },
    say(line) {
      output.write(`${line}\n`);
    },
    close() {
      rl.close();
    }
  };
}
