// TEMPORARY: a short real video of the phone app for the marketing site. Deleted from the repo after the run.
import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { ChatPoint, PhoneChatTurn, PhoneClientMessage, PhoneHarnessUsage, PhoneProject, PhoneServerMessage, PhoneSession, PointItem, ThreadItem } from '@ledge/protocol';
import { copyFor } from '../src/copy';
const copy = copyFor('en');
import { forgeState, mr, pr } from '../test/model/forge-fixtures';
import { goal, kernelGraph, ledgeGraph, openrig, routing } from '../test/model/openrig-fixtures';
import { createDeviceCheck } from '../test/fakePc';
import { startHarness, type Harness } from './harness';

const OUT = `${process.env.SITE_CAPTURE_OUT ?? '/tmp/ledge-site-capture'}/shots/en`;
const FRAMES = `${OUT}/frames`;
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const { defaultBrowserType: _p, ...iPhone13 } = devices['iPhone 13'];
test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');

const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const monday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.toISOString(); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const projects: PhoneProject[] = [{ id: 'ledge', name: 'Ledge', color: 'blue' }, { id: 'website', name: 'Website', color: 'green' }];
const s = (id: string, name: string, extra: Partial<PhoneSession>): PhoneSession => ({
  id, name, tool: 'claude', project: 'ledge', projectId: 'ledge', repo: 'ledge', title: `${name} · ledge`, state: 'working', helpers: [],
  startedAt: at(-95), lastActivityAt: at(-1), unread: false, model: 'claude-opus-5-5', effort: 'high',
  context: { used: 74_000, window: 200_000, at: at(0) }, ...extra
} as PhoneSession);
const web = { project: 'website', projectId: 'website', repo: 'website' };

const sessions = (): PhoneSession[] => [
  s('otto', 'Otto', { state: 'waiting_permission', topic: 'Prepare 0.58', branch: 'release/0.58.0', unread: true, lastActivityAt: at(-2),
    pending: { key: 'h1', kind: 'permission', tool: 'Bash', text: 'git push origin main', source: 'hook', risk: 'high', riskReason: 'pushes' } }),
  s('nova', 'Nova', { state: 'waiting_permission', topic: 'SSH reconnect', branch: 'fix/ssh-reconnect', unread: true, lastActivityAt: at(-4), context: { used: 121_000, window: 200_000, at: at(0) },
    pending: { key: 'p1', kind: 'permission', tool: 'Bash', text: 'pnpm --filter @ledge/desktop test', source: 'hook', risk: 'low', riskReason: 'read_only_command' } }),
  s('luna', 'Luna', { ...web, title: 'Luna · website', state: 'waiting_input', topic: 'Homepage', branch: 'feat/homepage', unread: true, lastActivityAt: at(-6), model: 'fable',
    pending: { key: 'q1', kind: 'question', text: 'Which banner should the homepage keep?', source: 'hook', risk: 'low', riskReason: 'question',
      options: ['The old one, shortened', 'The new one, with the screenshot', 'Both, as an A/B test'] } }),
  s('bix', 'Bix', { state: 'working', topic: 'Paginate /invoices', branch: 'feat/invoices-pagination', lastActivityAt: at(0), context: { used: 92_000, window: 200_000, at: at(0) },
    doing: { tool: 'Bash', label: 'pnpm --filter api test', since: at(-1) } }),
  s('mira', 'Mira', { ...web, title: 'Mira · website', tool: 'codex', state: 'working', topic: 'Mobile layout', branch: 'fix/mobile-layout', model: undefined, effort: undefined, context: undefined, lastActivityAt: at(0),
    doing: { tool: 'Edit', label: 'src/components/Hero.astro', since: at(0) } }),
  s('pim', 'Pim', { state: 'idle', topic: 'Document the protocol', branch: 'docs/protocol', lastActivityAt: at(-18), context: { used: 31_000, window: 200_000, at: at(0) } }),
  s('rio', 'Rio', { ...web, title: 'Rio · website', state: 'idle', topic: 'Accessibility', branch: 'feat/accessibility', lastActivityAt: at(-42), model: 'fable' })
];

