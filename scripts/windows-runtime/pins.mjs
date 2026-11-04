// What the snapshot installer carries for a Windows PC with nothing installed (spec 2026-11-03 §4.2.5), pinned: a download
// whose SHA-256 differs stops the build. The hashes are the publishers' own (nodejs.org SHASUMS256.txt, the Git for
// Windows release notes), checked against the files on 2026-11-04.
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const NODE = {
  version: '22.23.3',
  url: 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip',
  sha256: '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71',
};

export const PORTABLE_GIT = {
  version: '2.56.0.windows.4',
  url: 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/PortableGit-2.56.0.4-64-bit.7z.exe',
  sha256: 'b1f3e52216e2ed6882d1bebfd4d3fdf319bec40d2edbbf9fd26ec4fd3fce7ed1',
};

/** The runtime folder as Ledge Desktop runs it (crates/ledge-native/src/native.rs `runtime_from_dir`). */
export function layout(out) {
  return {
    node: join(out, 'node.exe'),
    ledge: join(out, 'ledge'),
    cli: join(out, 'ledge', 'dist', 'cli', 'index.js'),
    git: join(out, 'git'),
    bash: join(out, 'git', 'bin', 'bash.exe'),
    gitCmd: join(out, 'git', 'cmd'),
    version: join(out, 'VERSION'),
  };
}

/** Throws `checksum mismatch for <what>` unless `buf`'s SHA-256 is `expected`. */
export function verifySha256(buf, expected, what) {
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== expected) throw new Error(`checksum mismatch for ${what}: expected ${expected}, got ${got}`);
}
