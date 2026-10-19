import { describe, expect, it } from 'vitest';
import { ptyBackend } from '../src/term/backend';

describe('ptyBackend', () => {
  it('no backend in the browser build', () => { expect(ptyBackend()).toBeNull(); });
});
