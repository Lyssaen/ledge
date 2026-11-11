import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, execForge, forgeOf, installedCli, logTail, redact } from '../src/daemon/forge/run.js';

/** A `gh` that is a Node script: it echoes its standard input, and writes its arguments to a file (never stderr, where Node
 *  itself may warn, as it does for every process when NODE_USE_ENV_PROXY is set). */
let dir: string, empty: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledge-forge-run-'));
  empty = join(dir, 'empty'); mkdirSync(empty);
  const bin = join(dir, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/usr/bin/env node\nlet s = "";\nprocess.stdin.on("data", d => (s += d)).on("end", () => { process.stdout.write(s); require("fs").writeFileSync(process.env.LEDGE_TEST_ARGS, JSON.stringify(process.argv.slice(2))); process.exit(s ? 0 : 3); });\n');
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(bin, 'glab'), '#!/usr/bin/env node\nprocess.stdout.write("x".repeat(4096));\n');
  chmodSync(join(bin, 'glab'), 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const withBin = async () => ({ ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, LEDGE_TEST_ARGS: join(dir, 'args.json') });

describe('the forge runner', () => {
  it('sends input on standard input, never as an argument', async () => {
    const body = 'a body with $(rm -rf ~) and\n--exec flags';
    const r = await execForge(withBin)('gh', ['pr', 'comment', '1', '--body-file', '-'], { input: body });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(body);
    expect(JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'))).toEqual(['pr', 'comment', '1', '--body-file', '-']);
  });

  it('closes standard input when there is no input', async () => {
    const r = await execForge(withBin)('gh', ['x']);
    expect(r.code).toBe(3);
  });

  it('answers code null when the binary is not there', async () => {
    const r = await execForge(async () => ({ ...process.env, PATH: empty }))('glab', ['api', 'version']);
    expect(r.code).toBeNull();
    expect(classify(r)).toBe('missing');
  });

  it('stops an output past its bound (4 MB in use; 1 KiB here, so the test stays light)', async () => {
    const r = await execForge(withBin, { maxOutput: 1024 })('glab', ['api', 'x']);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/output over 1024 bytes/);
  });
});

describe('installedCli', () => {
  it('finds a CLI on the PATH without running it, and only an executable one', async () => {
    const a = mkdtempSync(join(tmpdir(), 'ledge-path-a-')), b = mkdtempSync(join(tmpdir(), 'ledge-path-b-'));
    writeFileSync(join(a, 'glab'), 'not executable');
    writeFileSync(join(b, 'gh'), '#!/bin/sh\nexit 0\n'); chmodSync(join(b, 'gh'), 0o755);
    try {
      expect(await installedCli('gh', { PATH: `${a}:${b}` })).toBe(true);
      expect(await installedCli('glab', { PATH: `${a}:${b}` })).toBe(false);
      expect(await installedCli('gh', {})).toBe(false);
    } finally { rmSync(a, { recursive: true }); rmSync(b, { recursive: true }); }
  });
});

describe('classify', () => {
  it('reads the messages of gh and glab seen in Task 0', () => {
    expect(classify({ code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable' })).toBe('unauthenticated');
    // glab api exits 0 on an HTTP error: the status is in stderr.
    expect(classify({ code: 0, stderr: 'glab: 401 Unauthorized (HTTP 401)' })).toBe('unauthenticated');
    expect(classify({ code: 0, stderr: 'glab: 404 Project Not Found (HTTP 404)' })).toBe('error');
    expect(classify({ code: 1, stderr: "GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)" })).toBe('error');
    expect(classify({ code: 1, stderr: 'x error connecting to gitlab.example.invalid' })).toBe('error');
    expect(classify({ code: 1, stderr: 'API rate limit exceeded for user (HTTP 403)' })).toBe('error');
    expect(classify({ code: 0, stderr: '' })).toBe('ok');
  });
});

describe('redact', () => {
  it('removes tokens and credentials in URLs', () => {
    const t = redact('glpat-abcdefghij0123456789 ghp_abcdefghijklmnopqrstuvwxyz0123 https://user:pass@gitlab.example.com/x');
    expect(t).not.toMatch(/glpat-|ghp_|user:pass/);
    expect(t).toContain('https://[redacted]@gitlab.example.com/x');
  });
});

describe('logTail', () => {
  it('keeps the last lines, without ANSI, timestamps, debug lines nor GitLab sections', () => {
    const raw = ['2026-11-08T07:47:23.6495548Z ##[debug]Zipping', '2026-11-08T07:47:20.1Z \u001b[31;1mERROR: boom\u001b[0;m',
      '2026-11-07T07:57:52.689932Z 00O section_end:1794038272:upload\r\u001b[0K', '2026-11-07T07:57:53.077291Z 00O \u001b[31;1mERROR: Job failed: exit code 2\u001b[0;m',
      'token=ghp_abcdefghijklmnopqrstuvwxyz0123'].join('\n');
    expect(logTail(raw, 60).split('\n')).toEqual(['ERROR: boom', 'ERROR: Job failed: exit code 2', 'token=[redacted]']);
    expect(logTail(Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n'), 60).split('\n')).toHaveLength(60);
  });
});

describe('forgeOf', () => {
  it('stays what the chat had', () => {
    expect(forgeOf('git@github.com:Lyssaen/ledge.git')).toMatchObject({ cli: 'gh', host: 'github.com', path: 'Lyssaen/ledge' });
    expect(forgeOf('https://gitlab.com/a/b/c.git')).toMatchObject({ cli: 'glab', host: 'gitlab.com', path: 'a/b/c' });
    expect(forgeOf('git@github.com:o/--exec.git')).toBeNull();
  });
});
