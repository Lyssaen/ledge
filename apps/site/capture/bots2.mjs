import { createRequire } from 'node:module';
const [S, pw] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pw);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 4, reducedMotion: 'reduce' });
await p.goto('http://127.0.0.1:5891/mascots-logos.html'); await p.waitForTimeout(1500);
await p.addStyleTag({ content: 'html,body,body *:not(svg):not(svg *){background:transparent!important;border-color:transparent!important;box-shadow:none!important;color:transparent!important}' });
const shoot = async (sel, name, pad) => {
  const el = p.locator(sel).first(); if (!(await el.count())) { console.log('missing', sel); return; }
  await el.scrollIntoViewIfNeeded(); const r = await el.boundingBox();
  await p.screenshot({ path: `${S}/shots/bots/${name}.png`, omitBackground: true, clip: { x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad } });
  console.log(name, Math.round(r.width), Math.round(r.height));
};
for (const t of ['claude', 'codex', 'cursor', 'omp']) await shoot(`svg.bot:not(.legacy-bot)[data-tool="${t}"][data-state="working"][data-detailed="true"]`, `bot-${t}`, 14);
for (const s of ['approval', 'question', 'working', 'idle']) await shoot(`svg.bot:not(.legacy-bot)[data-tool="claude"][data-state="${s}"][data-detailed="true"] >> nth=${s === 'working' ? 1 : 0}`, `state-${s}`, 10);
console.log('resident', await p.locator('.resident').count());
await shoot('.resident', 'resident', 10);
await b.close();
