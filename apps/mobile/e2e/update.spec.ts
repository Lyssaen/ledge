// The pinned service worker in Chromium, served by the real relay (dev mode) from a web dir swapped from v1 to v2.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { formatFingerprint, shortFingerprint } from '../src/sw/fingerprint';
import type { BuildInfo } from '../src/sw/types';

test.skip(({ browserName }) => browserName !== 'chromium', 'The update flow runs in Chromium');

const MOBILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REPO = path.resolve(MOBILE, '../..');
const bin = (name: string) => path.join(MOBILE, 'node_modules/.bin', name);

let work: string;
let relay: ChildProcess | undefined;
let port: number;
const web = () => path.join(work, 'web');
let builds: { v1: BuildInfo; v2: BuildInfo };

/** The app and its worker built into `out`, and its build.json read back. */
function finish(out: string): BuildInfo {
  execFileSync(bin('vite'), ['build', '--config', 'vite.sw.config.ts', '--outDir', out, '--logLevel', 'warn'], { cwd: MOBILE });
  execFileSync(process.execPath, ['scripts/fingerprint.mjs', out], { cwd: MOBILE });
  return JSON.parse(readFileSync(path.join(out, 'build.json'), 'utf8')) as BuildInfo;
}

function serve(version: 'v1' | 'v2') {
  rmSync(web(), { recursive: true, force: true });
  cpSync(path.join(work, version), web(), { recursive: true });
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => resolve(typeof a === 'object' && a ? a.port : 0)); });
});

test.beforeAll(async () => {
  test.setTimeout(120_000);
  work = mkdtempSync(path.join(tmpdir(), 'ledge-update-'));
  const v1 = path.join(work, 'v1');
  const v2 = path.join(work, 'v2');
  execFileSync(bin('vite'), ['build', '--outDir', v1, '--emptyOutDir', '--logLevel', 'warn'], { cwd: MOBILE });
  const built1 = finish(v1);
  // v2: the same app with one text changed, its worker and fingerprint made again.
  cpSync(v1, v2, { recursive: true });
  const index = path.join(v2, 'index.html');
  writeFileSync(index, readFileSync(index, 'utf8').replace('<title>Ledge</title>', '<title>Ledge v2</title>'));
  builds = { v1: built1, v2: finish(v2) };
  serve('v1');

  port = await freePort();
  relay = spawn(path.join(REPO, 'node_modules/.bin/tsx'), ['src/main.ts'], {
    cwd: path.join(REPO, 'apps/relay'),
    env: { ...process.env, PORT: String(port), LEDGE_RELAY_WEB_DIR: web(), LEDGE_RELAY_DEV_TOKENS: '{"t":{"accountId":"A","peer":"pc"}}' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise<void>((resolve, reject) => {
    relay!.on('exit', (code) => reject(new Error(`the relay exited (${code})`)));
    relay!.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('"listening"')) resolve(); });
  });
});

test.afterAll(() => {
  relay?.kill();
  if (work) rmSync(work, { recursive: true, force: true });
});

test('a new build waits for consent: « Plus tard » keeps v1 across a reload, « Mettre à jour » moves to v2', async ({ page }) => {
  expect(builds.v2.fingerprint).not.toBe(builds.v1.fingerprint);
  const sheet = page.getByRole('dialog', { name: `Nouvelle version · ${builds.v2.version}` });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page).toHaveTitle('Ledge');

  serve('v2');
  await page.reload();
  await expect(sheet).toBeVisible();
  await expect(page).toHaveTitle('Ledge');
  await expect(sheet.getByText(formatFingerprint(builds.v2.fingerprint))).toBeVisible();
  await expect(sheet).toContainText(`Actuelle : ${builds.v1.version} · ${shortFingerprint(builds.v1.fingerprint)}`);
  await expect(sheet.getByRole('link', { name: `Comparer avec la release v${builds.v2.version} sur GitHub` }))
    .toHaveAttribute('href', `https://github.com/Lyssaen/ledge/releases/tag/v${builds.v2.version}`);

  await sheet.getByRole('button', { name: 'Plus tard' }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expect(page).toHaveTitle('Ledge');
  await expect(sheet).toBeVisible();

  await sheet.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(page).toHaveTitle('Ledge v2');
  await expect(sheet).toBeHidden();
});
