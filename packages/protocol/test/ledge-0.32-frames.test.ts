import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseServerMessage } from '../src/index.js';

// Frames a Ledge 0.32 daemon sends, frozen. A change to the team or task schemas that refuses one makes every 0.32 remote
// (legion) unreadable here: the SSH link drops and loops. Team and task schemas only gain optional fields.
const dir = join(import.meta.dirname, 'fixtures', 'ledge-0.32');
const files = readdirSync(dir).filter(f => f.endsWith('.json'));

describe('frozen Ledge 0.32 server frames', () => {
  it('has the six frames of the team and task wire', () => {
    expect(files.sort()).toEqual(['chat.history.json', 'definitions.listing.json', 'roles.listing.json', 'task.updated.json', 'team.updated.json', 'teams.json']);
  });
  for (const f of files) {
    it(`${f} is accepted by parseServerMessage`, () => {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      expect(parseServerMessage(raw).type).toBe(raw.type);
    });
  }
});
