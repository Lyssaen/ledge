import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Locator, Page } from '@playwright/test';

// Shared by the temporary video specs (desktop and overlay): a fake pointer, smooth mouse moves, a CDP screencast assembled by ffmpeg.
/** Where the videos and stills go: ZZ_OUT (the run scripts set it to shots/en/ with ZZ_LANG=en), the French folder otherwise. */
export const VIDEO = process.env.ZZ_OUT ?? `${process.env.SITE_CAPTURE_OUT ?? '/tmp/ledge-site-capture'}/video/`;
// ZZ_LANG=en: the app and every fixture text in English (the French story otherwise).
export const EN = process.env.ZZ_LANG === 'en';
export const L = <T,>(fr: T, en: T): T => (EN ? en : fr);

const FFMPEG = '/usr/bin/ffmpeg';

/** A white arrow with a dark outline that follows `mousemove`, and a ripple on each press. Register before `page.goto`. */
export async function installCursor(page: Page, at: { x: number; y: number; /** The pointer's size, 1 by default (2 on a page zoomed twice). */ k?: number }): Promise<void> {
  await page.addInitScript(start => {
    const boot = () => {
      if (document.getElementById('zz-cursor')) return;
      const c = document.createElement('div');
      c.id = 'zz-cursor';
      c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:24px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))';
      const k = start.k ?? 1;
      c.style.transformOrigin = '0 0';
      c.style.transform = `translate(${start.x}px,${start.y}px) scale(${k})`;
      c.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="24" viewBox="0 0 22 24"><path d="M2 1.5 L2 18.5 L6.6 14.4 L9.7 21.6 L12.6 20.3 L9.5 13.3 L15.6 13.3 Z" fill="#fff" stroke="#141414" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      const place = (e: MouseEvent) => { c.style.transform = `translate(${e.clientX - 2 * k}px,${e.clientY - 1.5 * k}px) scale(${k})`; };
      window.addEventListener('mousemove', place, true);
      window.addEventListener('mousedown', e => {
        place(e);
        const r = document.createElement('div');
        r.style.cssText = `position:fixed;left:${e.clientX - 16 * k}px;top:${e.clientY - 16 * k}px;width:${32 * k}px;height:${32 * k}px;border-radius:50%;border:2px solid rgba(255,255,255,.9);background:rgba(255,255,255,.18);z-index:2147483646;pointer-events:none`;
        document.documentElement.appendChild(r);
        r.animate([{ transform: 'scale(.25)', opacity: 1 }, { transform: 'scale(1.25)', opacity: 0 }], { duration: 480, easing: 'ease-out' }).onfinish = () => r.remove();
      }, true);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }, at);
}

/** The mouse, moved smoothly (ease in-out) so the fake pointer glides. */
export class Pointer {
  constructor(private page: Page, public x: number, public y: number) {}
  async park(): Promise<void> { await this.page.mouse.move(this.x, this.y); }
  async to(x: number, y: number, ms = 750): Promise<void> {
    // By the clock, not by a step count: a page that is slow to answer a move (a blurred modal) still gets there in `ms`.
    const x0 = this.x, y0 = this.y, t0 = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - t0) / ms), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
      if (t >= 1) break;
      await this.page.waitForTimeout(10);
    }
    this.x = x; this.y = y;
  }
  async over(l: Locator, ms = 750): Promise<void> { const b = (await l.boundingBox())!; await this.to(b.x + b.width / 2, b.y + b.height / 2, ms); }
  async click(l: Locator, ms = 750): Promise<void> {
    await this.over(l, ms);
    await this.page.waitForTimeout(220);
    await this.page.mouse.down(); await this.page.waitForTimeout(90); await this.page.mouse.up();
  }
}

/** Starts a CDP screencast of the page; the returned function stops it and writes `<name>.mp4` (H.264, 30 fps, at most 1920 px wide)
 *  and `<name>-poster.png` (its first frame). Frames come only when the page changes: each is held until the next one's timestamp. */
export async function record(page: Page, name: string, o: { crf?: number; maxWidth?: number; /** A crop of each frame, in device pixels. */ crop?: { x: number; y: number; w: number; h: number } } = {}): Promise<() => Promise<void>> {
  const dir = `${VIDEO}.frames-${name}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  cdp.on('Page.screencastFrame', f => {
    const file = `${dir}/${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
  return async () => {
    await page.waitForTimeout(120);
    const end = Date.now() / 1000;
    await cdp.send('Page.stopScreencast').catch(() => {});
    await page.waitForTimeout(200);
    const lines: string[] = [];
    frames.forEach((f, i) => {
      const next = frames[i + 1]?.t ?? Math.max(f.t + 0.04, Math.min(end, f.t + 2));
      lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
    });
    lines.push(`file '${frames[frames.length - 1]!.file}'`);
    writeFileSync(`${dir}/list.txt`, lines.join('\n'));
    const w = o.maxWidth ?? 1920;
    const scale = `${o.crop ? `crop=${o.crop.w}:${o.crop.h}:${o.crop.x}:${o.crop.y},` : ''}scale='min(${w},iw)':-2:flags=lanczos`;
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', `fps=30,${scale}`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf ?? 18), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', `${VIDEO}${name}.mp4`]);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', frames[0]!.file, '-vf', scale, '-frames:v', '1', `${VIDEO}${name}-poster.png`]);
    console.log(`${name}: ${frames.length} frames over ${(end - frames[0]!.t).toFixed(1)} s`);
    // Captured frames per 2 s of the story: where the page was slow to draw.
    const per: number[] = []; for (const f of frames) { const i = Math.floor((f.t - frames[0]!.t) / 2); per[i] = (per[i] ?? 0) + 1; }
    console.log(`${name}: frames per 2 s: ${Array.from(per, n => n ?? 0).join(' ')}`);
    rmSync(dir, { recursive: true, force: true });
  };
}
