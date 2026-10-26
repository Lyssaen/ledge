import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launcherScript, movesToLedgeTab, openInLedgeTab, profileCommandline, type LedgeTab } from '../src/tui/terminalProfile.js';

const WT = { WT_SESSION: 'a1b2', WSL_DISTRO_NAME: 'Ubuntu' };
const CLI = '/opt/ledge/dist/cli/index.js';

describe('ledge tui in a Ledge tab of Windows Terminal', () => {
  it('moves from a Windows Terminal tab of WSL, not from tmux, nor once moved, nor under pnpm dev', () => {
    expect(movesToLedgeTab(WT, false, CLI)).toBe(true);
    expect(movesToLedgeTab(WT, true, CLI)).toBe(false);
    expect(movesToLedgeTab({ ...WT, WT_PROFILE_ID: '{d10fee13-0978-595f-a851-b60ec80f11c9}' }, false, CLI)).toBe(false);
    expect(movesToLedgeTab({ ...WT, WT_PROFILE_ID: '{2c4de342-38b7-51cf-b940-2309a097f518}' }, false, CLI)).toBe(true);
    expect(movesToLedgeTab({ ...WT, TMUX: '/tmp/tmux-1000/default,1,0' }, false, CLI)).toBe(false);
    expect(movesToLedgeTab({ WSL_DISTRO_NAME: 'Ubuntu' }, false, CLI)).toBe(false);
    expect(movesToLedgeTab({ WT_SESSION: 'a1b2' }, false, CLI)).toBe(false);
    expect(movesToLedgeTab(WT, false, '/w/ledge/src/cli/index.ts')).toBe(false);
  });

  it('runs the launcher inside the distribution, a path with a space quoted, one Windows cannot carry refused', () => {
    expect(profileCommandline('Ubuntu', '/home/a/.ledge/tui.sh')).toBe('wsl.exe -d Ubuntu --cd ~ --exec /bin/sh /home/a/.ledge/tui.sh');
    expect(profileCommandline('Ubuntu-Dev', '/home/a b/.ledge/tui.sh')).toBe('wsl.exe -d Ubuntu-Dev --cd ~ --exec /bin/sh "/home/a b/.ledge/tui.sh"');
    expect(profileCommandline('Ubuntu', '/home/x"y/.ledge/tui.sh')).toBeNull();
  });

  it('has the launcher run this CLI with this node, and the Ledge folder when one is set', () => {
    expect(launcherScript('/usr/bin/node', "/opt/it's/cli.js")).toMatch(/\nexec '\/usr\/bin\/node' '\/opt\/it'\\''s\/cli.js' tui --here\n$/);
    expect(launcherScript('/usr/bin/node', CLI)).not.toContain('LEDGE_HOME');
    expect(launcherScript('/usr/bin/node', CLI, '/tmp/l')).toContain("\nexport LEDGE_HOME='/tmp/l'\nexec ");
  });

  describe('install then open', () => {
    let lad: string;
    let launcher: string;
    let opened: string[][];
    const settings = () => join(lad, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json');
    const loaded = () => { mkdirSync(join(settings(), '..'), { recursive: true }); writeFileSync(settings(), '{ "profiles": { "list": [ { "name": "Ledge", "source": "Ledge" } ] } }'); };
    const tab = (o: Partial<LedgeTab> = {}): LedgeTab => ({
      localAppData: { win: 'C:\\Users\\élise\\AppData\\Local', linux: lad }, distro: 'Ubuntu', node: '/usr/bin/node', script: CLI, launcher,
      wt: async args => { opened.push(args); }, waitMs: 300, ...o
    });
    const fragmentDir = () => join(lad, 'Microsoft', 'Windows Terminal', 'Fragments', 'Ledge');
    beforeEach(() => { lad = mkdtempSync(join(tmpdir(), 'ledge-wt-')); launcher = join(lad, 'home', '.ledge', 'tui.sh'); opened = []; });

    it('writes the launcher and the Ledge profile with the mascot as its icon, then opens a tab of it in this window', async () => {
      loaded();
      expect(await openInLedgeTab(tab())).toBe(true);
      expect(readFileSync(launcher, 'utf8')).toBe(launcherScript('/usr/bin/node', CLI));
      expect(JSON.parse(readFileSync(join(fragmentDir(), 'ledge.json'), 'utf8'))).toEqual({ profiles: [{
        name: 'Ledge',
        commandline: `wsl.exe -d Ubuntu --cd ~ --exec /bin/sh ${launcher}`,
        icon: 'C:\\Users\\élise\\AppData\\Local\\Microsoft\\Windows Terminal\\Fragments\\Ledge\\ledge.ico'
      }] });
      expect(readFileSync(join(fragmentDir(), 'ledge.ico'))).toEqual(readFileSync(join(__dirname, '..', 'assets', 'ledge.ico')));
      expect(opened).toEqual([['-w', '0', 'new-tab', '-p', 'Ledge']]);
    });

    it('keeps the profile as is when node or the CLI move, only the launcher changes', async () => {
      loaded();
      await openInLedgeTab(tab());
      const profile = readFileSync(join(fragmentDir(), 'ledge.json'), 'utf8');
      expect(await openInLedgeTab(tab({ node: '/opt/node/bin/node', script: '/w/ledge/dist/cli/index.js' }))).toBe(true);
      expect(readFileSync(join(fragmentDir(), 'ledge.json'), 'utf8')).toBe(profile);
      expect(readFileSync(launcher, 'utf8')).toBe(launcherScript('/opt/node/bin/node', '/w/ledge/dist/cli/index.js'));
    });

    it('says so and waits for Windows Terminal to read a new fragment, and stays in this tab when it does not in time', async () => {
      let waits = 0;
      setTimeout(loaded, 100);
      expect(await openInLedgeTab(tab({ onWait: () => { waits++; } }))).toBe(true);
      expect(waits).toBe(1);
      expect(await openInLedgeTab(tab({ onWait: () => { waits++; } }))).toBe(true);
      expect(waits).toBe(1);
      lad = mkdtempSync(join(tmpdir(), 'ledge-wt-'));
      expect(await openInLedgeTab(tab())).toBe(false);
      expect(existsSync(join(fragmentDir(), 'ledge.json'))).toBe(true);
      expect(opened).toHaveLength(2);
    });

    it('stays in this tab when the launcher path cannot reach Windows, and writes nothing', async () => {
      loaded();
      launcher = join(lad, 'x"y', 'tui.sh');
      expect(await openInLedgeTab(tab())).toBe(false);
      expect(existsSync(fragmentDir())).toBe(false);
      expect(existsSync(launcher)).toBe(false);
      expect(opened).toEqual([]);
    });
  });
});
