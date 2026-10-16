import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_MACHINES, readMachines, writeMachines } from '../src/daemon/machines.js';
import { paths } from '../src/paths.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'ledge-machines-')), 'machines.json');
const list = [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Devbox', ssh: 'dev-server' }];

describe('machines file', () => {
  it('lives in the ledge dir', () => { expect(paths().machines).toBe(join(paths().dir, 'machines.json')); });
  it('defaults to the local machine when absent, truncated, empty or too long', () => {
    const f = file();
    expect(readMachines(f)).toEqual(DEFAULT_MACHINES);
    writeFileSync(f, '[{"id":"local"'); expect(readMachines(f)).toEqual(DEFAULT_MACHINES);
    writeFileSync(f, '[]'); expect(readMachines(f)).toEqual(DEFAULT_MACHINES);
    writeFileSync(f, JSON.stringify([list[0], ...Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, label: `m${i}`, ssh: `h${i}` }))])); expect(readMachines(f)).toEqual(DEFAULT_MACHINES);
    expect(existsSync(f)).toBe(true); // a bad file is left for the user to look at, not rewritten
  });
  it('round-trips a valid list', () => {
    const f = file(); writeMachines(list, f);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(list);
    expect(readMachines(f)).toEqual(list);
  });
});
