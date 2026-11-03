import { describe, expect, it } from 'vitest';
import { PROTOCOL_PORT } from '@ledge/protocol';
import { ledgePort } from '../src/port.js';

describe('ledgePort', () => {
  it('takes LEDGE_PORT when valid, else the protocol port', () => {
    expect(ledgePort({ LEDGE_PORT: '47832' })).toBe(47832);
    for (const bad of [undefined, '', 'x', '0', '70000', '1.5']) expect(ledgePort({ LEDGE_PORT: bad })).toBe(PROTOCOL_PORT);
  });
});
