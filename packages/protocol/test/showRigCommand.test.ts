import { describe, it, expect } from 'vitest';
import { showRigCommand, showRigCommandWithoutPaths } from '../src/index.js';

describe('a rig command shown without the PC\'s paths', () => {
  it('masks each argument that is a path, whatever it holds (spaces, dashes)', () => {
    const add = ['add', 'R1', 'dev', '/home/me/.ledge/rigs/x/seats/dev.back-2.json', '--rig-root', '/home/me/My -Private Project', '--json'];
    expect(showRigCommandWithoutPaths(add)).toBe('rig add R1 dev … --rig-root …');
    expect(showRigCommand(add)).toBe('rig add R1 dev /home/me/.ledge/rigs/x/seats/dev.back-2.json --rig-root /home/me/My -Private Project');
  });
  it('keeps a flag whose value is a path, a Windows or home path, and leaves the rest as it is', () => {
    expect(showRigCommandWithoutPaths(['up', 'starter', '--cwd=/w/ledge', '--yes'])).toBe('rig up starter --cwd=… --yes');
    expect(showRigCommandWithoutPaths(['up', 'C:\\Users\\me\\rig.yaml'])).toBe('rig up …');
    expect(showRigCommandWithoutPaths(['up', '~/specs/a.yaml'])).toBe('rig up …');
    expect(showRigCommandWithoutPaths(['edge', 'add', 'R1', 'dev.build', 'dev.review', '--kind', 'delegates_to'])).toBe('rig edge add R1 dev.build dev.review --kind delegates_to');
  });
});