const threads = (): Record<string, ThreadItem[]> => ({
  // A working session: its field is off, so the app's quick-instruction chips (French only in 0.60) do not show.
  bix: [
    { kind: 'prompt', id: 'b1', at: at(-26), turn: 1, text: 'Add cursor pagination to GET /invoices, 50 per page.' },
    { kind: 'tool', id: 'b2', at: at(-25), turn: 1, tool: 'Read', label: 'src/routes/invoices.ts', status: 'success', durationMs: 300, files: [] },
    { kind: 'tool', id: 'b3', at: at(-22), turn: 1, tool: 'Edit', label: 'src/routes/invoices.ts', status: 'success', durationMs: 900, files: [{ path: 'src/routes/invoices.ts', change: 'edit' }] },
    { kind: 'reply', id: 'b4', at: at(-19), turn: 1, text: 'The route now takes `cursor` and `limit` and returns `nextCursor`.\n\n- 50 rows per page, 200 at most\n- the cursor is the last invoice id\n\nThe tests are still to write.' },
    { kind: 'prompt', id: 'b5', at: at(-12), turn: 2, text: 'Write the tests, then check the types.' },
    { kind: 'tool', id: 'b6', at: at(-9), turn: 2, tool: 'Write', label: 'test/invoices.pagination.test.ts', status: 'success', durationMs: 600, files: [{ path: 'test/invoices.pagination.test.ts', change: 'add' }] },
    { kind: 'tool', id: 'b7', at: at(-1), turn: 2, tool: 'Bash', label: 'pnpm --filter api test', status: 'running', files: [] }
  ],
  pim: [
    { kind: 'prompt', id: 'p1', at: at(-41), turn: 1, text: 'Document the phone protocol: the messages, in the order they arrive.' },
    { kind: 'tool', id: 'p2', at: at(-40), turn: 1, tool: 'Read', label: 'packages/protocol/src/phone.ts', status: 'success', durationMs: 300, files: [] },
    { kind: 'tool', id: 'p3', at: at(-36), turn: 1, tool: 'Write', label: 'docs/protocol.md', status: 'success', durationMs: 900, files: [{ path: 'docs/protocol.md', change: 'add' }] },
    { kind: 'reply', id: 'p4', at: at(-33), turn: 1, text: 'I wrote `docs/protocol.md`: pairing, the first state, then every message with an example.\n\n- 14 messages from the phone to the PC\n- 22 messages from the PC to the phone\n\nThe refusal codes are still missing.' },
    { kind: 'prompt', id: 'p5', at: at(-24), turn: 2, text: 'Add the refusal codes, with what the phone shows for each.' },
    { kind: 'tool', id: 'p6', at: at(-22), turn: 2, tool: 'Edit', label: 'docs/protocol.md', status: 'success', durationMs: 700, files: [{ path: 'docs/protocol.md', change: 'edit' }] },
    { kind: 'reply', id: 'p7', at: at(-18), turn: 2, text: 'Done: a table of the 9 refusal codes, each with its on-screen message. Shall I open the PR?' }
  ]
});

const usage: PhoneHarnessUsage[] = [{
  harness: 'claude', status: 'ok', readAt: at(-1),
  windows: [{ kind: 'five_hour', pct: 64, resetsAt: at(60) }, { kind: 'seven_day', pct: 58, resetsAt: monday() }, { kind: 'model', model: 'Opus', pct: 41, resetsAt: monday() }, { kind: 'model', model: 'Fable', pct: 20, resetsAt: monday() }]
}];

