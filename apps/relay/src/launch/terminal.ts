import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { SetupInterrupted, type SetupIo } from './setup.js';

/** The dialogue on a real terminal; a secret answer is not echoed, and Ctrl-C or end of input rejects the pending question with `SetupInterrupted`. */
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
    // The line that follows an interrupted question starts on a line of its own.
    if (rejectPending) output.write('\n');
    rejectPending?.(new SetupInterrupted());
    rejectPending = null;
  };
  rl.on('close', end);
  rl.on('SIGINT', () => { rl.close(); });

  return {
    ask(question, o) {
      if (ended) return Promise.reject(new SetupInterrupted());
      return new Promise<string>((resolve, reject) => {
        rejectPending = reject;
        // The question is readline's own prompt: in terminal mode readline redraws its prompt line, so text written
        // before it would be erased. The prompt is written synchronously here, so muting afterwards hides only keystrokes.
        muted = false;
        rl.question(`${question}${o?.default ? ` [${o.default}]` : ''}: `, (answer) => {
          muted = false;
          rejectPending = null;
          if (o?.secret) output.write('\n');
          resolve(answer);
        });
        muted = Boolean(o?.secret);
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
