import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-test-'));
