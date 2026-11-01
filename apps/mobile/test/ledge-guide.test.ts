import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_NAMES } from '../src/router';

// The chat's ledge.md starts with this guide: every route of the phone app has its section, named by its id.
const guide = readFileSync(resolve(__dirname, '../../../docs/ledge-guide.md'), 'utf8');

describe('the Ledge guide', () => {
  it.each(ROUTE_NAMES)('describes the phone screen %s', id => {
    expect(guide).toMatch(new RegExp(`^#+ .*\\(\`${id}\`\\)$`, 'm'));
  });
});
