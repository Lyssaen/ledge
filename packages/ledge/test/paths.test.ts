import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths, ensureLedgeDir } from '../src/paths.js';
import { log } from '../src/log.js';

describe('paths', () => {
  beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); });
  it('derives every file from LEDGE_HOME', () => {
    const p = paths();
    expect(p.tmuxConf).toBe(join(process.env.LEDGE_HOME!, 'tmux.conf'));
    expect(p.journal.endsWith('sessions.json')).toBe(true);
  });
  it('writes set-titles into a conf that predates it', async () => {
    await mkdir(paths().dir, { recursive: true }); await writeFile(paths().tmuxConf, 'set -g status off\n');
    await ensureLedgeDir();
    const conf = await readFile(paths().tmuxConf, 'utf8');
    expect(conf).toContain('set -g set-titles on'); expect(conf).toContain('set-titles-string "#{@ledge_title}"');
    await ensureLedgeDir(); expect((await readFile(paths().tmuxConf, 'utf8')).match(/set-titles on/g)).toHaveLength(1);
  });
  it('creates the dir and a tmux.conf with status off and mouse on', async () => {
    await ensureLedgeDir();
    const conf = readFileSync(paths().tmuxConf, 'utf8');
    expect(conf).toContain('set -g status off');
    expect(conf).toContain('set -g mouse on');
  });
  it('log appends a timestamped line and never throws', async () => {
    await ensureLedgeDir();
    log('hello');
    log('world');
    const txt = readFileSync(paths().log, 'utf8').trim().split('\n');
    expect(txt.length).toBe(2);
    expect(txt[1]).toMatch(/^\d{4}-\d{2}-\d{2}T.* \| world$/);
    process.env.LEDGE_HOME = '/nonexistent/dir/for/ledge';
    expect(() => log('nope')).not.toThrow();
    expect(existsSync('/nonexistent/dir/for/ledge')).toBe(false);
  });
});
