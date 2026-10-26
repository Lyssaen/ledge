import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREVIEW_MAX, type ImageUpload } from '@ledge/protocol';
import { imageInfo } from '../imageInfo.js';

/** A picture taken from the clipboard, ready to store; `bytes` is the size of the main image. */
export interface ClipboardImage { image: ImageUpload; width: number; height: number; bytes: number }

type Run = (file: string, args: string[], o: { cwd?: string; maxBuffer: number; encoding: 'buffer' }) => Promise<{ stdout: Buffer }>;

/** A hung reader (clipboard locked) is killed after this long. */
const CLIPBOARD_TIMEOUT_MS = 10_000;

const runFile: Run = (file, args, o) => new Promise((resolve, reject) => {
  execFile(file, args, { ...o, timeout: CLIPBOARD_TIMEOUT_MS }, (err, stdout) => (err ? reject(err) : resolve({ stdout })));
});

const POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
/** Room for a 400 kB picture and its preview in base64. */
const MAX_BUFFER = 4 * 1024 * 1024;
const LOCAL_MAX_BUFFER = 20 * 1024 * 1024;

/** Reads the Windows clipboard picture, scales it to 1600 px on its long side and saves it as a JPEG of at most 400 000
 *  bytes (quality 85, then 70, 55, 40), with a 480 px JPEG 70 preview; prints one JSON line, or nothing when there is no picture.
 *  One line, single quotes only: it travels as a command-line argument. */
const SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
  '$src = [System.Windows.Forms.Clipboard]::GetImage();',
  'if ($null -eq $src) { exit 0 }',
  '$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq \'image/jpeg\' };',
  'function Encode($long, $qualities, $max) {',
  '$k = [Math]::Min(1.0, $long / [Math]::Max($src.Width, $src.Height));',
  '$w = [Math]::Max(1, [int][Math]::Round($src.Width * $k)); $h = [Math]::Max(1, [int][Math]::Round($src.Height * $k));',
  '$bmp = New-Object System.Drawing.Bitmap($w, $h); $ms = $null;',
  'try {',
  '$g = [System.Drawing.Graphics]::FromImage($bmp);',
  'try { $g.Clear([System.Drawing.Color]::White); $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g.DrawImage($src, 0, 0, $w, $h) } finally { $g.Dispose() }',
  'foreach ($q in $qualities) {',
  'if ($null -ne $ms) { $ms.Dispose(); $ms = $null }',
  '$p = New-Object System.Drawing.Imaging.EncoderParameters(1);',
  'try {',
  '$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$q);',
  '$ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, $codec, $p)',
  '} finally { $p.Dispose() }',
  'if ($ms.Length -le $max) { break }',
  '}',
  'return @{ w = $w; h = $h; b = [Convert]::ToBase64String($ms.ToArray()) }',
  '} finally { if ($null -ne $ms) { $ms.Dispose() }; $bmp.Dispose() }',
  '}',
  'try {',
  '$main = Encode 1600 @(85, 70, 55, 40) 400000;',
  '$prev = Encode 480 @(70) 40000;',
  '[Console]::Out.Write((ConvertTo-Json -Compress @{ w = $main.w; h = $main.h; main = $main.b; prev = $prev.b }))',
  '} finally { $src.Dispose() }'
].join(' ');

async function fromWindows(run: Run): Promise<ClipboardImage | null> {
  const { stdout } = await run(POWERSHELL, ['-NoProfile', '-STA', '-Command', SCRIPT], { cwd: '/mnt/c', maxBuffer: MAX_BUFFER, encoding: 'buffer' });
  const line = stdout.toString('utf8').trim();
  if (!line) return null;
  const j = JSON.parse(line) as { w: number; h: number; main: string; prev?: string };
  // A preview over its cap would make the whole store refuse: no preview is better.
  const preview = j.prev && Buffer.from(j.prev, 'base64').length <= PREVIEW_MAX ? { mime: 'image/jpeg' as const, data: j.prev } : undefined;
  return { image: { mime: 'image/jpeg', data: j.main, ...(preview ? { preview } : {}) }, width: j.w, height: j.h, bytes: Buffer.from(j.main, 'base64').length };
}

/** A PNG (or other picture) from the clipboard as is: no encoder here, so no preview. */
function fromBytes(b: Buffer): ClipboardImage | null {
  const info = imageInfo(b);
  return info ? { image: { mime: info.mime, data: b.toString('base64') }, width: info.width, height: info.height, bytes: b.length } : null;
}

async function fromLinux(run: Run): Promise<ClipboardImage | null> {
  const attempts: Array<[string, string[]]> = [['wl-paste', ['--type', 'image/png']], ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']]];
  for (const [file, args] of attempts) {
    try {
      const got = fromBytes((await run(file, args, { maxBuffer: LOCAL_MAX_BUFFER, encoding: 'buffer' })).stdout);
      if (got) return got;
    } catch { /* tool missing or no picture: try the next one */ }
  }
  return null;
}

async function fromMac(run: Run): Promise<ClipboardImage | null> {
  const dir = await mkdtemp(join(tmpdir(), 'ledge-clip-'));
  const file = join(dir, 'clip.png');
  try {
    const script = `set f to open for access POSIX file "${file}" with write permission\nset eof f to 0\nwrite (the clipboard as «class PNGf») to f\nclose access f`;
    await run('osascript', ['-e', script], { maxBuffer: MAX_BUFFER, encoding: 'buffer' });
    return fromBytes(await readFile(file));
  } catch { return null; }
  finally { await rm(dir, { recursive: true, force: true }); }
}

/** The picture on the clipboard, or null when there is none (or the platform's tool is missing). Never throws. */
export async function readClipboardImage(env: NodeJS.ProcessEnv = process.env, run: Run = runFile, platform: NodeJS.Platform = process.platform): Promise<ClipboardImage | null> {
  try {
    if (platform === 'darwin') return await fromMac(run);
    return env.WSL_DISTRO_NAME ? await fromWindows(run) : await fromLinux(run);
  } catch { return null; }
}
