import { describe, it, expect } from 'vitest';
import { adapterFor } from '../src/adapters/index.js';

describe.each(['claude', 'codex', 'cursor'] as const)('%s: the command that quits the CLI', tool => {
  const adapter = adapterFor(tool);

  it('exits with /exit', () => {
    expect(adapter.exitText()).toBe('/exit');
  });

  it('clears the input line, types the command and submits, with nothing to wait for', () => {
    const plan = adapter.exitPlan();
    expect(plan).toContainEqual({ text: adapter.exitText() });
    expect(plan[0]).toEqual({ keys: [tool === 'cursor' ? 'C-c' : 'C-u'] });
    expect(plan.at(-1)).toEqual({ keys: ['Enter'] });
    expect(plan.some(step => 'until' in step)).toBe(false);
  });
});