const ANSWER = 'Bix is finishing the /invoices pagination: all 14 tests pass and it is checking the types. Nothing is waiting on you.';
const POINT_QID = '7c0f3f0e-6f0a-4c56-9d1e-2b7a54c1a001';
const row = (id: string, event: number, extra: Partial<PointItem> & Pick<PointItem, 'group' | 'tone' | 'who' | 'text'>): PointItem => ({ id, event, at: at(-3), ...extra });
/** The point Ledge posted on its own a few minutes ago, as the daemon builds it (packages/ledge/src/operator/point.ts). */
const point = (): ChatPoint => ({
  since: at(-45), lead: '7 things since 21:10 · 3 waiting for you', leadBy: 'daemon',
  items: [
    row('session:luna', 1, { group: 'atoi', tone: 'ask', who: 'Luna', text: 'Which banner should the homepage keep?', ref: { kind: 'session.request', session: 'luna', key: 'q1' }, freeText: true,
      answers: [{ id: '0', label: 'The old one, shortened', style: 'plain' }, { id: '1', label: 'The new one, with the screenshot', style: 'plain' }, { id: '2', label: 'Both, as an A/B test', style: 'plain' }] }),
    row('session:nova', 2, { group: 'atoi', tone: 'perm', who: 'Nova', text: 'pnpm --filter @ledge/desktop test', ref: { kind: 'session.request', session: 'nova', key: 'p1' },
      answers: [{ id: 'deny', label: 'Deny', style: 'plain' }, { id: 'accept', label: 'Allow', style: 'primary' }] }),
    row('session:otto', 3, { group: 'atoi', tone: 'perm', who: 'Otto', text: 'git push origin main', ref: { kind: 'session.request', session: 'otto', key: 'h1' },
      answers: [{ id: 'deny', label: 'Deny', style: 'plain' }, { id: 'accept', label: 'Allow', style: 'primary' }] }),
    row('session:pim', 4, { group: 'done', tone: 'idle', who: 'Pim', text: 'finished', sub: 'Done: a table of the 9 refusal codes.' }),
    row('pr:222', 5, { group: 'done', tone: 'idle', who: 'Seat terminal', text: 'capture and copy', sub: '#222 merged' }),
    row('task:t1', 6, { group: 'ongoing', tone: 'work', who: 'Bix', text: 'Paginate /invoices', sub: 'task in progress' }),
    row('task:t2', 7, { group: 'ongoing', tone: 'work', who: 'Mira', text: 'Mobile layout', sub: 'task in progress' }),
    row('rig:ledge-dev', 8, { group: 'rigs', tone: 'ask', who: 'Max', rig: 'ledge-dev', text: 'suggests handing the redesign to ledge-dev' })
  ]
});
const pointTurn = (p: ChatPoint): PhoneChatTurn => ({ qid: POINT_QID, question: '', askedAt: at(-3), answeredAt: at(-3), steps: [], by: 'ledge', point: p });

