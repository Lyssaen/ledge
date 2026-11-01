import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_TABS, MODAL_KINDS, PLACE_KINDS, SECTIONS } from '../src/nav/state';

// The chat's ledge.md starts with this guide: every screen the app declares has its section, named by its id.
const guide = readFileSync(resolve(__dirname, '../../../docs/ledge-guide.md'), 'utf8');

describe('the Ledge guide', () => {
  it.each([...PLACE_KINDS, ...HOME_TABS, ...SECTIONS, ...MODAL_KINDS])('describes the desktop screen %s', id => {
    expect(guide).toMatch(new RegExp(`^#+ .*\\(\`${id}\`\\)$`, 'm'));
  });
});
