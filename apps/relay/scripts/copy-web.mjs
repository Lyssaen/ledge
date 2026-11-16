#!/usr/bin/env node
// Puts the phone build into the relay package (apps/relay/web/), which `ledge-relay launch` serves.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../mobile/dist');
const dest = resolve(here, '../web');

if (!existsSync(join(src, 'build.json'))) {
  console.error('copy-web: apps/mobile/dist/build.json is missing: build @ledge/mobile first');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