async function world(): Promise<Harness> {
  const h = await startHarness();
  const d = h.daemon;
  d.device = createDeviceCheck(h.url);
  Object.assign(d, { sessions: sessions(), projects, chat: true, terminal: true, sessionClose: true, usage, threads: threads(), turns: [pointTurn(point())] });
  const open = pr({ sessions: ['otto'], title: 'Batch 9: detached windows', updatedAt: at(-12) });
  const failed = mr({ sessions: ['luna'], title: 'Homepage: new banner', branch: 'feat/homepage', repo: 'team/website', id: 'gitlab.acme.dev/team/website#41', url: 'https://gitlab.acme.dev/team/website/-/merge_requests/41', pipeline: 'run', updatedAt: at(-50) });
  d.forge = { state: forgeState({ prs: [failed, open], followed: [] }), details: {}, logs: {} };

  const raw = h.pc.send.bind(h.pc);
  h.pc.send = async (m: PhoneServerMessage) => {
    if (m.type === 'snapshot') return raw({ ...m, daemon: { ...m.daemon, launch: true, models: true, projectFolders: true }, ...(m.device ? { device: { ...m.device, recover: true as const } } : {}) });
    // The chat as a real PC paces it: a step, a second one, then the text growing, then the card.
    if (m.type === 'chat.step') { await sleep(450); return raw(m.step.kind === 'pane' ? { ...m, step: { kind: 'pane', id: 'bix', name: 'Bix' } } : m); }
    if (m.type === 'chat.delta') return;
    if (m.type === 'chat.done' && m.turn.relay && !m.turn.relay.status) {
      await sleep(450);
      const words = ANSWER.split(' ');
      for (let i = 3; i <= words.length + 2; i += 3) { await raw({ type: 'chat.delta', qid: m.qid, text: words.slice(0, i).join(' ') }); await sleep(110); }
      const { proposals: _none, ...turn } = m.turn;
      return raw({ ...m, turn: { ...turn, answer: ANSWER, steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'bix', name: 'Bix' }], relay: { ...m.turn.relay, id: 'bix', name: 'Bix', text: 'Open the PR once the types pass.' } } });
    }
    return raw(m);
  };
  // What the harness's daemon leaves unanswered: a question answered with one of its options, and the point's rows.
  const settle = async (id: string, answer: string) => {
    d.turns = d.turns.map(x => (x.qid === POINT_QID && x.point ? { ...x, point: { ...x.point, items: x.point.items.map(i => (i.id === id && !i.settled ? { ...i, settled: { at: new Date().toISOString(), where: 'phone' as const, answer } } : i)) } } : x));
    await raw({ type: 'chat.history', turns: d.turns });
  };
  const back = (id: string): PhoneSession | undefined => {
    const was = d.sessions.find(x => x.id === id);
    if (!was) return undefined;
    const { pending: _answered, ...rest } = was;
    const after: PhoneSession = { ...rest, state: 'working', unread: false, lastActivityAt: new Date().toISOString() };
    d.sessions = d.sessions.map(x => (x.id === id ? after : x));
    return after;
  };
  let seen = 0;
  const timer = setInterval(() => {
    while (seen < h.pc.received.length) {
      const m = JSON.parse(h.pc.received[seen++]!) as PhoneClientMessage;
      if (m.type === 'session.reply') {
        const after = back(m.id);
        if (!after) continue;
        void (async () => {
          await sleep(350);
          await raw({ type: 'operation.result', op: m.op, status: 'applied' });
          await raw({ type: 'session.updated', session: after });
          await settle(`session:${m.id}`, 'The new one, with the screenshot');
        })().catch(() => {});
      }
      // The harness's own daemon applies the decision; the point's row follows it.
      if (m.type === 'session.decide') void (async () => { await sleep(400); await settle(`session:${m.id}`, m.decision === 'deny' ? 'Deny' : 'Allow'); })().catch(() => {});
      if (m.type === 'point.act') {
        const id = m.item.replace(/^session:/, '');
        const was = d.sessions.find(x => x.id === id);
        void (async () => {
          // As the gateway: an accept of a high-impact request needs the device's assertion over that very request.
          const refused = was?.pending && d.device ? d.device.assert({ type: 'session.decide', op: m.op, id, decision: 'accept', expect: { key: was.pending.key, kind: was.pending.kind, text: was.pending.text }, assertion: m.assertion } as Extract<PhoneClientMessage, { type: 'session.decide' }>) : 'confirm_required';
          if (refused) { console.log(`point.act refused: ${refused}`); return raw({ type: 'operation.result', op: m.op, status: 'rejected', reason: refused }); }
          const after = back(id)!;
          await sleep(300);
          await raw({ type: 'operation.result', op: m.op, status: 'applied' });
          await raw({ type: 'session.updated', session: after });
          await settle(m.item, 'Allow');
        })().catch((e: unknown) => console.log(`point.act failed: ${String(e)}`));
      }
    }
  }, 20);
  const close = h.close.bind(h);
  h.close = async () => { clearInterval(timer); await close(); };
  return h;
}

