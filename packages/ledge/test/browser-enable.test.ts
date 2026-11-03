import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enableLive, playwrightConfigPath } from '../src/daemon/browser/enable.js';

describe('enableLive: « Activer le direct… », the one line Ledge adds to the Playwright config', () => {
  let home: string, config: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ledge-enable-'));
    mkdirSync(join(home, '.claude'));
    config = join(home, '.config', 'playwright-mcp', 'config.json');
  });
  const settings = (env: Record<string, unknown> | undefined) => writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', ...(env ? { env } : {}) }, null, 2));
  const read = () => JSON.parse(readFileSync(config, 'utf8'));

  it('Claude Code loads no Playwright config: refused, nothing written', async () => {
    expect(await enableLive('r', home)).toEqual({ type: 'browser.enabled', rid: 'r', outcome: 'refused', reason: 'not_configured' });
    settings({ OTHER: '1' });
    expect(await enableLive('r', home)).toMatchObject({ outcome: 'refused', reason: 'not_configured' });
    settings({ PLAYWRIGHT_MCP_CONFIG: 'relative/config.json' });
    expect(await playwrightConfigPath(home)).toBeNull();
  });

  it('adds the line to the config Guillaume has, keeping the rest and its one-line form', async () => {
    settings({ PLAYWRIGHT_MCP_CONFIG: '~/.config/playwright-mcp/config.json' });
    mkdirSync(join(home, '.config', 'playwright-mcp'), { recursive: true });
    writeFileSync(config, '{"browser":{"launchOptions":{"args":["--disable-software-rasterizer"]}}}');
    expect(await enableLive('r', home)).toEqual({ type: 'browser.enabled', rid: 'r', outcome: 'enabled', path: config });
    expect(readFileSync(config, 'utf8')).toBe('{"browser":{"launchOptions":{"args":["--disable-software-rasterizer","--remote-debugging-port=0"]}}}\n');
    // Twice: already there.
    expect(await enableLive('r2', home)).toEqual({ type: 'browser.enabled', rid: 'r2', outcome: 'already', path: config });
    expect(read().browser.launchOptions.args).toEqual(['--disable-software-rasterizer', '--remote-debugging-port=0']);
  });

  it('every other setting stays as it was; a missing file is made with the line alone; a port set by hand counts', async () => {
    settings({ PLAYWRIGHT_MCP_CONFIG: config });
    expect(await enableLive('r', home)).toMatchObject({ outcome: 'enabled' });
    expect(read()).toEqual({ browser: { launchOptions: { args: ['--remote-debugging-port=0'] } } });
    writeFileSync(config, JSON.stringify({ capabilities: ['vision'], browser: { browserName: 'chromium', userDataDir: '/p', launchOptions: { headless: true, channel: 'chrome' } }, server: { port: 1 } }, null, 2));
    expect(await enableLive('r', home)).toMatchObject({ outcome: 'enabled' });
    expect(read()).toEqual({ capabilities: ['vision'], browser: { browserName: 'chromium', userDataDir: '/p', launchOptions: { headless: true, channel: 'chrome', args: ['--remote-debugging-port=0'] } }, server: { port: 1 } });
    writeFileSync(config, JSON.stringify({ browser: { launchOptions: { args: ['--remote-debugging-port=9333'] } } }));
    expect(await enableLive('r', home)).toMatchObject({ outcome: 'already' });
  });

  it('a file it cannot add to is left untouched', async () => {
    settings({ PLAYWRIGHT_MCP_CONFIG: config });
    mkdirSync(join(home, '.config', 'playwright-mcp'), { recursive: true });
    for (const bad of ['{not json', '[]', '{"browser":[]}', '{"browser":{"launchOptions":"x"}}', '{"browser":{"launchOptions":{"args":"--x"}}}', '{"browser":{"launchOptions":{"args":[1]}}}']) {
      writeFileSync(config, bad);
      expect(await enableLive('r', home)).toEqual({ type: 'browser.enabled', rid: 'r', outcome: 'refused', reason: 'invalid_config', path: config });
      expect(readFileSync(config, 'utf8')).toBe(bad);
    }
  });

  it('a config kept elsewhere behind a link: the file it points to changes, the link stays', async () => {
    const real = join(home, 'dotfiles', 'playwright.json');
    mkdirSync(join(home, 'dotfiles')); mkdirSync(join(home, '.config', 'playwright-mcp'), { recursive: true });
    writeFileSync(real, '{}');
    symlinkSync(real, config);
    settings({ PLAYWRIGHT_MCP_CONFIG: config });
    expect(await enableLive('r', home)).toMatchObject({ outcome: 'enabled' });
    expect(lstatSync(config).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf8'))).toEqual({ browser: { launchOptions: { args: ['--remote-debugging-port=0'] } } });
  });
});
