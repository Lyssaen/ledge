import { describe, expect, it } from 'vitest';
import { taskOf } from '../src/thread/task';

describe('a <task-notification>', () => {
  const note = (status: string, summary: string, extra = '') =>
    `<task-notification>\n<task-id>b7x</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>${extra}\n</task-notification>`;

  it('is a prompt only when the text opens with it', () => {
    expect(taskOf('Câble la liste')).toBeNull();
    expect(taskOf(`Voir ${note('killed', 'x')}`)).toBeNull();
  });

  it('the spaces around it do not matter, and the raw keeps the notification without them', () => {
    expect(taskOf(`\n  ${note('completed', 'Agent "Plan" completed')}\n`)).toMatchObject({ status: 'completed', about: { kind: 'agent', name: 'Plan' }, raw: note('completed', 'Agent "Plan" completed') });
  });

  it('a stopped agent: its name', () => {
    expect(taskOf(note('killed', 'Agent "Explore" was stopped'))).toMatchObject({ id: 'b7x', status: 'killed', about: { kind: 'agent', name: 'Explore' } });
  });

  it('a background command: its command, its exit code and output file', () => {
    const t = taskOf(note('failed', 'Background command "npm test" failed (exit code 1)', '\n<output-file>/tmp/b7x.out</output-file>'))!;
    expect(t).toMatchObject({ status: 'failed', output: '/tmp/b7x.out', about: { kind: 'command', command: 'npm test', code: '1' } });
    expect(t.raw).toMatch(/^<task-notification>/);
  });

  it('an unknown status or sentence: « other », its summary as it came', () => {
    expect(taskOf(note('paused', 'Quelque chose'))).toMatchObject({ status: 'other', summary: 'Quelque chose', about: null });
  });
});