/** The finger: a translucent dot that glides to each tap and ripples there. */
async function finger(page: Page) {
  await page.evaluate(() => {
    // Styles through the CSSOM: the app's CSP refuses an injected <style>.
    const dot = document.createElement('div');
    dot.id = 'zz-finger';
    Object.assign(dot.style, { position: 'fixed', left: '0', top: '0', width: '34px', height: '34px', margin: '-17px 0 0 -17px', borderRadius: '50%', zIndex: '2147483647', pointerEvents: 'none',
      background: 'rgba(255,255,255,.42)', border: '1.5px solid rgba(255,255,255,.75)', boxShadow: '0 2px 10px rgba(0,0,0,.45)', opacity: '0',
      transform: 'translate(195px, 760px)', transitionProperty: 'transform, opacity, background-color', transitionTimingFunction: 'cubic-bezier(.4,0,.2,1)', transitionDuration: '500ms, 300ms, 120ms' });
    document.body.append(dot);
    const w = window as unknown as { zz: { at: [number, number]; move(x: number, y: number, ms?: number): void; ripple(): void; show(on: boolean): void; down(on: boolean): void } };
    w.zz = {
      at: [195, 760],
      move(x, y, ms = 500) { w.zz.at = [x, y]; dot.style.transitionDuration = `${ms}ms, 300ms, 120ms`; dot.style.transform = `translate(${x}px, ${y}px)`; },
      ripple() {
        const r = document.createElement('div');
        Object.assign(r.style, { position: 'fixed', left: `${w.zz.at[0]}px`, top: `${w.zz.at[1]}px`, width: '34px', height: '34px', margin: '-17px 0 0 -17px', borderRadius: '50%', zIndex: '2147483646', pointerEvents: 'none', border: '2px solid rgba(255,255,255,.85)' });
        document.body.append(r);
        r.animate([{ transform: 'scale(.7)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 500, easing: 'ease-out', fill: 'forwards' });
        setTimeout(() => r.remove(), 600);
      },
      show(on) { dot.style.opacity = on ? '1' : '0'; },
      down(on) { dot.style.backgroundColor = on ? 'rgba(255,255,255,.66)' : 'rgba(255,255,255,.42)'; }
    };
  });
}
type ZZ = { zz: { move(x: number, y: number, ms?: number): void; ripple(): void; show(on: boolean): void; down(on: boolean): void } };
const zz = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => { ((window as unknown as ZZ).zz as unknown as Record<string, (...x: unknown[]) => void>)[f as string]!(...(a as unknown[])); }, [fn, args] as const);

async function tap(page: Page, target: Locator, after = 900) {
  await expect(target).toBeVisible();
  const b = (await target.boundingBox())!;
  const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  await zz(page, 'show', true);
  await zz(page, 'move', x, y);
  await page.waitForTimeout(560);
  await zz(page, 'down', true);
  await zz(page, 'ripple');
  await page.waitForTimeout(90);
  await target.click();
  await zz(page, 'down', false);
  await page.waitForTimeout(after);
}

const GPU = ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer'];
const base = { ...iPhone13, locale: 'en-GB', timezoneId: 'Europe/Paris', colorScheme: 'dark' as const, viewport: { width: 390, height: 844 } };
const only = process.env.ONLY ?? '';
test.use({ launchOptions: { args: ['--force-device-scale-factor=2', ...GPU] } });

test.describe('stills', () => {
  test.use({ ...base, deviceScaleFactor: 3, reducedMotion: 'reduce' });
  test('stills', async ({ page }) => {
    test.skip(only !== '' && only !== 'stills');
    test.setTimeout(180_000);
    const OUT60 = `${process.env.SITE_CAPTURE_OUT ?? '/tmp/ledge-site-capture'}/shots/en`;
    mkdirSync(OUT60, { recursive: true });
    const h = await world();
    try {
      const d = h.daemon;
      const open = pr({ sessions: ['otto'], title: 'Batch 9: detached windows', updatedAt: at(-12) });
      const review = pr({ id: 'github.com/acme/ledge#229', number: 229, ref: '#229', url: 'https://github.com/acme/ledge/pull/229', title: 'SSH reconnect after a Wi-Fi drop', branch: 'fix/ssh-reconnect', pipeline: 'run', approvals: { given: 0, required: 1 }, mergeable: false, openThreads: 2, sessions: ['nova'], updatedAt: at(-30) });
      const failed = mr({ sessions: ['luna'], title: 'Homepage: new banner', branch: 'feat/homepage', repo: 'team/website', id: 'gitlab.acme.dev/team/website#41', url: 'https://gitlab.acme.dev/team/website/-/merge_requests/41', updatedAt: at(-50) });
      const merged = pr({ id: 'github.com/acme/ledge#222', number: 222, ref: '#222', title: 'Seat terminal: capture and copy', state: 'merged', branch: 'feat/seat-term', url: 'https://github.com/acme/ledge/pull/222', sessions: [] });
      d.forge = { state: forgeState({ prs: [failed, open, review, merged], followed: [{ session: 'otto', forge: 'github', host: 'github.com', repo: 'acme/ledge' }, { session: 'luna', forge: 'gitlab', host: 'gitlab.acme.dev', repo: 'team/website' }] }), details: {}, logs: {} };
      d.usage = [{ ...usage[0]!, windows: usage[0]!.windows.map(w => (w.kind === 'five_hour' ? { ...w, pct: 84 } : w)) }];
      d.openrig = {
        state: openrig(), graphs: { 'ledge-dev': ledgeGraph(), kernel: kernelGraph() },
        queues: { 'ledge-dev': { rows: [
          { id: 'qitem-20261111084549-0e470a9b31291e54', state: 'in-progress', summary: 'Paginate /invoices', from: 'pilot-lead@ledge-dev', to: 'dev-front@ledge-dev', createdAt: '2026-11-11 08:45:49', claimedAt: '2026-11-11 08:45:58', updatedAt: '2026-11-11 09:40:00', at: '2026-11-11T10:00:00.000Z' },
          { id: 'qitem-20261111104745-a24c6c604ba41ec6', state: 'pending', summary: 'Review the banner mockup', from: 'dev-front@ledge-dev', to: 'design-ux@ledge-dev', createdAt: '2026-11-11 10:47:45', updatedAt: '2026-11-11 10:47:45', at: '2026-11-11T10:50:00.000Z' }
        ], closed: [] } },
        permissions: { 'ledge-dev': openrig().rigs[1]!.nodes.map(n => ({ logicalId: n.logicalId, session: n.session, policySource: 'member_policy', policy: 'builtin:auto' })) },
        snapshots: { 'ledge-dev': [{ id: '01JC0000000000000000000001', kind: 'manual', status: 'complete', createdAt: '2026-11-11 10:42:00' }] },
        routing: routing().entries, goals: [goal()]
      };
      await page.addInitScript(() => { try { localStorage.setItem('ledge.theme', 'dark'); localStorage.setItem('mobile.lang', 'en'); } catch { /* ignore */ } });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
      await page.goto(h.url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: copy.login.github }).click();
      await page.getByRole('button', { name: copy.recover.code }).click();
      await h.pc.code();
      await page.getByRole('button', { name: copy.compare.same }).click();
      h.pc.ok();
      await page.getByRole('button', { name: copy.enroll.go }).click();
      await expect(page.getByText(copy.enroll.done)).toBeVisible();
      await page.getByRole('link', { name: copy.compare.seePending }).click();
      const go = async (hash: string) => { await page.evaluate(x => { location.hash = x; }, hash); };
      const snap = async (name: string) => { await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))])); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT60}/${name}.png` }); };
      await expect(page.getByText('git push origin main').first()).toBeVisible();
      await snap('phone-a-toi');
      await go('#/sessions');
      await expect(page.getByRole('link', { name: /Bix/ }).first()).toBeVisible();
      await snap('phone-sessions');
      await go('#/prs');
      await expect(page.locator('[data-pr]')).toHaveCount(3);
      await snap('phone-forge');
      await go('#/rigs');
      await expect(page.getByText('ledge-dev').first()).toBeVisible();
      await snap('phone-rigs');
      await go('#/rigs/ledge-dev');
      await expect(page.getByRole('button', { name: copy.rigs.seatLabel('dev-front', copy.rigs.seatState.work) })).toBeVisible();
      await snap('phone-rig-detail');
      await go('#/chat');
      await expect(page.locator('[data-point]')).toBeVisible();
      await snap('phone-ledge-point');
    } finally { await h.close(); }
  });
});

test.describe('video', () => {
test.use({ ...base, deviceScaleFactor: 2 });

test('video', async ({ page }) => {
    test.skip(only !== '' && only !== 'video');
  test.setTimeout(180_000);
  const h = await world();
  try {
    await page.addInitScript(() => { try { localStorage.setItem('ledge.theme', 'dark'); localStorage.setItem('mobile.lang', 'en'); } catch { /* ignore */ } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
    await page.goto(h.url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: copy.login.github }).click();
    await page.getByRole('button', { name: copy.recover.code }).click();
    await h.pc.code();
    await page.getByRole('button', { name: copy.compare.same }).click();
    h.pc.ok();
    await page.getByRole('button', { name: copy.enroll.go }).click();
    await expect(page.getByText(copy.enroll.done)).toBeVisible();
    await page.getByRole('link', { name: copy.compare.seePending }).click();
    await expect(page.getByText('git push origin main').first()).toBeVisible();
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]));
    await finger(page);
    await page.waitForTimeout(800);

    // Record: every frame the compositor makes, with its time.
    const frames: { file: string; ts: number }[] = [];
    cdp.on('Page.screencastFrame', (f) => {
      const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(`${FRAMES}/${file}`, Buffer.from(f.data, 'base64'));
      frames.push({ file, ts: f.metadata.timestamp ?? Date.now() / 1000 });
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
    const nav = page.getByRole('navigation', { name: copy.nav.label });

    // 1 · « À toi »: three requests; the question answered, the ordinary permission allowed.
    await page.waitForTimeout(800);
    await tap(page, page.getByRole('button', { name: 'The new one, with the screenshot' }), 1100);
    await tap(page, page.getByRole('button', { name: copy.atoi.allow, exact: true }), 1100);
    // 2 · Sessions, a thread, back.
    await tap(page, nav.getByRole('link', { name: copy.nav.sessions }), 900);
    await tap(page, page.getByRole('link', { name: /Bix/ }).first(), 800);
    await tap(page, page.getByRole('link', { name: copy.nav.backTo.sessions! }), 500);
    // 3 · Ledge: the point in the thread; its open row answered in place (the passkey), then a question.
    await tap(page, nav.getByRole('link', { name: copy.nav.chat, exact: true }), 1100);
    const otto = page.locator('[data-point-item="session:otto"]');
    await tap(page, otto.getByRole('button', { name: 'Allow' }), 200);
    await expect(otto.locator('[data-point-receipt]')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(900);
    const field = page.getByLabel(copy.chat.field);
    await tap(page, field, 150);
    await field.pressSequentially('How is Bix doing?', { delay: 40 });
    await page.waitForTimeout(250);
    await tap(page, page.getByRole('button', { name: copy.chat.send }), 300);
    await expect(page.getByRole('region', { name: copy.chat.relayLabel })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    // 4 · Back to « À toi », calm.
    await tap(page, nav.getByRole('link', { name: new RegExp(copy.nav.atoi) }), 500);
    await zz(page, 'show', false);
    await page.waitForTimeout(900);

    await cdp.send('Page.stopScreencast');
    await page.waitForTimeout(200);
    const end = frames.at(-1)!.ts + 0.1;
    const list = frames.map((f, i) => `file '${FRAMES}/${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.ts ?? end) - f.ts).toFixed(4)}`).join('\n') + `\nfile '${FRAMES}/${frames.at(-1)!.file}'\n`;
    writeFileSync(`${OUT}/frames.txt`, list);
    console.log(`frames: ${frames.length}, seconds: ${(end - frames[0]!.ts).toFixed(2)}`);
  } finally { await h.close(); }
});
});
