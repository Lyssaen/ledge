import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-test-'));
// createOpenRig defaults (the home folder, ~/.ledge/rigs, ~/.openrig/daemon.json) must never read the real ones: a test that injects none sees an empty home.
const fakeHome = mkdtempSync(join(tmpdir(), 'ledge-test-home-'));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
delete process.env.OPENRIG_HOME;
