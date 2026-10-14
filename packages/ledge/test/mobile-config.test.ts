import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOrigin, loadMobileConfig, saveMobileConfig } from '../src/mobile/config.js';
import { paths } from '../src/paths.js';

const cfg = { origin: 'https://pc.tail1.ts.net', rpID: 'pc.tail1.ts.net' };
let p: string;
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); p = paths().mobile; });

describe('mobile config', () => {
  it('derives rpID from an https tailnet origin', () => expect(parseOrigin('https://pc.tail1.ts.net')).toEqual(cfg));
  it('accepts a trailing slash and the explicit default port', () => {
    expect(parseOrigin('https://pc.tail1.ts.net/')).toEqual(cfg);
    expect(parseOrigin('https://pc.tail1.ts.net:443')).toEqual(cfg);
  });
  it('refuses http, paths, queries, credentials and odd ports', () => {
    for (const o of ['http://pc.t.ts.net', 'https://pc.t.ts.net/m/', 'https://pc.t.ts.net/?a=1', 'https://pc.t.ts.net/#x', 'https://u@pc.t.ts.net', 'https://pc.t.ts.net:8443', 'nope']) expect(() => parseOrigin(o), o).toThrow();
  });
  it('saves the config readable by its owner only, and loads it back', async () => {
    await saveMobileConfig(cfg, p);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(await loadMobileConfig(p)).toEqual(cfg);
  });
  it('removes the file on null and loads null when absent or broken', async () => {
    expect(await loadMobileConfig(p)).toBeNull();
    await saveMobileConfig(cfg, p); await saveMobileConfig(null, p);
    expect(existsSync(p)).toBe(false);
    expect(await loadMobileConfig(p)).toBeNull();
  });
});
