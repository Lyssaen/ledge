import { describe, it, expect } from 'vitest';
import { MachinesSchema, parseClientMessage, parseServerMessage } from '../src/index.js';

const local = { id: 'local', label: 'Local' };
const dev = { id: 'dev', label: 'Devbox', ssh: 'dev-server' };

describe('machines schema', () => {
  it('accepts the local machine first then ssh aliases', () => {
    expect(MachinesSchema.parse([local, dev])).toEqual([local, dev]);
    expect(MachinesSchema.parse([{ id: 'local', label: '  Local  ' }])[0]!.label).toBe('Local');
  });
  it('refuses an empty list, a non-local first entry, a remote without ssh, duplicates, and more than 20', () => {
    expect(() => MachinesSchema.parse([])).toThrow();
    expect(() => MachinesSchema.parse([dev, local])).toThrow();
    expect(() => MachinesSchema.parse([{ ...local, ssh: 'x' }])).toThrow();
    expect(() => MachinesSchema.parse([local, { id: 'dev', label: 'Devbox' }])).toThrow();
    expect(() => MachinesSchema.parse([local, dev, { ...dev, id: 'dev2' }])).toThrow();   // same alias
    expect(() => MachinesSchema.parse([local, dev, { ...dev, ssh: 'other' }])).toThrow(); // same id
    expect(() => MachinesSchema.parse([local, ...Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, label: `m${i}`, ssh: `h${i}` }))])).toThrow();
    expect(() => MachinesSchema.parse([local, { id: 'bad id', label: 'x', ssh: 'h' }])).toThrow();
    expect(() => MachinesSchema.parse([local, { id: 'd', label: 'x'.repeat(81), ssh: 'h' }])).toThrow();
  });
  it('rides in machines.set and machines messages', () => {
    expect(parseClientMessage({ type: 'machines.set', machines: [local, dev] })).toEqual({ type: 'machines.set', machines: [local, dev] });
    expect(parseServerMessage({ type: 'machines', machines: [local] })).toEqual({ type: 'machines', machines: [local] });
    expect(() => parseClientMessage({ type: 'machines.set', machines: [] })).toThrow();
  });
});
