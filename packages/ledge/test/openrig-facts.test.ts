import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { openrigBase, REGISTRATION, HUMAN_ADDRESS, HUMAN_BINDING, EVENTS, QUEUE_ROW, OUTBOX_EVENT } from '../src/daemon/openrig/facts.js';
import { paths } from '../src/paths.js';

describe('openrig facts', () => {
  it('openrigBase defaults to 7433 and honours OPENRIG_PORT', () => {
    expect(openrigBase({})).toBe('http://127.0.0.1:7433');
    expect(openrigBase({ OPENRIG_PORT: '7500' })).toBe('http://127.0.0.1:7500');
    expect(openrigBase({ OPENRIG_PORT: 'x' })).toBe('http://127.0.0.1:7433');
  });
  it('HUMAN_ADDRESS follows REGISTRATION', () => {
    expect(HUMAN_ADDRESS).toBe(REGISTRATION === 'external' ? 'ledge@external' : 'human-ledge@host');
    expect(REGISTRATION).toBe('external');
  });
  it('binding points at a decoy file that is never created', () => {
    expect(HUMAN_BINDING).toMatch(/^slack:ledge-decoy:file:.+ledge-decoy-slack\.env:primary$/);
  });
  it('carries the probed constants', () => {
    expect(EVENTS.queueCreated).toBe('queue.created');
    expect(QUEUE_ROW.questions).toBe('humanQuestions');
    expect(OUTBOX_EVENT).toBeNull();
  });
  it('paths().openrig sits under LEDGE_HOME', () => {
    const prev = process.env.LEDGE_HOME;
    process.env.LEDGE_HOME = '/tmp/x-ledge';
    try { expect(paths().openrig).toBe(join('/tmp/x-ledge', 'openrig.json')); } finally { if (prev === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = prev; }
  });
});
