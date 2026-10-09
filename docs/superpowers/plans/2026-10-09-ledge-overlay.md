# Ledge overlay (Windows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Windows overlay: one living surface on the left screen edge that is the handle at rest and grows into the bubble, the list or a session, driven by the daemon's WebSocket, with the bot mascots, the motion vocabulary, mouse and keyboard interaction, and a Tauri shell that keeps the window exactly the size of the surface.

**Architecture:** `apps/overlay` is a Vite + React 19 app whose entire behaviour is testable in WSL against an in-process mock daemon; the Tauri v2 shell is a thin Rust layer (window placement, always on top, global shortcut, terminal focus) built on Windows. State lives in two small stores: `daemonStore` (sessions and connection status, fed by the WebSocket) and the `surface` state machine (mode, selection, timers), with pure geometry functions in between. Every visual change goes through the three motion curves from the design system.

**Tech Stack:** Vite 6, React 19, TypeScript 5 strict, Tailwind v4 (`@tailwindcss/vite`), hand-written shadcn-style primitives on the Shadcn Red oklch tokens, Geist and Geist Mono, Vitest 2 + jsdom + Testing Library + user-event, `ws` for the mock daemon in tests, Tauri v2 (`@tauri-apps/api`, `@tauri-apps/plugin-global-shortcut`), Rust stable on Windows.

**Spec:** `docs/superpowers/specs/2026-10-09-ledge-design.md` (sections 5, 6, 7 and the overlay parts of 8 and 9). Design canvas: https://claude.ai/artifact/57oDjsKdabQBmPgAXn15mc (boards 1 to 5, 9 is the behaviour reference, 6 and 10 the bots, 18 keyboard). Design system README (motion, tokens): https://claude.ai/artifact/QBv4bfYYVqV2aAfDjPW3JV

**Depends on:** `packages/protocol` from Plan 1 Task 1 (`docs/superpowers/plans/2026-10-09-ledge-core-wsl.md`). If that commit is not on `main` yet, create the package exactly as Plan 1 Task 1 specifies before Task 1 here, in a separate commit, so both plans converge on identical files. Nothing else from Plan 1 is needed: every test here runs against the mock daemon.

## Global Constraints

- React and UI code runs and is tested in WSL (`pnpm --filter overlay test`); the Tauri shell compiles only on Windows with Rust installed, from the same checkout opened through `\\wsl.localhost\...` or a Windows clone.
- Daemon address `ws://127.0.0.1:47831`; reconnect every 2 s, backoff to 30 s; the surface stays visible while unreachable, greyed, bots frozen.
- Colors come only from `src/styles/tokens.css` (the Shadcn Red oklch variables); dark theme by default, light theme complete; no other color literals in components.
- Motion: `grow` 320 ms `cubic-bezier(.22,1,.36,1)`, `shrink` 260 ms `cubic-bezier(.65,0,.35,1)` with 60 ms delay, `pop` 260 ms `cubic-bezier(.34,1.3,.64,1)` on a bot's scale only; fades in 180 ms after 140 to 200 ms, out 100 ms; hover and color 150 ms; `VITE_LEDGE_MOTION=0` sets every duration and delay to 0 (tests).
- Sizes: handle 28 px wide, bots 12/20 px (11/18 past five), gap 5 (3), bubble 336×128, list 380 wide with 56 px rows, session 420, reading mode 560; the surface height always follows its content, vertically centred on the screen, clamped to 40 px from the top and bottom.
- Timings: edge hover dwell 180 ms, leave 500 ms, bubble 4 s paused on hover, decide-in-bubble holds 900 ms, bot grows 280 ms then the bubble unfolds 260 ms later, list rows cascade 24 ms apart.
- Copy: sentence case, no emoji, "Claude Code", "Codex", "Cursor Agent"; relative time under a day ("2m", "48s ago").
- Accessibility: every control is a real `button`, `a`, `input` or `label`; icon-only buttons carry `aria-label`; text contrast at least 4.5:1 in both themes.

## Review Focus

1. The daemon sends `session.removed` for the session currently open in the session view: the surface must fall back to the list (or the handle if empty) with the shrink motion, never show a stale bot. Pinned in Task 9.
2. Two asks arrive within a second (two bots): one bubble for the oldest with "+1 more", the second bot grown in the handle, no second bubble stacked. Pinned in Task 6.
3. The mouse enters the edge, the list starts opening, and an ask arrives during the 180 ms dwell: the ask must not open a bubble over the list; it shows as the highlighted row. Pinned in Task 4.
4. A reply field holds unsent text and the daemon disconnects: the text survives the reconnect and the session view stays open (no auto-close while typing). Pinned in Task 8.
5. Ten bots with three asking at a 1080p screen: the handle, the list and the session view fit within the 40 px margins and the list scrolls inside the surface rather than overflowing it. Pinned in Task 5.

---

## File structure

```
apps/overlay/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/main.tsx                       # mounts App, applies theme attribute
  src/App.tsx                        # Surface + Tooltip + ConnectionBanner
  src/styles/tokens.css              # Shadcn Red variables, both themes, Ledge additions
  src/styles/base.css                # tailwind import, fonts, body
  src/motion.ts                      # curves, durations, scale(), transition()
  src/daemon/client.ts               # DaemonClient: ws, reconnect, send, status
  src/daemon/store.ts                # daemonStore: sessions map, status, useDaemon()
  src/bots/poseFor.ts                # pose = (hash(name) + stateIndex) mod 3
  src/bots/Bot.tsx                   # the mascot (port of Bot.dc.html)
  src/surface/geometry.ts            # pure layout: slots, handle, bubble, panel rects, hot zones
  src/surface/machine.ts             # pure mode machine: transition(state, event) -> state + effects
  src/surface/controller.ts          # timers and effects around the machine
  src/surface/Surface.tsx            # the one morphing div with four layers
  src/surface/Handle.tsx
  src/surface/Bubble.tsx
  src/surface/SessionList.tsx
  src/surface/SessionView.tsx
  src/surface/Tooltip.tsx
  src/keyboard/useKeyboard.ts        # key map, selection, coachmark state
  src/keyboard/Coachmark.tsx
  src/ui/Button.tsx, Badge.tsx, Kbd.tsx
  src/tauri/bridge.ts                # setFrame(), focusTerminal(), onShortcut(), with no-op fallback in the browser
  src/format.ts                      # relativeTime(), toolName()
  test/mockDaemon.ts                 # in-process ws daemon for tests and the ?mock dev mode
  test/*.test.ts(x)
  src-tauri/Cargo.toml, tauri.conf.json, build.rs, src/main.rs, icons/
```

---

### Task 1: App scaffold, tokens, motion module

**Files:**
- Create: `apps/overlay/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx` (placeholder), `src/styles/tokens.css`, `src/styles/base.css`, `src/motion.ts`, `src/format.ts`
- Test: `apps/overlay/test/motion.test.ts`, `apps/overlay/test/format.test.ts`

**Interfaces:**
- Produces: `MOTION = { grow: { ms: 320, ease: 'cubic-bezier(.22,1,.36,1)' }, shrink: { ms: 260, ease: 'cubic-bezier(.65,0,.35,1)', delayMs: 60 }, pop: { ms: 260, ease: 'cubic-bezier(.34,1.3,.64,1)' } }`; `ms(n: number): string` (scaled by `VITE_LEDGE_MOTION`, `'0ms'` in tests); `transition(parts: Array<[prop: string, kind: 'grow' | 'shrink' | 'pop' | 'fadeIn' | 'fadeOut' | 'hover', delayMs?: number]>): string`; `relativeTime(iso: string, now?: number): string`; `toolName(tool: Tool): string`.

- [ ] **Step 1: Create the package**

`apps/overlay/package.json`:
```json
{
  "name": "overlay",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "tauri": "tauri"
  },
  "dependencies": {
    "@ledge/protocol": "workspace:*",
    "@tauri-apps/api": "^2.1.0",
    "@tauri-apps/plugin-global-shortcut": "^2.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@tauri-apps/cli": "^2.1.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/ws": "^8.5.12",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "vite": "^6.0.0",
    "ws": "^8.18.0"
  }
}
```

`apps/overlay/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client", "node", "@testing-library/jest-dom"], "noEmit": true },
  "include": ["src", "test", "vite.config.ts"]
}
```

`apps/overlay/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    env: { VITE_LEDGE_MOTION: '0' }
  }
});
```

`apps/overlay/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`apps/overlay/index.html`:
```html
<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Ledge</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" />
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`apps/overlay/src/styles/tokens.css`:
```css
:root, :root[data-theme="light"] {
  --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0); --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0); --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.505 0.213 27.518); --primary-foreground: oklch(0.971 0.013 17.38); --primary-hover: oklch(0.444 0.177 26.899);
  --secondary: oklch(0.967 0.001 286.375); --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0); --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325); --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0);
  --radius: 0.625rem; --radius-sm: 6px; --radius-md: 8px; --radius-lg: 10px; --radius-xl: 14px;
  --sidebar: oklch(0.985 0 0); --sidebar-foreground: oklch(0.145 0 0); --sidebar-primary: oklch(0.577 0.245 27.325);
  --sidebar-primary-foreground: oklch(0.971 0.013 17.38); --sidebar-accent: oklch(0.97 0 0); --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0); --sidebar-ring: oklch(0.708 0 0);
  --success: #059669; --warning: #b45309; --info: #2563eb; --danger-text: oklch(0.505 0.213 27.518);
  --status-success-soft: #ecfdf5; --status-warning-soft: #fffbeb; --status-info-soft: #eff6ff; --status-danger-soft: #fef2f2;
  --shadow-overlay: 0 20px 40px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06);
  --well: oklch(0.97 0 0);
}
:root[data-theme="dark"] {
  --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0); --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0); --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.444 0.177 26.899); --primary-foreground: oklch(0.971 0.013 17.38); --primary-hover: oklch(0.396 0.141 25.723);
  --secondary: oklch(0.274 0.006 286.033); --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0); --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216); --destructive-foreground: oklch(0.985 0 0);
  --border: #ffffff1a; --input: #ffffff26; --ring: oklch(0.556 0 0);
  --sidebar: oklch(0.205 0 0); --sidebar-foreground: oklch(0.985 0 0); --sidebar-primary: oklch(0.637 0.237 25.331);
  --sidebar-primary-foreground: oklch(0.971 0.013 17.38); --sidebar-accent: oklch(0.269 0 0); --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: #ffffff1a; --sidebar-ring: oklch(0.556 0 0);
  --success: #34d399; --warning: #fbbf24; --info: #60a5fa; --danger-text: oklch(0.704 0.191 22.216);
  --status-success-soft: #052e16; --status-warning-soft: #422006; --status-info-soft: #172554; --status-danger-soft: #450a0a;
  --shadow-overlay: 0 20px 40px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08);
  --well: oklch(0.145 0 0);
}
```

`apps/overlay/src/styles/base.css`:
```css
@import "tailwindcss";
@import "./tokens.css";
html, body, #root { margin: 0; height: 100%; background: transparent; }
body { font-family: 'Geist', system-ui, sans-serif; color: var(--sidebar-foreground); font-size: 14px; line-height: 20px; overflow: hidden; }
.mono { font-family: 'Geist Mono', ui-monospace, monospace; }
button, input { font-family: inherit; }
```

`apps/overlay/src/motion.ts`:
```ts
export const MOTION = {
  grow: { ms: 320, ease: 'cubic-bezier(.22,1,.36,1)', delayMs: 0 },
  shrink: { ms: 260, ease: 'cubic-bezier(.65,0,.35,1)', delayMs: 60 },
  pop: { ms: 260, ease: 'cubic-bezier(.34,1.3,.64,1)', delayMs: 0 },
  fadeIn: { ms: 180, ease: 'ease-out', delayMs: 140 },
  fadeOut: { ms: 100, ease: 'ease-in', delayMs: 0 },
  hover: { ms: 150, ease: 'ease-out', delayMs: 0 }
} as const;
export type MotionKind = keyof typeof MOTION;

const scale = (): number => {
  const v = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_LEDGE_MOTION;
  return v === undefined ? 1 : Number(v);
};
export const ms = (n: number): string => `${Math.round(n * scale())}ms`;

export function transition(parts: Array<[string, MotionKind, number?]>): string {
  return parts.map(([prop, kind, delay]) => {
    const m = MOTION[kind];
    return `${prop} ${ms(m.ms)} ${m.ease} ${ms(delay ?? m.delayMs)}`;
  }).join(', ');
}
```

`apps/overlay/src/format.ts`:
```ts
import type { Tool } from '@ledge/protocol';
export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export const toolName = (t: Tool): string => ({ claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' })[t];
```

`apps/overlay/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<App />);
```

`apps/overlay/src/App.tsx` (placeholder until Task 9):
```tsx
export function App() { return <div data-testid="app">Ledge</div>; }
```

- [ ] **Step 2: Write the failing tests**

`apps/overlay/test/motion.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { transition, ms, MOTION } from '../src/motion';

describe('motion', () => {
  it('scales every duration by VITE_LEDGE_MOTION (0 in tests)', () => {
    expect(ms(320)).toBe('0ms');
  });
  it('builds a transition string from the vocabulary', () => {
    expect(transition([['width', 'grow'], ['opacity', 'fadeIn', 200]])).toBe(`width 0ms ${MOTION.grow.ease} 0ms, opacity 0ms ease-out 0ms`);
  });
  it('keeps the three curves exactly as the design system states', () => {
    expect(MOTION.grow).toEqual({ ms: 320, ease: 'cubic-bezier(.22,1,.36,1)', delayMs: 0 });
    expect(MOTION.shrink).toEqual({ ms: 260, ease: 'cubic-bezier(.65,0,.35,1)', delayMs: 60 });
    expect(MOTION.pop.ease).toBe('cubic-bezier(.34,1.3,.64,1)');
  });
});
```

`apps/overlay/test/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { relativeTime, toolName } from '../src/format';
const T = Date.parse('2026-10-09T18:00:00.000Z');
describe('format', () => {
  it('relative time', () => {
    expect(relativeTime('2026-10-09T17:59:12.000Z', T)).toBe('48s');
    expect(relativeTime('2026-10-09T17:48:00.000Z', T)).toBe('12m');
    expect(relativeTime('2026-10-09T15:00:00.000Z', T)).toBe('3h');
  });
  it('tool names', () => { expect(toolName('cursor')).toBe('Cursor Agent'); });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm install && pnpm --filter overlay test`
Expected: FAIL, modules not found (or the whole run fails until files exist).

- [ ] **Step 4: Create the files from Step 1, then run the tests**

Run: `pnpm --filter overlay test && pnpm --filter overlay typecheck`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay pnpm-lock.yaml
git commit -m "feat(overlay): app scaffold, Shadcn Red tokens, motion vocabulary"
```

---

### Task 2: Daemon client and store with the mock daemon

**Files:**
- Create: `apps/overlay/src/daemon/client.ts`, `apps/overlay/src/daemon/store.ts`, `apps/overlay/test/mockDaemon.ts`
- Test: `apps/overlay/test/daemon.test.ts` (node environment)

**Interfaces:**
- Produces: `createDaemonClient(opts: { url: string; WebSocketImpl?: typeof WebSocket; minBackoffMs?: number; maxBackoffMs?: number }): DaemonClient` where `DaemonClient = { connect(): void; close(): void; send(msg: ClientMessage): void; status: () => 'connecting' | 'open' | 'unreachable'; onMessage(fn: (m: ServerMessage) => void): () => void; onStatus(fn: (s) => void): () => void }`; `daemonStore` with `getState(): { sessions: Session[]; byId: Map<string, Session>; status; previews: Map<string, string[]> }`, `subscribe(fn)`, `apply(m: ServerMessage)`, `setStatus(s)`, `reset()`; `useDaemon(): ReturnType<typeof daemonStore.getState>` (via `useSyncExternalStore`); `attachClient(client): () => void`.
- `createMockDaemon(opts?: { port?: number }): Promise<{ port: number; url: string; sessions: Map<string, Session>; upsert(s): void; remove(id): void; preview(id, lines): void; received: ClientMessage[]; close(): Promise<void> }>` which sends `snapshot` on connect and broadcasts on `upsert`/`remove`.
- Ordering rule for `sessions`: pending bots are not moved; the list is the registration order (`startedAt` ascending), stable.

- [ ] **Step 1: Write the mock daemon**

`apps/overlay/test/mockDaemon.ts`:
```ts
import { WebSocketServer, WebSocket } from 'ws';
import { parseClientMessage, type ClientMessage, type ServerMessage, type Session } from '@ledge/protocol';

export async function createMockDaemon(opts: { port?: number } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: opts.port ?? 0 });
  await new Promise<void>(r => wss.once('listening', r));
  const port = (wss.address() as { port: number }).port;
  const sessions = new Map<string, Session>();
  const received: ClientMessage[] = [];
  const bc = (m: ServerMessage) => { for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(m)); };
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()] }));
    ws.on('message', d => { try { const m = parseClientMessage(JSON.parse(String(d))); received.push(m); if (m.type === 'snapshot.request') ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()] })); } catch { /* ignore */ } });
  });
  return {
    port, url: `ws://127.0.0.1:${port}`, sessions, received,
    upsert(s: Session) { sessions.set(s.id, s); bc({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); bc({ type: 'session.removed', id }); },
    preview(id: string, lines: string[]) { bc({ type: 'session.preview', id, lines }); },
    close: () => new Promise<void>(r => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); })
  };
}

export const T0 = '2026-10-09T18:00:00.000Z';
export function fakeSession(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}
```

- [ ] **Step 2: Write the failing test**

`apps/overlay/test/daemon.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { daemonStore, attachClient } from '../src/daemon/store';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let mock: Awaited<ReturnType<typeof createMockDaemon>>;
beforeEach(async () => { daemonStore.reset(); mock = await createMockDaemon(); });
afterEach(async () => { await mock.close(); });

describe('daemon client + store', () => {
  it('loads the snapshot, applies updates and removals in stable order', async () => {
    mock.sessions.set('a', fakeSession('a')); mock.sessions.set('b', fakeSession('b', { name: 'Pim', startedAt: '2026-10-09T18:01:00.000Z' }));
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    const detach = attachClient(client); client.connect();
    await sleep(100);
    expect(daemonStore.getState().status).toBe('open');
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['a', 'b']);
    mock.upsert(fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    await sleep(50);
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['a', 'b']);
    expect(daemonStore.getState().byId.get('a')?.state).toBe('waiting_permission');
    mock.remove('a'); await sleep(50);
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['b']);
    mock.preview('b', ['x', 'y']); await sleep(50);
    expect(daemonStore.getState().previews.get('b')).toEqual(['x', 'y']);
    detach(); client.close();
  });

  it('reports unreachable, reconnects with backoff and reloads the snapshot', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never, minBackoffMs: 50, maxBackoffMs: 100 });
    const statuses: string[] = []; client.onStatus(s => statuses.push(s));
    attachClient(client); client.connect(); await sleep(80);
    const port = mock.port; await mock.close(); await sleep(80);
    expect(daemonStore.getState().status).toBe('unreachable');
    mock = await createMockDaemon({ port }); mock.sessions.set('z', fakeSession('z'));
    await sleep(300);
    expect(daemonStore.getState().status).toBe('open');
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['z']);
    expect(statuses).toContain('unreachable');
    client.close();
  });

  it('sends client messages as JSON the daemon can parse', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    client.connect(); await sleep(80);
    client.send({ type: 'session.decide', id: 'a', decision: 'accept' }); await sleep(50);
    expect(mock.received).toEqual([{ type: 'session.decide', id: 'a', decision: 'accept' }]);
    client.close();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter overlay test daemon`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`apps/overlay/src/daemon/client.ts`:
```ts
import { parseServerMessage, type ClientMessage, type ServerMessage } from '@ledge/protocol';

export type DaemonStatus = 'connecting' | 'open' | 'unreachable';
export interface DaemonClient {
  connect(): void; close(): void; send(msg: ClientMessage): void; status(): DaemonStatus;
  onMessage(fn: (m: ServerMessage) => void): () => void; onStatus(fn: (s: DaemonStatus) => void): () => void;
}
type WsLike = { send(data: string): void; close(): void; onopen: null | (() => void); onclose: null | (() => void); onerror: null | (() => void); onmessage: null | ((ev: { data: unknown }) => void); readyState: number };
type WsCtor = new (url: string) => WsLike;

export function createDaemonClient(opts: { url: string; WebSocketImpl?: WsCtor; minBackoffMs?: number; maxBackoffMs?: number }): DaemonClient {
  const Ws = (opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: WsCtor }).WebSocket);
  const min = opts.minBackoffMs ?? 2000, max = opts.maxBackoffMs ?? 30000;
  let ws: WsLike | null = null, status: DaemonStatus = 'connecting', backoff = min, timer: ReturnType<typeof setTimeout> | null = null, closed = false;
  const msgFns = new Set<(m: ServerMessage) => void>(), statusFns = new Set<(s: DaemonStatus) => void>();
  const setStatus = (s: DaemonStatus) => { if (s !== status) { status = s; statusFns.forEach(f => f(s)); } };
  const schedule = () => { if (closed) return; timer = setTimeout(open, backoff); backoff = Math.min(max, backoff * 2); };
  function open() {
    if (closed) return;
    setStatus(status === 'open' ? 'connecting' : status);
    const sock = new Ws(opts.url); ws = sock;
    sock.onopen = () => { backoff = min; setStatus('open'); };
    sock.onmessage = ev => { try { const m = parseServerMessage(JSON.parse(String(ev.data))); msgFns.forEach(f => f(m)); } catch { /* ignore malformed */ } };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => { if (ws === sock) ws = null; setStatus('unreachable'); schedule(); };
  }
  return {
    connect: () => { closed = false; open(); },
    close: () => { closed = true; if (timer) clearTimeout(timer); ws?.close(); ws = null; },
    send: m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    status: () => status,
    onMessage: f => { msgFns.add(f); return () => msgFns.delete(f); },
    onStatus: f => { statusFns.add(f); return () => statusFns.delete(f); }
  };
}
```

`apps/overlay/src/daemon/store.ts`:
```ts
import { useSyncExternalStore } from 'react';
import type { ServerMessage, Session } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from './client';

export interface DaemonState { sessions: Session[]; byId: Map<string, Session>; status: DaemonStatus; previews: Map<string, string[]> }
let state: DaemonState = { sessions: [], byId: new Map(), status: 'connecting', previews: new Map() };
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const sorted = (m: Map<string, Session>) => [...m.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

export const daemonStore = {
  getState: () => state,
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
  setStatus(status: DaemonStatus) { state = { ...state, status }; emit(); },
  reset() { state = { sessions: [], byId: new Map(), status: 'connecting', previews: new Map() }; emit(); },
  apply(m: ServerMessage) {
    const byId = new Map(state.byId); const previews = new Map(state.previews);
    switch (m.type) {
      case 'snapshot': byId.clear(); for (const s of m.sessions) byId.set(s.id, s); for (const id of previews.keys()) if (!byId.has(id)) previews.delete(id); break;
      case 'session.updated': byId.set(m.session.id, m.session); break;
      case 'session.removed': byId.delete(m.id); previews.delete(m.id); break;
      case 'session.preview': previews.set(m.id, m.lines); break;
      case 'error': return;
    }
    state = { ...state, byId, previews, sessions: sorted(byId) }; emit();
  }
};

export function attachClient(client: DaemonClient): () => void {
  const a = client.onMessage(m => daemonStore.apply(m));
  const b = client.onStatus(s => daemonStore.setStatus(s));
  return () => { a(); b(); };
}
export const useDaemon = (): DaemonState => useSyncExternalStore(daemonStore.subscribe, daemonStore.getState, daemonStore.getState);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter overlay test daemon`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/overlay/src/daemon apps/overlay/test/mockDaemon.ts apps/overlay/test/daemon.test.ts
git commit -m "feat(overlay): daemon websocket client with backoff and the sessions store"
```

---

### Task 3: The Bot mascot component

**Files:**
- Create: `apps/overlay/src/bots/poseFor.ts`, `apps/overlay/src/bots/Bot.tsx`
- Test: `apps/overlay/test/bot.test.tsx`

**Interfaces:**
- Produces: `poseFor(name: string, state: SessionState): 1 | 2 | 3` (`readonly` and `starting`/`idle` map to 1); `botState(session: Session): BotState` where `BotState = 'working' | 'question' | 'approval' | 'done' | 'error' | 'readonly'` (`waiting_input` → `question`, `waiting_permission` → `approval`, `exited` → `done` unless `exitCode` is a non-zero number → `error`, `error` → `error`, `hook_only` and no terminal → `readonly`, else `working`); `<Bot tool state pose size theme="dark"|"light" />` rendering one `svg` with `role="img"` and an `aria-label` like `claude bot, needs approval, on the ledge`.
- The SVG paths, poses and per-state animations are a direct port of `project/Bot.dc.html` on the canvas (read it with the Artifact tool, `path: "project/Bot.dc.html"`); every eye and prop layer is always rendered and crossfaded (`opacity` with `transition: fadeIn/fadeOut`), the head group transitions `transform` with the shrink curve, the light's `fill` transitions 300 ms.

- [ ] **Step 1: Write the failing tests**

`apps/overlay/test/bot.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Bot } from '../src/bots/Bot';
import { poseFor, botState } from '../src/bots/poseFor';
import { fakeSession } from './mockDaemon';

describe('poseFor', () => {
  it('is deterministic per name and state, in 1..3', () => {
    const a = poseFor('Otto', 'working'), b = poseFor('Otto', 'working');
    expect(a).toBe(b); expect([1, 2, 3]).toContain(a);
  });
  it('varies across a team for the same state', () => {
    const poses = new Set(['Otto', 'Pim', 'Nova', 'Bix', 'Lu', 'Max', 'Ida'].map(n => poseFor(n, 'waiting_permission')));
    expect(poses.size).toBeGreaterThan(1);
  });
  it('readonly has a single pose', () => { expect(poseFor('Zoe', 'idle')).toBe(poseFor('Zoe', 'starting')); });
});

describe('botState', () => {
  it('maps session states to bot states', () => {
    expect(botState(fakeSession('a', { state: 'waiting_permission' }))).toBe('approval');
    expect(botState(fakeSession('a', { state: 'waiting_input' }))).toBe('question');
    expect(botState(fakeSession('a', { state: 'exited', exitCode: 0 }))).toBe('done');
    expect(botState(fakeSession('a', { state: 'exited', exitCode: 2 }))).toBe('error');
    expect(botState(fakeSession('a', { state: 'error' }))).toBe('error');
    expect(botState(fakeSession('a', { source: 'hook_only', tmuxSession: null }))).toBe('readonly');
    expect(botState(fakeSession('a', { state: 'idle' }))).toBe('working');
  });
});

describe('<Bot>', () => {
  it('renders an svg with a descriptive label and the requested size', () => {
    render(<Bot tool="claude" state="approval" pose={1} size={32} theme="dark" />);
    const svg = screen.getByRole('img', { name: /claude bot, needs your approval, on the ledge/ });
    expect(svg).toHaveAttribute('width', '32');
  });
  it('uses the status color for the eyes', () => {
    const { container } = render(<Bot tool="codex" state="question" pose={1} size={20} theme="dark" />);
    const eyes = container.querySelector('[data-layer="eyes-round"]');
    expect(eyes).toHaveAttribute('fill', 'var(--warning)');
    expect(eyes).toHaveStyle({ opacity: '1' });
    expect(container.querySelector('[data-layer="eyes-scan"]')).toHaveStyle({ opacity: '0' });
  });
  it('changes head shape with the tool', () => {
    const a = render(<Bot tool="claude" state="working" pose={1} size={20} theme="dark" />).container.querySelector('[data-layer="head"]')!.getAttribute('d');
    const b = render(<Bot tool="cursor" state="working" pose={1} size={20} theme="dark" />).container.querySelector('[data-layer="head"]')!.getAttribute('d');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter overlay test bot`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`apps/overlay/src/bots/poseFor.ts`:
```ts
import type { Session, SessionState } from '@ledge/protocol';
export type BotState = 'working' | 'question' | 'approval' | 'done' | 'error' | 'readonly';
const STATE_INDEX: Record<SessionState, number> = { starting: 0, working: 0, waiting_input: 1, waiting_permission: 2, idle: 0, exited: 3, error: 4 };
function hash(s: string): number { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function poseFor(name: string, state: SessionState): 1 | 2 | 3 {
  return ((hash(name) + STATE_INDEX[state]) % 3 + 1) as 1 | 2 | 3;
}
export function botState(s: Session): BotState {
  if (s.state === 'error') return 'error';
  if (s.state === 'exited') return typeof s.exitCode === 'number' && s.exitCode !== 0 ? 'error' : 'done';
  if (s.state === 'waiting_permission') return 'approval';
  if (s.state === 'waiting_input') return 'question';
  if (s.source === 'hook_only' && !s.tmuxSession) return 'readonly';
  return 'working';
}
```

`apps/overlay/src/bots/Bot.tsx`: port `project/Bot.dc.html` from the canvas. Keep its `heads`, eye paths, pose table (`working1..readonly1`) and keyframes verbatim; replace the `{{hole}}` style strings with React style objects and the hard-coded colors with CSS variables: body `var(--secondary)`, line `var(--border)` (use `#ffffff40` in dark via `var(--input)`), bg `var(--well)`, eye colors `var(--info)`, `var(--warning)`, `var(--danger-text)`, `var(--success)`, `var(--muted-foreground)`. Every layer `<path>` gets `data-layer="<name>"` (`head`, `eyes-scan`, `eyes-round`, `eyes-tilt`, `eyes-up`, `eyes-down`, `eyes-dots`, `eyes-ticks`, `eyes-closed`, `eyes-happy`, `eyes-x`, `eyes-sad`, `brow`, `fist`, `rings`, `smoke`, `dots`, `bubble`, `z`, `ledge`, `hands1`, `card`) and `style={{ opacity: on ? 1 : 0, transition: transition([['opacity', on ? 'fadeIn' : 'fadeOut', 0], ['fill', 'hover'], ['stroke', 'hover']]), animation: on ? anim : undefined }}`. The keyframes go in a `<style>` tag rendered once (module-level flag). Signature:

```tsx
export interface BotProps { tool: Tool; state: BotState; pose: 1 | 2 | 3; size: number; theme: 'dark' | 'light'; className?: string }
export function Bot({ tool, state, pose, size, theme, className }: BotProps): JSX.Element
```
and the label is `${tool} bot, ${LABELS[key]}` with `LABELS` copied from the canvas file's `label` fields (`'needs your approval, on the ledge'`, `'has a question, brow up'`, …).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test bot`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/bots apps/overlay/test/bot.test.tsx
git commit -m "feat(overlay): Bot mascot with three poses per state and crossfaded transitions"
```

---

### Task 4: Pure geometry and the surface state machine

**Files:**
- Create: `apps/overlay/src/surface/geometry.ts`, `apps/overlay/src/surface/machine.ts`, `apps/overlay/src/surface/controller.ts`
- Test: `apps/overlay/test/geometry.test.ts`, `apps/overlay/test/machine.test.ts`

**Interfaces:**
- Produces (geometry): `SIZES = { handleW: 28, bubbleW: 336, bubbleH: 128, listW: 380, sessionW: 420, readingW: 560, rowH: 56, headerH: 56, margin: 40 }`; `slotSizes(n): { big, small, gap }` (20/12/5 up to 5 bots, 18/11/3 after); `layout(input: { bots: Array<{ id: string; pending: boolean }>; mode: Mode; screenH: number; bubbleId?: string | null; sessionH?: number; reading?: boolean }): Layout` with `Layout = { top: number; w: number; h: number; slots: Array<{ id: string; size: number; center: number }>; handle: { top: number; h: number }; hotZones: Array<{ top: number; h: number }> }`.
- Produces (machine): `type Mode = 'handle' | 'bubble' | 'list' | 'session'`; `type SurfaceState = { mode: Mode; selectedId: string | null; bubbleId: string | null; queue: string[]; openedBy: 'mouse' | 'keyboard' | null; hot: boolean; reading: boolean; typing: boolean }`; `type SurfaceEvent = { type: 'ask'; id: string } | { type: 'askCleared'; id: string } | { type: 'removed'; id: string; remaining: string[] } | { type: 'edgeEnter' } | { type: 'edgeLeave' } | { type: 'dwellElapsed' } | { type: 'surfaceEnter' } | { type: 'surfaceLeave' } | { type: 'leaveElapsed' } | { type: 'botClick'; id: string } | { type: 'rowClick'; id: string } | { type: 'bubbleClick' } | { type: 'bubbleElapsed' } | { type: 'decidedInBubble' } | { type: 'holdElapsed' } | { type: 'back' } | { type: 'close' } | { type: 'shortcut' } | { type: 'typing'; on: boolean } | { type: 'reading'; on: boolean }`; `transition(state, event): { state: SurfaceState; effects: Effect[] }` where `Effect = { type: 'startTimer'; name: 'dwell' | 'leave' | 'bubble' | 'hold' | 'unfold'; ms: number } | { type: 'cancelTimer'; name: ... }`; `initialSurface(): SurfaceState`.
- Produces (controller): `createSurfaceController(opts: { onState(s: SurfaceState): void; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout }): { dispatch(e: SurfaceEvent): void; state(): SurfaceState; dispose(): void }` running the effects with real timers: `dwell` 180, `leave` 500, `bubble` 4000, `hold` 900, `unfold` 260 (the bot grows first, then `ask` opens the bubble after the `unfold` timer).

Machine rules (the spec, section 5):
- `ask` while `handle`: push to `queue` (oldest first); start `unfold`; on `unfold` elapsed with mode still `handle` → `bubble` for `queue[0]`, start `bubble` 4000.
- `ask` while `bubble`/`list`/`session`: push to the queue only (no second bubble; the list highlights, the handle grows the bot).
- `askCleared`: drop from the queue; if it was the bubble's bot → back to `handle` (or `bubble` for the next queued ask, with a fresh timer).
- `edgeEnter` in `handle` (and not `hot`): `hot = true`, start `dwell`; `dwellElapsed` with `hot` and mode `handle` → `list`, `openedBy: 'mouse'`, `hot = false`. If an `ask` arrived during the dwell, the list opens anyway (no bubble over it: `unfold` is cancelled).
- `edgeLeave`: `hot = false`, cancel `dwell`.
- `surfaceEnter`: cancel `leave`; in `bubble` cancel `bubble` (pause). `surfaceLeave`: in `list` with `openedBy: 'mouse'` and not `typing` → start `leave` 500; in `bubble` → start `bubble` 1500. `leaveElapsed` in `list` → `handle`.
- `botClick`/`rowClick`/`bubbleClick` → `session` with `selectedId`, cancel every timer, `bubbleId = null`.
- `decidedInBubble` → start `hold` 900 (bubble stays, bot changes pose); `holdElapsed` → `handle`, drop the queue head.
- `bubbleElapsed` → `handle` (the ask stays queued, the bot stays grown).
- `back` in `session` → `list`; `close` → `handle` (cancel timers, `reading = false`); `shortcut` → `list` with `openedBy: 'keyboard'` when `handle`, else `handle`.
- `removed` → drop from the queue; if `selectedId` was removed → `list` when `remaining.length > 0`, else `handle`; if `bubbleId` was removed → `handle`.
- `typing` only sets the flag; `reading` only sets the flag.

- [ ] **Step 1: Write the failing tests**

`apps/overlay/test/geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { layout, slotSizes, SIZES } from '../src/surface/geometry';
const bots = (n: number, pending: number[] = []) => Array.from({ length: n }, (_, i) => ({ id: String(i), pending: pending.includes(i) }));

describe('geometry', () => {
  it('uses 20/12/5 up to five bots and 18/11/3 after', () => {
    expect(slotSizes(5)).toEqual({ big: 20, small: 12, gap: 5 });
    expect(slotSizes(6)).toEqual({ big: 18, small: 11, gap: 3 });
  });
  it('centres the handle and sizes it to the team', () => {
    const l = layout({ bots: bots(5, [0, 1]), mode: 'handle', screenH: 1080 });
    expect(l.w).toBe(SIZES.handleW);
    expect(l.h).toBe(16 + 20 + 20 + 12 + 12 + 12 + 4 * 5);
    expect(l.top).toBe(Math.round(540 - l.h / 2));
    expect(l.slots[0]!.center).toBe(l.top + 8 + 10);
    expect(l.slots[2]!.size).toBe(12);
  });
  it('a bubble sits at the asking bot slot, clamped to the margins', () => {
    const l = layout({ bots: bots(5, [4]), mode: 'bubble', screenH: 1080, bubbleId: '4' });
    const h = layout({ bots: bots(5, [4]), mode: 'handle', screenH: 1080 });
    expect(l.w).toBe(SIZES.bubbleW); expect(l.h).toBe(SIZES.bubbleH);
    expect(l.top).toBe(h.slots[4]!.center - 38);
    const edge = layout({ bots: bots(10, [0]), mode: 'bubble', screenH: 300, bubbleId: '0' });
    expect(edge.top).toBeGreaterThanOrEqual(SIZES.margin);
  });
  it('the list grows with the rows and never exceeds the screen minus margins', () => {
    const l = layout({ bots: bots(3), mode: 'list', screenH: 1080 });
    expect(l.h).toBe(SIZES.headerH + 16 + 3 * SIZES.rowH + 48);
    const big = layout({ bots: bots(10, [0, 4, 8]), mode: 'list', screenH: 600 });
    expect(big.h).toBe(600 - 2 * SIZES.margin);
    expect(big.top).toBe(SIZES.margin);
  });
  it('hot zones cover the edge above and below the handle with a 6px gap', () => {
    const l = layout({ bots: bots(5), mode: 'handle', screenH: 1080 });
    expect(l.hotZones[0]).toEqual({ top: SIZES.margin, h: l.handle.top - 6 - SIZES.margin });
    expect(l.hotZones[1]!.top).toBe(l.handle.top + l.handle.h + 6);
  });
  it('an empty team gives a 6px strip 60px tall', () => {
    const l = layout({ bots: [], mode: 'handle', screenH: 1080 });
    expect(l).toMatchObject({ w: 6, h: 60 });
  });
  it('reading mode widens the session', () => {
    expect(layout({ bots: bots(2), mode: 'session', screenH: 1080, sessionH: 500, reading: true }).w).toBe(SIZES.readingW);
  });
});
```

`apps/overlay/test/machine.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { transition, initialSurface, type SurfaceState, type SurfaceEvent } from '../src/surface/machine';
import { createSurfaceController } from '../src/surface/controller';

const run = (events: SurfaceEvent[], start: SurfaceState = initialSurface()) => {
  let s = start; const effects: string[] = [];
  for (const e of events) { const r = transition(s, e); s = r.state; effects.push(...r.effects.map(x => `${x.type}:${x.name}`)); }
  return { s, effects };
};

describe('surface machine', () => {
  it('an ask grows the bot first, then unfolds the bubble', () => {
    const r = run([{ type: 'ask', id: 'a' }]);
    expect(r.s.mode).toBe('handle'); expect(r.s.queue).toEqual(['a']); expect(r.effects).toContain('startTimer:unfold');
    const r2 = run([{ type: 'unfoldElapsed' as never }], r.s);
    expect(r2.s.mode).toBe('bubble'); expect(r2.s.bubbleId).toBe('a'); expect(r2.effects).toContain('startTimer:bubble');
  });
  it('a second ask queues behind the bubble, never stacks a bubble', () => {
    const { s } = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'ask', id: 'b' }]);
    expect(s.mode).toBe('bubble'); expect(s.bubbleId).toBe('a'); expect(s.queue).toEqual(['a', 'b']);
  });
  it('the bubble folds after its timer and the ask stays queued', () => {
    const { s } = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'bubbleElapsed' }]);
    expect(s.mode).toBe('handle'); expect(s.queue).toEqual(['a']);
  });
  it('hovering pauses the bubble, leaving restarts a short timer', () => {
    const paused = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'surfaceEnter' }]);
    expect(paused.effects).toContain('cancelTimer:bubble');
    const left = run([{ type: 'surfaceLeave' }], paused.s);
    expect(left.effects).toContain('startTimer:bubble');
  });
  it('edge dwell opens the list by mouse; leaving closes it after the leave timer', () => {
    const { s, effects } = run([{ type: 'edgeEnter' }, { type: 'dwellElapsed' }]);
    expect(effects).toContain('startTimer:dwell'); expect(s.mode).toBe('list'); expect(s.openedBy).toBe('mouse');
    const r = run([{ type: 'surfaceLeave' }, { type: 'leaveElapsed' }], s);
    expect(r.s.mode).toBe('handle');
  });
  it('an ask during the dwell does not open a bubble over the list', () => {
    const { s, effects } = run([{ type: 'edgeEnter' }, { type: 'ask', id: 'a' }, { type: 'dwellElapsed' }, { type: 'unfoldElapsed' as never }]);
    expect(s.mode).toBe('list'); expect(effects.filter(e => e === 'cancelTimer:unfold').length).toBeGreaterThan(0);
  });
  it('typing keeps the list open when the mouse leaves', () => {
    const { s, effects } = run([{ type: 'edgeEnter' }, { type: 'dwellElapsed' }, { type: 'typing', on: true }, { type: 'surfaceLeave' }]);
    expect(s.mode).toBe('list'); expect(effects).not.toContain('startTimer:leave');
  });
  it('clicking a bot, a row or the bubble opens the session on that bot', () => {
    expect(run([{ type: 'botClick', id: 'b' }]).s).toMatchObject({ mode: 'session', selectedId: 'b' });
    expect(run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'bubbleClick' }]).s).toMatchObject({ mode: 'session', selectedId: 'a', bubbleId: null });
  });
  it('deciding in the bubble holds 900ms then folds and drops the ask', () => {
    const r = run([{ type: 'ask', id: 'a' }, { type: 'unfoldElapsed' as never }, { type: 'decidedInBubble' }]);
    expect(r.s.mode).toBe('bubble'); expect(r.effects).toContain('startTimer:hold');
    const r2 = run([{ type: 'holdElapsed' }], r.s);
    expect(r2.s.mode).toBe('handle'); expect(r2.s.queue).toEqual([]);
  });
  it('removing the open session falls back to the list, or the handle when empty', () => {
    const s1 = run([{ type: 'botClick', id: 'a' }, { type: 'removed', id: 'a', remaining: ['b'] }]).s;
    expect(s1.mode).toBe('list'); expect(s1.selectedId).toBeNull();
    const s2 = run([{ type: 'botClick', id: 'a' }, { type: 'removed', id: 'a', remaining: [] }]).s;
    expect(s2.mode).toBe('handle');
  });
  it('shortcut toggles the list opened by keyboard', () => {
    const open = run([{ type: 'shortcut' }]).s; expect(open).toMatchObject({ mode: 'list', openedBy: 'keyboard' });
    expect(run([{ type: 'shortcut' }], open).s.mode).toBe('handle');
  });
  it('back goes to the list, close to the handle and clears reading', () => {
    const s = run([{ type: 'botClick', id: 'a' }, { type: 'reading', on: true }, { type: 'back' }]).s;
    expect(s.mode).toBe('list');
    expect(run([{ type: 'close' }], s).s).toMatchObject({ mode: 'handle', reading: false });
  });
});

describe('controller timers', () => {
  it('runs the unfold then bubble timers with the spec durations', () => {
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const states: string[] = [];
    const c = createSurfaceController({ onState: s => states.push(s.mode), setTimeout: ((fn: () => void, ms: number) => { timers.push({ ms, fn }); return timers.length; }) as never, clearTimeout: (() => {}) as never });
    c.dispatch({ type: 'ask', id: 'a' });
    expect(timers.at(-1)!.ms).toBe(260); timers.at(-1)!.fn();
    expect(c.state().mode).toBe('bubble');
    expect(timers.at(-1)!.ms).toBe(4000); timers.at(-1)!.fn();
    expect(c.state().mode).toBe('handle');
    c.dispatch({ type: 'edgeEnter' }); expect(timers.at(-1)!.ms).toBe(180);
    c.dispose();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter overlay test geometry machine`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement geometry**

`apps/overlay/src/surface/geometry.ts`:
```ts
export const SIZES = { handleW: 28, bubbleW: 336, bubbleH: 128, listW: 380, sessionW: 420, readingW: 560, rowH: 56, headerH: 56, footerH: 48, margin: 40, stripW: 6, stripH: 60 } as const;
export type Mode = 'handle' | 'bubble' | 'list' | 'session';
export interface Slot { id: string; size: number; center: number }
export interface Layout { top: number; w: number; h: number; slots: Slot[]; handle: { top: number; h: number }; hotZones: Array<{ top: number; h: number }> }

export function slotSizes(n: number): { big: number; small: number; gap: number } {
  return n > 5 ? { big: 18, small: 11, gap: 3 } : { big: 20, small: 12, gap: 5 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function layout(input: { bots: Array<{ id: string; pending: boolean }>; mode: Mode; screenH: number; bubbleId?: string | null; sessionH?: number; reading?: boolean }): Layout {
  const { bots, mode, screenH } = input;
  const n = bots.length; const { big, small, gap } = slotSizes(n);
  const centerY = screenH / 2;
  const maxH = screenH - 2 * SIZES.margin;
  const handleH = n === 0 ? SIZES.stripH : 16 + bots.reduce((a, b) => a + (b.pending ? big : small), 0) + Math.max(0, n - 1) * gap;
  const handleTop = Math.round(centerY - handleH / 2);
  const slots: Slot[] = []; let y = handleTop + 8;
  for (const b of bots) { const size = b.pending ? big : small; slots.push({ id: b.id, size, center: y + size / 2 }); y += size + gap; }
  const hotZones = [{ top: SIZES.margin, h: Math.max(0, handleTop - 6 - SIZES.margin) }, { top: handleTop + handleH + 6, h: Math.max(0, screenH - SIZES.margin - (handleTop + handleH + 6)) }];
  const handle = { top: handleTop, h: handleH };
  if (mode === 'handle') return { top: handleTop, w: n === 0 ? SIZES.stripW : SIZES.handleW, h: handleH, slots, handle, hotZones };
  if (mode === 'bubble') {
    const slot = slots.find(s => s.id === input.bubbleId) ?? slots[0];
    const top = clamp(Math.round((slot?.center ?? centerY) - 38), SIZES.margin, screenH - SIZES.margin - SIZES.bubbleH);
    return { top, w: SIZES.bubbleW, h: SIZES.bubbleH, slots, handle, hotZones };
  }
  const h = Math.min(maxH, mode === 'list' ? SIZES.headerH + 16 + n * SIZES.rowH + SIZES.footerH : (input.sessionH ?? 480));
  const top = clamp(Math.round(centerY - h / 2), SIZES.margin, screenH - SIZES.margin - h);
  const w = mode === 'list' ? SIZES.listW : (input.reading ? SIZES.readingW : SIZES.sessionW);
  return { top, w, h, slots, handle, hotZones };
}
```

- [ ] **Step 4: Implement the machine and the controller**

`apps/overlay/src/surface/machine.ts`:
```ts
import type { Mode } from './geometry';
export type { Mode };
export interface SurfaceState { mode: Mode; selectedId: string | null; bubbleId: string | null; queue: string[]; openedBy: 'mouse' | 'keyboard' | null; hot: boolean; reading: boolean; typing: boolean }
export type TimerName = 'dwell' | 'leave' | 'bubble' | 'hold' | 'unfold';
export type Effect = { type: 'startTimer'; name: TimerName; ms: number } | { type: 'cancelTimer'; name: TimerName };
export type SurfaceEvent =
  | { type: 'ask'; id: string } | { type: 'askCleared'; id: string } | { type: 'removed'; id: string; remaining: string[] }
  | { type: 'edgeEnter' } | { type: 'edgeLeave' } | { type: 'dwellElapsed' } | { type: 'unfoldElapsed' }
  | { type: 'surfaceEnter' } | { type: 'surfaceLeave' } | { type: 'leaveElapsed' }
  | { type: 'botClick'; id: string } | { type: 'rowClick'; id: string } | { type: 'bubbleClick' } | { type: 'bubbleElapsed' }
  | { type: 'decidedInBubble' } | { type: 'holdElapsed' } | { type: 'back' } | { type: 'close' } | { type: 'shortcut' }
  | { type: 'typing'; on: boolean } | { type: 'reading'; on: boolean };

export const TIMERS: Record<TimerName, number> = { dwell: 180, leave: 500, bubble: 4000, hold: 900, unfold: 260 };
export const initialSurface = (): SurfaceState => ({ mode: 'handle', selectedId: null, bubbleId: null, queue: [], openedBy: null, hot: false, reading: false, typing: false });

const start = (name: TimerName, ms = TIMERS[name]): Effect => ({ type: 'startTimer', name, ms });
const cancel = (name: TimerName): Effect => ({ type: 'cancelTimer', name });
const cancelAll: Effect[] = (['dwell', 'leave', 'bubble', 'hold', 'unfold'] as TimerName[]).map(cancel);
const toHandle = (s: SurfaceState): SurfaceState => ({ ...s, mode: 'handle', bubbleId: null, selectedId: null, openedBy: null, hot: false, reading: false, typing: false });
const open = (s: SurfaceState, id: string): { state: SurfaceState; effects: Effect[] } => ({ state: { ...s, mode: 'session', selectedId: id, bubbleId: null, hot: false }, effects: cancelAll });

export function transition(s: SurfaceState, e: SurfaceEvent): { state: SurfaceState; effects: Effect[] } {
  switch (e.type) {
    case 'ask': {
      const queue = s.queue.includes(e.id) ? s.queue : [...s.queue, e.id];
      if (s.mode === 'handle' && !s.hot) return { state: { ...s, queue }, effects: [start('unfold')] };
      return { state: { ...s, queue }, effects: [] };
    }
    case 'unfoldElapsed': {
      if (s.mode !== 'handle' || s.hot || s.queue.length === 0) return { state: s, effects: [] };
      return { state: { ...s, mode: 'bubble', bubbleId: s.queue[0]! }, effects: [start('bubble')] };
    }
    case 'askCleared': {
      const queue = s.queue.filter(id => id !== e.id);
      if (s.mode === 'bubble' && s.bubbleId === e.id) {
        if (queue.length) return { state: { ...s, queue, bubbleId: queue[0]! }, effects: [cancel('bubble'), start('bubble')] };
        return { state: toHandle({ ...s, queue }), effects: [cancel('bubble'), cancel('hold')] };
      }
      return { state: { ...s, queue }, effects: [] };
    }
    case 'removed': {
      const queue = s.queue.filter(id => id !== e.id);
      if (s.mode === 'session' && s.selectedId === e.id) return { state: e.remaining.length ? { ...s, queue, mode: 'list', selectedId: null } : toHandle({ ...s, queue }), effects: cancelAll };
      if (s.mode === 'bubble' && s.bubbleId === e.id) return { state: toHandle({ ...s, queue }), effects: cancelAll };
      return { state: { ...s, queue }, effects: [] };
    }
    case 'edgeEnter': return s.mode === 'handle' && !s.hot ? { state: { ...s, hot: true }, effects: [start('dwell'), cancel('unfold')] } : { state: s, effects: [] };
    case 'edgeLeave': return { state: { ...s, hot: false }, effects: [cancel('dwell')] };
    case 'dwellElapsed': return s.mode === 'handle' && s.hot ? { state: { ...s, mode: 'list', openedBy: 'mouse', hot: false }, effects: [cancel('unfold')] } : { state: s, effects: [] };
    case 'surfaceEnter': return { state: { ...s, hot: false }, effects: [cancel('leave'), cancel('dwell'), ...(s.mode === 'bubble' ? [cancel('bubble')] : [])] };
    case 'surfaceLeave':
      if (s.mode === 'bubble') return { state: s, effects: [start('bubble', 1500)] };
      if (s.mode === 'list' && s.openedBy === 'mouse' && !s.typing) return { state: s, effects: [start('leave')] };
      return { state: s, effects: [] };
    case 'leaveElapsed': return s.mode === 'list' ? { state: toHandle(s), effects: [] } : { state: s, effects: [] };
    case 'botClick': case 'rowClick': return open(s, e.id);
    case 'bubbleClick': return s.bubbleId ? open(s, s.bubbleId) : { state: s, effects: [] };
    case 'bubbleElapsed': return s.mode === 'bubble' ? { state: toHandle(s), effects: [] } : { state: s, effects: [] };
    case 'decidedInBubble': return { state: s, effects: [cancel('bubble'), start('hold')] };
    case 'holdElapsed': return { state: toHandle({ ...s, queue: s.queue.filter(id => id !== s.bubbleId) }), effects: [] };
    case 'back': return s.mode === 'session' ? { state: { ...s, mode: 'list', selectedId: null, reading: false }, effects: [] } : { state: s, effects: [] };
    case 'close': return { state: toHandle(s), effects: cancelAll };
    case 'shortcut': return s.mode === 'handle' ? { state: { ...s, mode: 'list', openedBy: 'keyboard', hot: false }, effects: cancelAll } : { state: toHandle(s), effects: cancelAll };
    case 'typing': return { state: { ...s, typing: e.on }, effects: e.on ? [cancel('leave')] : [] };
    case 'reading': return { state: { ...s, reading: e.on }, effects: [] };
  }
}
```

`apps/overlay/src/surface/controller.ts`:
```ts
import { transition, initialSurface, type SurfaceEvent, type SurfaceState, type TimerName } from './machine';

export function createSurfaceController(opts: { onState: (s: SurfaceState) => void; setTimeout?: typeof globalThis.setTimeout; clearTimeout?: typeof globalThis.clearTimeout }) {
  const setT = opts.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearT = opts.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  let state = initialSurface();
  const timers = new Map<TimerName, ReturnType<typeof setTimeout>>();
  const elapsed: Record<TimerName, SurfaceEvent> = { dwell: { type: 'dwellElapsed' }, leave: { type: 'leaveElapsed' }, bubble: { type: 'bubbleElapsed' }, hold: { type: 'holdElapsed' }, unfold: { type: 'unfoldElapsed' } };
  function dispatch(e: SurfaceEvent) {
    const r = transition(state, e);
    for (const fx of r.effects) {
      const t = timers.get(fx.name); if (t) { clearT(t); timers.delete(fx.name); }
      if (fx.type === 'startTimer') timers.set(fx.name, setT(() => { timers.delete(fx.name); dispatch(elapsed[fx.name]); }, fx.ms));
    }
    if (r.state !== state) { state = r.state; opts.onState(state); }
  }
  return { dispatch, state: () => state, dispose: () => { for (const t of timers.values()) clearT(t); timers.clear(); } };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter overlay test geometry machine`
Expected: PASS, 20 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/overlay/src/surface/geometry.ts apps/overlay/src/surface/machine.ts apps/overlay/src/surface/controller.ts apps/overlay/test/geometry.test.ts apps/overlay/test/machine.test.ts
git commit -m "feat(overlay): pure surface geometry and mode machine with timers"
```

---

### Task 5: UI primitives, Handle and Tooltip

**Files:**
- Create: `apps/overlay/src/ui/Button.tsx`, `apps/overlay/src/ui/Badge.tsx`, `apps/overlay/src/ui/Kbd.tsx`, `apps/overlay/src/surface/Handle.tsx`, `apps/overlay/src/surface/Tooltip.tsx`
- Test: `apps/overlay/test/handle.test.tsx`

**Interfaces:**
- Produces: `<Button variant="primary"|"outline"|"ghost"|"secondary" size="md"|"sm"|"icon" aria-label? onClick>` (36 px, 32 px, 36×36); `<Badge state: BotState>` renders the dot and the word (`Approval`, `Question`, `Running`, `Done`, `Error`, `Read only`) on its soft ground; `<Kbd>Y</Kbd>`; `<Handle bots: HandleBot[] slots: Slot[] big: number visible: boolean hoverId: string|null onHover(id|null) onOpen(id) />` where `HandleBot = { id: string; name: string; tool: Tool; state: BotState; pose: 1|2|3; pending: boolean; tip: string }`; `<Tooltip bot: HandleBot | null; y: number />`.
- Handle rules: quiet bots at `small` (scale `small/big` of a `big` sprite), opacity 0.8 (0.55 for `done` and `readonly`); pending bots at `big`, opacity 1, with a 2 px tick at `left: -4px` in the status color; hover scales ×1.25 with the `pop` curve, background `var(--sidebar-accent)`; `aria-label` "<Name> <label>, open"; a bot that leaves the team collapses its box to 0 with a negative margin so the stack closes smoothly.

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/handle.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Handle } from '../src/surface/Handle';
import { Badge } from '../src/ui/Badge';
import { layout } from '../src/surface/geometry';

const bots = [
  { id: 'a', name: 'Otto', tool: 'claude' as const, state: 'approval' as const, pose: 1 as const, pending: true, tip: 'needs your approval · npm test' },
  { id: 'b', name: 'Pim', tool: 'codex' as const, state: 'working' as const, pose: 2 as const, pending: false, tip: 'reading migrations' },
  { id: 'c', name: 'Lu', tool: 'codex' as const, state: 'done' as const, pose: 1 as const, pending: false, tip: 'exited 0' }
];
const l = layout({ bots: bots.map(b => ({ id: b.id, pending: b.pending })), mode: 'handle', screenH: 1080 });

describe('<Handle>', () => {
  it('renders one button per bot with sizes and ticks by state', () => {
    render(<Handle bots={bots} slots={l.slots} big={20} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const otto = screen.getByRole('button', { name: /Otto needs your approval/ });
    const pim = screen.getByRole('button', { name: /Pim/ });
    expect(otto).toHaveStyle({ width: '20px', opacity: '1' });
    expect(pim).toHaveStyle({ width: '12px', opacity: '0.8' });
    expect(screen.getByRole('button', { name: /Lu/ })).toHaveStyle({ opacity: '0.55' });
    expect(otto.querySelector('[data-tick]')).toHaveStyle({ opacity: '1', background: 'var(--danger-text)' });
    expect(pim.querySelector('[data-tick]')).toHaveStyle({ opacity: '0' });
  });
  it('hover lifts the bot and reports it; click opens it', () => {
    const onHover = vi.fn(), onOpen = vi.fn();
    const { rerender } = render(<Handle bots={bots} slots={l.slots} big={20} visible hoverId={null} onHover={onHover} onOpen={onOpen} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Pim/ }));
    expect(onHover).toHaveBeenCalledWith('b');
    rerender(<Handle bots={bots} slots={l.slots} big={20} visible hoverId="b" onHover={onHover} onOpen={onOpen} />);
    const sprite = screen.getByRole('button', { name: /Pim/ }).querySelector('[data-sprite]')!;
    expect(sprite).toHaveStyle({ transform: `scale(${(12 / 20) * 1.25})` });
    fireEvent.click(screen.getByRole('button', { name: /Pim/ }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });
  it('is inert when not visible', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots} big={20} visible={false} hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
  });
});

describe('<Badge>', () => {
  it('shows the word for each state', () => {
    render(<Badge state="readonly" />); expect(screen.getByText('Read only')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter overlay test handle`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the primitives**

`apps/overlay/src/ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react';
import { transition } from '../motion';
type Variant = 'primary' | 'outline' | 'ghost' | 'secondary';
const styles: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--primary)', color: 'var(--primary-foreground)', border: '1px solid transparent' },
  outline: { background: 'transparent', color: 'var(--sidebar-foreground)', border: '1px solid var(--input)' },
  ghost: { background: 'transparent', color: 'var(--muted-foreground)', border: '1px solid transparent' },
  secondary: { background: 'var(--secondary)', color: 'var(--secondary-foreground)', border: '1px solid var(--border)' }
};
export function Button({ variant = 'outline', size = 'md', style, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' | 'icon' }) {
  const dims = size === 'icon' ? { width: 36, height: 36, padding: 0 } : size === 'sm' ? { height: 32, padding: '0 12px' } : { height: 36, padding: '0 16px' };
  return (
    <button type="button" {...rest} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 'var(--radius-md)', fontSize: size === 'sm' ? 13 : 14, fontWeight: 500, cursor: 'pointer', transition: transition([['background-color', 'hover'], ['color', 'hover'], ['border-color', 'hover'], ['transform', 'hover']]), ...dims, ...styles[variant], ...style }}>
      {children}
    </button>
  );
}
```

`apps/overlay/src/ui/Badge.tsx`:
```tsx
import type { BotState } from '../bots/poseFor';
import { transition } from '../motion';
export const BADGE: Record<BotState, { bg: string; fg: string; word: string; pulse?: boolean }> = {
  approval: { bg: 'var(--status-danger-soft)', fg: 'var(--danger-text)', word: 'Approval' },
  question: { bg: 'var(--status-warning-soft)', fg: 'var(--warning)', word: 'Question' },
  working: { bg: 'var(--status-info-soft)', fg: 'var(--info)', word: 'Running', pulse: true },
  done: { bg: 'var(--status-success-soft)', fg: 'var(--success)', word: 'Done' },
  error: { bg: 'var(--status-danger-soft)', fg: 'var(--danger-text)', word: 'Error' },
  readonly: { bg: 'transparent', fg: 'var(--muted-foreground)', word: 'Read only' }
};
export function Badge({ state, label }: { state: BotState; label?: string }) {
  const b = BADGE[state];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 20, padding: '0 8px', borderRadius: 9999, background: b.bg, color: b.fg, border: state === 'readonly' ? '1px solid var(--border)' : '1px solid transparent', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', transition: transition([['background-color', 'hover'], ['color', 'hover']]) }}>
      <span style={{ width: 8, height: 8, borderRadius: 9999, background: 'currentColor', animation: b.pulse ? 'ledge-blink 1.2s ease-in-out infinite' : undefined }} />
      {label ?? b.word}
    </span>
  );
}
```

`apps/overlay/src/ui/Kbd.tsx`:
```tsx
export function Kbd({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 5, border: `1px solid ${accent ? 'transparent' : 'var(--input)'}`, background: accent ? 'var(--primary-hover)' : 'var(--sidebar)', fontSize: 11, lineHeight: 1, fontWeight: 500, color: accent ? 'var(--primary-foreground)' : 'var(--sidebar-foreground)' }}>{children}</span>;
}
```

- [ ] **Step 4: Implement the Handle and the Tooltip**

`apps/overlay/src/surface/Handle.tsx`:
```tsx
import type { Tool } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import type { BotState } from '../bots/poseFor';
import { BADGE } from '../ui/Badge';
import { transition } from '../motion';
import type { Slot } from './geometry';
import { slotSizes } from './geometry';

export interface HandleBot { id: string; name: string; tool: Tool; state: BotState; pose: 1 | 2 | 3; pending: boolean; tip: string }
const LABEL: Record<BotState, string> = { approval: 'needs your approval', question: 'has a question', working: 'working', done: 'done', error: 'error', readonly: 'read only' };

export function Handle({ bots, slots, big, visible, hoverId, onHover, onOpen, theme = 'dark' }: { bots: HandleBot[]; slots: Slot[]; big: number; visible: boolean; hoverId: string | null; onHover: (id: string | null) => void; onOpen: (id: string) => void; theme?: 'dark' | 'light' }) {
  const { small, gap } = slotSizes(bots.length);
  return (
    <div data-layer="handle" style={{ position: 'absolute', left: 0, top: 0, width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap, padding: '8px 0', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 200 : 0]]) }}>
      {bots.map(b => {
        const on = slots.some(s => s.id === b.id);
        const size = b.pending ? big : small;
        const base = b.pending ? 1 : small / big;
        const hov = hoverId === b.id;
        const quiet = b.state === 'done' || b.state === 'readonly';
        return (
          <button key={b.id} type="button" aria-label={`${b.name} ${LABEL[b.state]}, open`} onClick={() => onOpen(b.id)} onMouseEnter={() => onHover(b.id)} onMouseLeave={() => onHover(null)}
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: 9999, cursor: 'pointer', background: hov ? 'var(--sidebar-accent)' : 'transparent', width: on ? size : 0, height: on ? size : 0, marginTop: on ? 0 : -gap, opacity: !on ? 0 : hov || b.pending ? 1 : quiet ? 0.55 : 0.8,
              transition: transition([['width', 'grow', 0], ['height', 'grow', 0], ['margin-top', 'grow', 0], ['opacity', 'fadeIn', on ? 80 : 0], ['background-color', 'hover']]) }}>
            <span data-tick style={{ position: 'absolute', left: -4, top: 2, bottom: 2, width: 2, borderRadius: '0 2px 2px 0', background: BADGE[b.state].fg, opacity: b.pending ? 1 : 0, transition: transition([['opacity', 'fadeIn', b.pending ? 160 : 0], ['background-color', 'hover']]) }} />
            <span data-sprite style={{ display: 'inline-flex', lineHeight: 0, transform: `scale(${hov ? base * 1.25 : base})`, transition: transition([['transform', b.pending || hov ? 'pop' : 'shrink', 0]]) }}>
              <Bot tool={b.tool} state={b.state} pose={b.pose} size={big} theme={theme} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

`apps/overlay/src/surface/Tooltip.tsx`:
```tsx
import type { HandleBot } from './Handle';
import { transition } from '../motion';
export function Tooltip({ bot, y }: { bot: HandleBot | null; y: number }) {
  const on = bot !== null;
  return (
    <div role="tooltip" aria-hidden={!on} style={{ position: 'absolute', left: 36, top: y, transform: `translateY(-50%) translateX(${on ? 0 : -6}px)`, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: '16px', boxShadow: 'var(--shadow-overlay)', opacity: on ? 1 : 0, pointerEvents: 'none', transition: transition([['opacity', 'hover', 60], ['transform', 'grow', 60], ['top', 'hover']]) }}>
      <span><span style={{ fontWeight: 500 }}>{bot?.name}</span> <span style={{ color: 'var(--muted-foreground)' }}>· {bot?.tip}</span></span>
      <span className="mono" style={{ fontSize: 10, padding: '1px 5px', border: '1px solid var(--input)', borderRadius: 4, color: 'var(--muted-foreground)' }}>click to open</span>
    </div>
  );
}
```

Add to `base.css`: `@keyframes ledge-blink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter overlay test handle`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/overlay/src/ui apps/overlay/src/surface/Handle.tsx apps/overlay/src/surface/Tooltip.tsx apps/overlay/src/styles/base.css apps/overlay/test/handle.test.tsx
git commit -m "feat(overlay): button, badge, kbd primitives, the handle and its tooltip"
```

---

### Task 6: Bubble

**Files:**
- Create: `apps/overlay/src/surface/Bubble.tsx`
- Test: `apps/overlay/test/bubble.test.tsx`

**Interfaces:**
- Produces: `<Bubble session: Session | null; moreCount: number; visible: boolean; paused: boolean; onOpen(); onDecide(decision: 'accept' | 'deny'); onReply(text: string) />`. Content: the bot at 48 px, "<Name> needs your approval" / "<Name> has a question", the ask in mono with the project, a chevron, then the action row: for a permission `Deny` (outline, sm) and `Approve` (primary, sm, check icon); for a question `Later` and `Answer: <first option>` (sends `onReply('1')`); a 2 px timer bar that goes from 100% to 0% over 4 s (`transition: width 4000ms linear`, paused by setting the width to its current computed value is not needed: when `paused` the bar simply keeps `width: 100%` styling via a `data-paused` attribute and the controller already cancelled the timer); "+N more" under the ask when `moreCount > 0`.
- The decision buttons call `onDecide` once and then disable themselves (the parent holds the bubble 900 ms).

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/bubble.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Bubble } from '../src/surface/Bubble';
import { fakeSession } from './mockDaemon';

const perm = fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } });
const q = fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow'], source: 'hook' } });

describe('<Bubble>', () => {
  it('speaks in the bot name and offers Deny/Approve for a permission', () => {
    const onDecide = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={onDecide} onReply={() => {}} />);
    expect(screen.getByText('Otto needs your approval')).toBeInTheDocument();
    expect(screen.getByText(/npm test · harness-assistant/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('accept');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
  it('offers Later and the first option for a question, and shows +N more', () => {
    const onReply = vi.fn();
    render(<Bubble session={q} moreCount={2} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={onReply} />);
    expect(screen.getByText('Pim has a question')).toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Answer: Backfill' }));
    expect(onReply).toHaveBeenCalledWith('1');
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
  });
  it('clicking the text opens the session', () => {
    const onOpen = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={onOpen} onDecide={() => {}} onReply={() => {}} />);
    fireEvent.click(screen.getByRole('link', { name: /Otto needs your approval/ }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('the timer bar runs when visible and not paused', () => {
    const { container, rerender } = render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toHaveStyle({ width: '0%' });
    rerender(<Bubble session={perm} moreCount={0} visible paused onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter overlay test bubble`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/overlay/src/surface/Bubble.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Button } from '../ui/Button';
import { transition, ms } from '../motion';

export function Bubble({ session, moreCount, visible, paused, onOpen, onDecide, onReply, theme = 'dark' }: { session: Session | null; moreCount: number; visible: boolean; paused: boolean; onOpen: () => void; onDecide: (d: 'accept' | 'deny') => void; onReply: (text: string) => void; theme?: 'dark' | 'light' }) {
  const [decided, setDecided] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => { setDecided(false); setArmed(false); if (visible) { const t = setTimeout(() => setArmed(true), 60); return () => clearTimeout(t); } }, [visible, session?.id]);
  const st = session ? botState(session) : 'working';
  const isQ = session?.pending?.kind === 'question';
  const first = session?.pending?.options?.[0];
  const title = session ? `${session.name} ${isQ ? 'has a question' : 'needs your approval'}` : '';
  return (
    <div data-layer="bubble" style={{ position: 'absolute', left: 0, top: 0, width: 336, height: 128, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 12px', opacity: visible ? 1 : 0, transform: `translateX(${visible ? 0 : -12}px)`, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut'], ['transform', visible ? 'grow' : 'fadeOut', visible ? 140 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {session && <Bot tool={session.tool} state={st} pose={poseFor(session.name, session.state)} size={48} theme={theme} />}
        <a href="#open" onClick={e => { e.preventDefault(); onOpen(); }} style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
          <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>{title}</span>
          <span className="mono" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session?.pending?.text} · {session?.project}{moreCount > 0 && <span> · +{moreCount} more</span>}</span>
        </a>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="outline" size="sm" disabled={decided} onClick={() => { setDecided(true); isQ ? onOpen() : onDecide('deny'); }}>{isQ ? 'Later' : 'Deny'}</Button>
        <Button variant="primary" size="sm" disabled={decided} onClick={() => { setDecided(true); isQ ? onReply('1') : onDecide('accept'); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {isQ ? `Answer: ${first ?? 'first option'}` : 'Approve'}
        </Button>
      </div>
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 0, height: 2, borderRadius: 9999, background: 'var(--muted)', overflow: 'hidden' }}>
        <div data-timer data-paused={paused ? 'true' : 'false'} style={{ width: armed && !paused ? '0%' : '100%', height: '100%', background: 'var(--ring)', transition: armed && !paused ? `width ${ms(4000)} linear` : 'none' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test bubble`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/surface/Bubble.tsx apps/overlay/test/bubble.test.tsx
git commit -m "feat(overlay): bubble with decide-in-place and the draining timer bar"
```

---

### Task 7: Session list

**Files:**
- Create: `apps/overlay/src/surface/SessionList.tsx`
- Test: `apps/overlay/test/list.test.tsx`

**Interfaces:**
- Produces: `<SessionList sessions: Session[]; visible: boolean; numbered: boolean; selectedId: string | null; dnd: boolean; onToggleDnd(); onOpen(id); onClose(); onHoverRow?(id|null) theme? />`. Header: "Ledge", "<N> bots · <M> waiting for you" or "nothing waiting", buttons `Do not disturb` (icon, `aria-pressed`), `Settings` (icon, no-op in V1), `Collapse` (icon). Rows: 56 px, bot at 32 px, project, "<Name> · <Tool> · <age> · <hint>", `Badge`; the oldest pending row has `background: var(--secondary)` and a 2 px `var(--sidebar-primary)` leading bar; `numbered` adds a `Kbd` with the row index (1 to 9) at the left; rows cascade in: `opacity`/`translateX(-10px)` with `fadeIn` delayed `150 + i*24` ms when `visible`. Footer: the DND switch (a `label` + hidden checkbox) and `Ctrl+Alt+L`. The row hint is the pending text when pending, else `started without ledge` for `hook_only`, `exited <code>` for exited, `running` otherwise.

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/list.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SessionList } from '../src/surface/SessionList';
import { fakeSession } from './mockDaemon';

const sessions = [
  fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }),
  fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z' }),
  fakeSession('c', { name: 'Bix', source: 'hook_only', tmuxSession: null, startedAt: '2026-10-09T18:02:00.000Z' }),
  fakeSession('d', { name: 'Lu', state: 'exited', exitCode: 0, startedAt: '2026-10-09T18:03:00.000Z' })
];

describe('<SessionList>', () => {
  it('shows counts, rows with badges, and highlights the oldest ask', () => {
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.getByText('4 bots · 1 waiting for you')).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveStyle({ background: 'var(--secondary)', borderLeftColor: 'var(--sidebar-primary)' });
    expect(within(rows[0]!).getByText('Approval')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/started without ledge/)).toBeInTheDocument();
    expect(within(rows[3]!).getByText(/exited 0/)).toBeInTheDocument();
  });
  it('numbers rows when opened from the keyboard', () => {
    render(<SessionList sessions={sessions} visible numbered selectedId="b" dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /speos-api/ })).toHaveAttribute('aria-current', 'true');
  });
  it('clicks open a row, toggle dnd and collapse', () => {
    const onOpen = vi.fn(), onToggleDnd = vi.fn(), onClose = vi.fn();
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd onToggleDnd={onToggleDnd} onOpen={onOpen} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /speos-api/ })); expect(onOpen).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByLabelText('Do not disturb')); expect(onToggleDnd).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Do not disturb' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' })); expect(onClose).toHaveBeenCalled();
  });
  it('rows cascade with increasing delays', () => {
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows[0]!.style.transition).toContain('0ms');
    expect(rows[0]!.getAttribute('data-delay')).toBe('150');
    expect(rows[3]!.getAttribute('data-delay')).toBe('222');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter overlay test list`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/overlay/src/surface/SessionList.tsx`:
```tsx
import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { relativeTime, toolName } from '../format';
import { transition } from '../motion';

const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
export function rowHint(s: Session): string {
  if (s.pending) return s.pending.text;
  if (s.source === 'hook_only') return 'started without ledge';
  if (s.state === 'exited') return `exited ${s.exitCode ?? '?'}`;
  if (s.state === 'error') return s.lastError ?? 'error';
  return 'running';
}
const Icon = ({ d }: { d: string[] }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d.map((p, i) => <path key={i} d={p} />)}</svg>;
const BELL_OFF = ['M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5', 'M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7', 'M10.3 21a1.94 1.94 0 0 0 3.4 0', 'm2 2 20 20'];
const SLIDERS = ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'];
const CHEVRON_LEFT = ['m15 18-6-6 6-6'];

export function SessionList({ sessions, visible, numbered, selectedId, dnd, onToggleDnd, onOpen, onClose, onHoverRow, theme = 'dark', now = Date.now() }: { sessions: Session[]; visible: boolean; numbered: boolean; selectedId: string | null; dnd: boolean; onToggleDnd: () => void; onOpen: (id: string) => void; onClose: () => void; onHoverRow?: (id: string | null) => void; theme?: 'dark' | 'light'; now?: number }) {
  const waiting = sessions.filter(isPending).length;
  const oldestAsk = sessions.find(isPending)?.id ?? null;
  return (
    <div data-layer="list" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 120 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56, boxSizing: 'border-box', padding: '0 8px 0 16px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: 16, lineHeight: '20px', fontWeight: 600, letterSpacing: '-0.01em' }}>Ledge</span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{sessions.length} bots · {waiting ? `${waiting} waiting for you` : 'nothing waiting'}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Do not disturb" aria-pressed={dnd} onClick={onToggleDnd} style={{ color: dnd ? 'var(--sidebar-primary)' : undefined }}><Icon d={BELL_OFF} /></Button>
        <Button variant="ghost" size="icon" aria-label="Settings"><Icon d={SLIDERS} /></Button>
        <Button variant="ghost" size="icon" aria-label="Collapse" onClick={onClose}><Icon d={CHEVRON_LEFT} /></Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', flexGrow: 1, overflowY: 'auto' }}>
        {sessions.map((s, i) => {
          const pending = isPending(s); const hi = s.id === oldestAsk; const delay = 150 + i * 24;
          return (
            <button key={s.id} type="button" aria-label={`${s.project}, ${s.name}, open`} aria-current={selectedId === s.id ? 'true' : undefined} data-delay={delay} onClick={() => onOpen(s.id)} onMouseEnter={() => onHoverRow?.(s.id)} onMouseLeave={() => onHoverRow?.(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, height: 56, boxSizing: 'border-box', padding: `0 16px 0 ${numbered ? 10 : 14}px`, border: 'none', borderLeft: `2px solid ${hi ? 'var(--sidebar-primary)' : 'transparent'}`, background: hi ? 'var(--secondary)' : selectedId === s.id ? 'var(--sidebar-accent)' : 'transparent', textAlign: 'left', color: 'var(--sidebar-foreground)', cursor: 'pointer', width: '100%', opacity: visible ? 1 : 0, transform: `translateX(${visible ? 0 : -10}px)`,
                transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? delay : 0], ['transform', visible ? 'grow' : 'fadeOut', visible ? delay : 0], ['background-color', 'hover'], ['border-color', 'hover']]) }}>
              {numbered && i < 9 && <Kbd accent={hi}>{i + 1}</Kbd>}
              <Bot tool={s.tool} state={botState(s)} pose={poseFor(s.name, s.state)} size={32} theme={theme} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.project}</span>
                <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name} · {toolName(s.tool)} · {relativeTime(s.startedAt, now)} · {rowHint(s)}</span>
              </span>
              <Badge state={botState(s)} />
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 48, boxSizing: 'border-box', padding: '0 16px', borderTop: '1px solid var(--sidebar-border)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted-foreground)', cursor: 'pointer' }}>
          <input type="checkbox" checked={dnd} onChange={onToggleDnd} aria-label="Do not disturb" style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
          <span style={{ display: 'inline-block', width: 32, height: 18, borderRadius: 9999, background: dnd ? 'var(--sidebar-primary)' : 'var(--muted)', border: '1px solid var(--input)', boxSizing: 'border-box', position: 'relative', transition: transition([['background-color', 'hover']]) }}>
            <span style={{ position: 'absolute', left: dnd ? 16 : 2, top: 2, width: 12, height: 12, borderRadius: 9999, background: dnd ? 'var(--primary-foreground)' : 'var(--muted-foreground)', transition: transition([['left', 'hover']]) }} />
          </span>
          Do not disturb
        </label>
        <span style={{ flexGrow: 1 }} />
        <Kbd>Ctrl+Alt+L</Kbd>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test list`
Expected: PASS, 4 tests. (`getByLabelText('Do not disturb')` resolves the checkbox; the icon button is reached by role.)

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/surface/SessionList.tsx apps/overlay/test/list.test.tsx
git commit -m "feat(overlay): session list with cascade, oldest-ask highlight and dnd"
```

---

### Task 8: Session view (permission, question, preview, reply)

**Files:**
- Create: `apps/overlay/src/surface/SessionView.tsx`
- Test: `apps/overlay/test/session.test.tsx`

**Interfaces:**
- Produces: `<SessionView session: Session; preview: string[]; visible: boolean; reading: boolean; draft: string; onDraft(text); onBack(); onClose(); onDecide(d); onReply(text); onInterrupt(); onKill(); onFocus(); onToggleReading() theme? />` and `measureSessionH(session, reading): number` (header 56 + ask card (permission 168 / question 48 + 64 per option + 56) + preview 240 + reply 100; used by the surface for the panel height, capped by geometry).
- Behaviour: header with Back, the bot at 32 px, "<Name> · <project>", "<Tool> · <age>", `Reading mode` toggle (icon, `aria-pressed`), `Focus terminal tab` (icon), `Close` (icon). Ask card folds (`max-height` + opacity, shrink curve, 80 ms delay) when `session.pending` disappears. Permission: badge, "<Name> wants to run", the command in a mono well, `Always for this session` (ghost sm, V1: sends `accept` too), `Deny`, `Approve`. Question: badge, the question, radio options with the first checked, an `Other…` text input, `Answer` (primary) which sends the option number or the typed text. Preview: "Terminal · last 30 lines · read only", a mono well with the lines. Reply: input bound to `draft` (lives in the parent so it survives reconnects), `Enter` sends, `Send` icon button, "Interrupt" (outline sm, shows `Esc` kbd) when `working`, `Kill session` (ghost sm, danger text) always. `error` state shows the badge `Error` and the text "the terminal did not take it, try again or open the tab" above the actions, buttons enabled.

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/session.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionView, measureSessionH } from '../src/surface/SessionView';
import { fakeSession } from './mockDaemon';

const perm = fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } });
const q = fakeSession('b', { name: 'Pim', tool: 'codex', state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow table'], source: 'hook' } });
const base = { preview: ['● Bash(npm test)', 'Do you want to proceed?'], visible: true, reading: false, draft: '', onDraft: () => {}, onBack: () => {}, onClose: () => {}, onDecide: () => {}, onReply: () => {}, onInterrupt: () => {}, onKill: () => {}, onFocus: () => {}, onToggleReading: () => {} };

describe('<SessionView>', () => {
  it('shows a permission card and sends the decision', () => {
    const onDecide = vi.fn();
    render(<SessionView {...base} session={perm} onDecide={onDecide} />);
    expect(screen.getByText('Otto wants to run')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' })); expect(onDecide).toHaveBeenCalledWith('deny');
    expect(screen.getByText('Do you want to proceed?')).toBeInTheDocument();
  });
  it('shows a question with options and answers by number or text', () => {
    const onReply = vi.fn();
    render(<SessionView {...base} session={q} onReply={onReply} />);
    fireEvent.click(screen.getByLabelText('Shadow table'));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' })); expect(onReply).toHaveBeenLastCalledWith('2');
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.change(screen.getByPlaceholderText('Other…'), { target: { value: 'dual write' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' })); expect(onReply).toHaveBeenLastCalledWith('dual write');
  });
  it('the ask card folds when pending disappears', () => {
    const { rerender, container } = render(<SessionView {...base} session={perm} />);
    expect(container.querySelector('[data-ask]')).toHaveStyle({ maxHeight: '260px', opacity: '1' });
    rerender(<SessionView {...base} session={{ ...perm, state: 'working', pending: undefined }} />);
    expect(container.querySelector('[data-ask]')).toHaveStyle({ maxHeight: '0px', opacity: '0' });
  });
  it('reply field is controlled by the parent draft and sends on Enter', () => {
    const onReply = vi.fn(), onDraft = vi.fn();
    render(<SessionView {...base} session={{ ...perm, state: 'working', pending: undefined }} draft="keep going" onDraft={onDraft} onReply={onReply} />);
    const input = screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement;
    expect(input.value).toBe('keep going');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onReply).toHaveBeenCalledWith('keep going');
    fireEvent.change(input, { target: { value: 'x' } }); expect(onDraft).toHaveBeenCalledWith('x');
  });
  it('error state explains and keeps the buttons enabled; working state offers Interrupt', () => {
    render(<SessionView {...base} session={{ ...perm, state: 'error', lastError: 'the terminal did not take it' }} />);
    expect(screen.getByText(/did not take it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    render(<SessionView {...base} session={{ ...perm, state: 'working', pending: undefined }} />);
    expect(screen.getByRole('button', { name: /Interrupt/ })).toBeInTheDocument();
  });
  it('measures a sensible height', () => {
    expect(measureSessionH(perm, false)).toBe(56 + 168 + 240 + 100);
    expect(measureSessionH(q, false)).toBe(56 + 48 + 2 * 64 + 56 + 240 + 100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter overlay test session`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/overlay/src/surface/SessionView.tsx`:
```tsx
import { useState } from 'react';
import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { relativeTime, toolName } from '../format';
import { transition } from '../motion';

const Icon = ({ d, size = 16 }: { d: string[]; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d.map((p, i) => <path key={i} d={p} />)}</svg>;
const I = { back: ['m15 18-6-6 6-6'], close: ['M18 6 6 18', 'm6 6 12 12'], ext: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'], expand: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'], check: ['M20 6 9 17l-5-5'], send: ['M22 2 11 13', 'm22 2-7 20-4-9-9-4 20-7z'], stop: ['M6 6h12v12H6z'] };
const well: React.CSSProperties = { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13, lineHeight: '20px', padding: '8px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' };

export function measureSessionH(s: Session, reading: boolean): number {
  const ask = !s.pending ? 0 : s.pending.kind === 'question' ? 48 + (s.pending.options?.length ?? 0) * 64 + 56 : 168;
  return 56 + ask + (reading ? 480 : 240) + 100;
}

export function SessionView(p: { session: Session; preview: string[]; visible: boolean; reading: boolean; draft: string; onDraft: (t: string) => void; onBack: () => void; onClose: () => void; onDecide: (d: 'accept' | 'deny') => void; onReply: (t: string) => void; onInterrupt: () => void; onKill: () => void; onFocus: () => void; onToggleReading: () => void; theme?: 'dark' | 'light'; now?: number }) {
  const { session: s, visible } = p;
  const [choice, setChoice] = useState<number | 'other'>(0);
  const [other, setOther] = useState('');
  const pending = s.pending; const isQ = pending?.kind === 'question';
  const st = botState(s);
  return (
    <div data-layer="session" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 120 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56, boxSizing: 'border-box', padding: '0 8px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <Button variant="ghost" size="icon" aria-label="Back to sessions" onClick={p.onBack}><Icon d={I.back} /></Button>
        <Bot tool={s.tool} state={st} pose={poseFor(s.name, s.state)} size={32} theme={p.theme ?? 'dark'} />
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name} · {s.project}</span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{toolName(s.tool)} · {relativeTime(s.startedAt, p.now)}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Reading mode" aria-pressed={p.reading} onClick={p.onToggleReading}><Icon d={I.expand} /></Button>
        <Button variant="ghost" size="icon" aria-label="Focus the terminal tab" onClick={p.onFocus}><Icon d={I.ext} /></Button>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={p.onClose}><Icon d={I.close} /></Button>
      </div>

      <div data-ask style={{ maxHeight: pending ? 260 + (pending.options?.length ?? 0) * 64 : 0, opacity: pending ? 1 : 0, overflow: 'hidden', transition: transition([['max-height', 'shrink', 80], ['opacity', 'fadeOut']]) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderBottom: '1px solid var(--sidebar-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Badge state={st === 'error' ? 'error' : isQ ? 'question' : 'approval'} label={st === 'error' ? 'Error' : isQ ? 'Question' : 'Approval needed'} />{s.state === 'error' && <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{s.lastError ?? 'the terminal did not take it'}, try again or open the tab</span>}</div>
          {isQ ? (
            <>
              <div style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600 }}>{pending!.text}</div>
              <fieldset style={{ margin: 0, padding: 0, border: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Options</legend>
                {(pending!.options ?? []).map((o, i) => (
                  <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: `1px solid ${choice === i ? 'var(--sidebar-primary)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: choice === i ? 'var(--secondary)' : 'transparent', cursor: 'pointer', transition: transition([['border-color', 'hover'], ['background-color', 'hover']]) }}>
                    <input type="radio" name="opt" checked={choice === i} onChange={() => setChoice(i)} /> <span style={{ fontWeight: 500 }}>{o}</span>
                  </label>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', border: `1px solid ${choice === 'other' ? 'var(--sidebar-primary)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)' }}>
                  <input type="radio" name="opt" aria-label="Other" checked={choice === 'other'} onChange={() => setChoice('other')} />
                  <input type="text" placeholder="Other…" value={other} onChange={e => { setOther(e.target.value); setChoice('other'); }} style={{ flexGrow: 1, height: 28, background: 'transparent', color: 'inherit', border: 'none', outline: 'none', fontSize: 14 }} />
                </label>
              </fieldset>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="primary" onClick={() => p.onReply(choice === 'other' ? other : String(choice + 1))}>Answer</Button></div>
            </>
          ) : (
            <>
              <div>{s.name} wants to run</div>
              <div style={well}>{pending?.text}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button variant="ghost" size="sm" onClick={() => p.onDecide('accept')}>Always for this session</Button>
                <span style={{ flexGrow: 1 }} />
                <Button variant="outline" onClick={() => p.onDecide('deny')}>Deny</Button>
                <Button variant="primary" onClick={() => p.onDecide('accept')}><Icon d={I.check} />Approve</Button>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px 0', flexGrow: 1, minHeight: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)' }}>Terminal · last 30 lines · read only</span>
        <pre className="mono" style={{ ...well, flexGrow: 1, minHeight: 0, margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.preview.join('\n')}</pre>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="text" placeholder={`Reply to ${s.name}…`} value={p.draft} onChange={e => p.onDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && p.draft.trim()) p.onReply(p.draft); }} style={{ flexGrow: 1, minWidth: 0, height: 36, boxSizing: 'border-box', padding: '0 12px', background: 'var(--sidebar)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 14 }} />
          <Button variant="secondary" size="icon" aria-label="Send" onClick={() => p.draft.trim() && p.onReply(p.draft)}><Icon d={I.send} /></Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
          <span>Enter sends to the terminal as typed</span><span style={{ flexGrow: 1 }} />
          {s.state === 'working' && <Button variant="outline" size="sm" onClick={p.onInterrupt}><Icon d={I.stop} size={14} />Interrupt <Kbd>Esc</Kbd></Button>}
          <Button variant="ghost" size="sm" onClick={p.onKill} style={{ color: 'var(--danger-text)' }}>Kill session</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test session`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/surface/SessionView.tsx apps/overlay/test/session.test.tsx
git commit -m "feat(overlay): session view with permission and question cards, preview and reply"
```

---

### Task 9: The living surface and the end-to-end flow against the mock daemon

**Files:**
- Create: `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/tauri/bridge.ts`
- Modify: `apps/overlay/src/App.tsx`
- Test: `apps/overlay/test/surface.test.tsx`

**Interfaces:**
- Produces: `<Surface screenH: number; theme; client: DaemonClient; dnd: boolean; onToggleDnd() />` which owns the surface controller, derives bots from `useDaemon()`, computes `layout(...)`, renders ONE absolutely positioned `div[data-surface]` with `top/width/height` from the layout and `transition` = `grow` when the area grows, `shrink` otherwise, and the four layers inside: `Handle`, `Bubble`, `SessionList`, `SessionView` (the panel layers share a `div[data-panel]` whose list/session children slide ±28 px and crossfade). The hot zones are two `div[data-hotzone]` outside the surface. The tooltip is outside too, at the hovered slot's centre. The `drafts: Record<id, string>` map lives in `Surface` state.
- Daemon-driven surface events: on every store change, for each session that became pending → `dispatch({ type: 'ask', id })` unless `dnd`; became non-pending → `askCleared`; removed → `removed` with the remaining ids.
- Commands: Approve/Deny → `client.send({ type: 'session.decide' })`; reply → `session.reply` and clear the draft; interrupt → `session.interrupt`; kill → `session.kill`; focus → `bridge.focusTerminal(session.title)` and `session.focus`.
- `bridge.ts`: `setFrame(f: { top: number; w: number; h: number }): void`, `focusTerminal(title: string): Promise<void>`, `onShortcut(fn): () => void`, `screenHeight(): Promise<number>`; every function detects `window.__TAURI_INTERNALS__` and is a no-op (returning `window.innerHeight`) in the browser and in tests.

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/surface.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';

let mock: Awaited<ReturnType<typeof createMockDaemon>>; let client: ReturnType<typeof createDaemonClient>;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  daemonStore.reset(); mock = await createMockDaemon();
  mock.sessions.set('a', fakeSession('a')); mock.sessions.set('b', fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z' }));
  client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); attachClient(client); client.connect();
  await sleep(100);
});
afterEach(async () => { client.close(); await mock.close(); vi.useRealTimers(); });

const surface = () => document.querySelector('[data-surface]') as HTMLElement;

describe('<Surface>', () => {
  it('starts as the handle sized to the team', () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    expect(surface()).toHaveStyle({ width: '28px' });
    expect(screen.getAllByRole('button', { name: /open$/ })).toHaveLength(2);
  });

  it('an ask grows the bot, unfolds the bubble at its slot, approve sends the decision, then it folds back', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } })); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '28px' });
    await act(async () => { vi.advanceTimersByTime(260); });
    expect(surface()).toHaveStyle({ width: '336px', height: '128px' });
    expect(screen.getByText('Pim needs your approval')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.decide', id: 'b', decision: 'accept' }));
    await act(async () => { mock.upsert(fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z', state: 'working' })); await sleep(50); vi.advanceTimersByTime(900); });
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('edge hover opens the list, clicking a row opens the session, back and close shrink', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(document.querySelectorAll('[data-hotzone]')[0]!);
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveStyle({ width: '380px' });
    fireEvent.click(screen.getByRole('button', { name: /speos-api/ }));
    expect(surface()).toHaveStyle({ width: '420px' });
    expect(screen.getByText('Pim · speos-api')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(surface()).toHaveStyle({ width: '380px' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('a removed session that is open falls back to the list', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    expect(surface()).toHaveStyle({ width: '420px' });
    await act(async () => { mock.remove('a'); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '380px' });
    expect(screen.queryByText('Otto · harness-assistant')).not.toBeInTheDocument();
  });

  it('a draft survives a daemon disconnect and the session stays open', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    fireEvent.change(screen.getByPlaceholderText('Reply to Otto…'), { target: { value: 'keep going' } });
    const port = mock.port; await act(async () => { await mock.close(); await sleep(80); });
    expect(screen.getByText(/daemon unreachable/)).toBeInTheDocument();
    expect(surface()).toHaveStyle({ width: '420px' });
    mock = await createMockDaemon({ port }); mock.sessions.set('a', fakeSession('a'));
    await act(async () => { vi.advanceTimersByTime(2500); await sleep(100); });
    expect((screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement).value).toBe('keep going');
  });

  it('dnd suppresses the bubble but the bot still grows', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(fakeSession('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })); await sleep(50); vi.advanceTimersByTime(300); });
    expect(surface()).toHaveStyle({ width: '28px' });
    expect(screen.getByRole('button', { name: /Otto has a question, open/ })).toHaveStyle({ width: '20px' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter overlay test surface`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the bridge**

`apps/overlay/src/tauri/bridge.ts`:
```ts
const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export async function screenHeight(): Promise<number> {
  if (!inTauri()) return window.innerHeight;
  const { currentMonitor } = await import('@tauri-apps/api/window');
  const m = await currentMonitor();
  return m ? Math.round(m.size.height / m.scaleFactor) : window.innerHeight;
}
let last = '';
export function setFrame(f: { top: number; w: number; h: number }): void {
  if (!inTauri()) return;
  const key = `${f.top}:${f.w}:${f.h}`; if (key === last) return; last = key;
  import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_frame', { top: f.top, width: f.w, height: f.h })).catch(() => {});
}
export async function focusTerminal(title: string): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('focus_terminal', { title }).catch(() => {});
}
export function onShortcut(fn: () => void): () => void {
  if (!inTauri()) { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') fn(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }
  let off = () => {};
  import('@tauri-apps/plugin-global-shortcut').then(async ({ register, unregister }) => { await register('Ctrl+Alt+L', e => { if (e.state === 'Pressed') fn(); }); off = () => { unregister('Ctrl+Alt+L'); }; }).catch(() => {});
  return () => off();
}
```

- [ ] **Step 4: Implement the Surface**

`apps/overlay/src/surface/Surface.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@ledge/protocol';
import { useDaemon } from '../daemon/store';
import type { DaemonClient } from '../daemon/client';
import { botState, poseFor } from '../bots/poseFor';
import { layout, slotSizes, SIZES, type Mode } from './geometry';
import { createSurfaceController } from './controller';
import { initialSurface, type SurfaceState } from './machine';
import { Handle, type HandleBot } from './Handle';
import { Tooltip } from './Tooltip';
import { Bubble } from './Bubble';
import { SessionList, rowHint } from './SessionList';
import { SessionView, measureSessionH } from './SessionView';
import { transition, MOTION, ms } from '../motion';
import { setFrame, focusTerminal } from '../tauri/bridge';

const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
const area: Record<Mode, number> = { handle: 1, bubble: 2, list: 3, session: 4 };

export function Surface({ screenH, theme, client, dnd, onToggleDnd }: { screenH: number; theme: 'dark' | 'light'; client: DaemonClient; dnd: boolean; onToggleDnd: () => void }) {
  const { sessions, byId, status, previews } = useDaemon();
  const [st, setSt] = useState<SurfaceState>(initialSurface());
  const ctl = useRef(createSurfaceController({ onState: setSt }));
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const prevPending = useRef<Set<string>>(new Set());
  const prevIds = useRef<Set<string>>(new Set());
  const prevMode = useRef<Mode>('handle');
  useEffect(() => () => ctl.current.dispose(), []);

  // Daemon changes drive the machine.
  useEffect(() => {
    const ids = new Set(sessions.map(s => s.id));
    const pend = new Set(sessions.filter(isPending).map(s => s.id));
    for (const id of prevIds.current) if (!ids.has(id)) ctl.current.dispatch({ type: 'removed', id, remaining: [...ids] });
    for (const id of pend) if (!prevPending.current.has(id) && !dnd) ctl.current.dispatch({ type: 'ask', id });
    for (const id of prevPending.current) if (!pend.has(id)) ctl.current.dispatch({ type: 'askCleared', id });
    prevIds.current = ids; prevPending.current = pend;
  }, [sessions, dnd]);

  const bots: HandleBot[] = useMemo(() => sessions.map(s => ({ id: s.id, name: s.name, tool: s.tool, state: botState(s), pose: poseFor(s.name, s.state), pending: isPending(s), tip: isPending(s) ? `${botState(s) === 'question' ? 'has a question' : 'needs your approval'} · ${s.pending?.text ?? ''}` : rowHint(s) })), [sessions]);
  const selected = st.selectedId ? byId.get(st.selectedId) ?? null : null;
  const bubbleSession = st.bubbleId ? byId.get(st.bubbleId) ?? null : null;
  const geo = layout({ bots: bots.map(b => ({ id: b.id, pending: b.pending })), mode: st.mode, screenH, bubbleId: st.bubbleId, sessionH: selected ? measureSessionH(selected, st.reading) : 480, reading: st.reading });
  const growing = area[st.mode] >= area[prevMode.current]; prevMode.current = st.mode;
  useEffect(() => { setFrame({ top: geo.top, w: Math.max(geo.w, 360), h: geo.h }); }, [geo.top, geo.w, geo.h]);

  const { big } = slotSizes(bots.length);
  const hovBot = bots.find(b => b.id === hoverId) ?? null;
  const hovSlot = geo.slots.find(s => s.id === hoverId);
  const panel = st.mode === 'list' || st.mode === 'session';
  const unreachable = status === 'unreachable';
  const send = (m: Parameters<DaemonClient['send']>[0]) => client.send(m);
  const decide = (id: string, d: 'accept' | 'deny') => send({ type: 'session.decide', id, decision: d });
  const reply = (id: string, text: string) => { send({ type: 'session.reply', id, text }); setDrafts(x => ({ ...x, [id]: '' })); };

  return (
    <>
      {geo.hotZones.map((z, i) => <div key={i} data-hotzone onMouseEnter={() => ctl.current.dispatch({ type: 'edgeEnter' })} onMouseLeave={() => ctl.current.dispatch({ type: 'edgeLeave' })} style={{ position: 'absolute', left: 0, top: z.top, width: 14, height: z.h, pointerEvents: st.mode === 'handle' && !unreachable ? 'auto' : 'none', background: st.hot ? 'rgba(255,255,255,.08)' : 'transparent', transition: transition([['background-color', 'hover']]) }} />)}

      <div data-surface data-mode={st.mode} onMouseEnter={() => ctl.current.dispatch({ type: 'surfaceEnter' })} onMouseLeave={() => ctl.current.dispatch({ type: 'surfaceLeave' })}
        style={{ position: 'absolute', left: 0, top: geo.top, width: geo.w, height: geo.h, boxSizing: 'border-box', overflow: 'hidden', background: 'var(--sidebar)', color: 'var(--sidebar-foreground)', border: '1px solid var(--sidebar-border)', borderLeft: 'none', borderRadius: `0 var(--radius-xl) var(--radius-xl) 0`, boxShadow: 'var(--shadow-overlay)', opacity: unreachable ? 0.6 : 1, willChange: 'top, width, height',
          transition: ['top', 'width', 'height'].map(p => `${p} ${ms(growing ? MOTION.grow.ms : MOTION.shrink.ms)} ${growing ? MOTION.grow.ease : MOTION.shrink.ease} ${ms(growing ? 0 : MOTION.shrink.delayMs)}`).join(', ') + `, opacity ${ms(150)} ease-out` }}>
        <Handle bots={bots} slots={geo.slots} big={big} visible={st.mode === 'handle'} hoverId={hoverId} onHover={setHoverId} onOpen={id => ctl.current.dispatch({ type: 'botClick', id })} theme={theme} />
        <Bubble session={bubbleSession} moreCount={Math.max(0, st.queue.length - 1)} visible={st.mode === 'bubble'} paused={false} onOpen={() => ctl.current.dispatch({ type: 'bubbleClick' })}
          onDecide={d => { if (st.bubbleId) { decide(st.bubbleId, d); ctl.current.dispatch({ type: 'decidedInBubble' }); } }} onReply={t => { if (st.bubbleId) { reply(st.bubbleId, t); ctl.current.dispatch({ type: 'decidedInBubble' }); } }} theme={theme} />
        <div data-panel style={{ position: 'absolute', inset: 0, opacity: panel ? 1 : 0, pointerEvents: panel ? 'auto' : 'none', transition: transition([['opacity', panel ? 'fadeIn' : 'fadeOut', panel ? 120 : 0]]) }}>
          <div style={{ position: 'absolute', inset: 0, transform: `translateX(${st.mode === 'session' ? -28 : 0}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <SessionList sessions={sessions} visible={st.mode === 'list'} numbered={st.openedBy === 'keyboard'} selectedId={st.selectedId} dnd={dnd} onToggleDnd={onToggleDnd} onOpen={id => ctl.current.dispatch({ type: 'rowClick', id })} onClose={() => ctl.current.dispatch({ type: 'close' })} theme={theme} />
          </div>
          <div style={{ position: 'absolute', inset: 0, transform: `translateX(${st.mode === 'session' ? 0 : 28}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            {selected && <SessionView session={selected} preview={previews.get(selected.id) ?? []} visible={st.mode === 'session'} reading={st.reading} draft={drafts[selected.id] ?? ''} onDraft={t => { setDrafts(x => ({ ...x, [selected.id]: t })); ctl.current.dispatch({ type: 'typing', on: t.length > 0 }); }}
              onBack={() => ctl.current.dispatch({ type: 'back' })} onClose={() => ctl.current.dispatch({ type: 'close' })} onDecide={d => decide(selected.id, d)} onReply={t => reply(selected.id, t)} onInterrupt={() => send({ type: 'session.interrupt', id: selected.id })} onKill={() => send({ type: 'session.kill', id: selected.id })}
              onFocus={() => { send({ type: 'session.focus', id: selected.id }); focusTerminal(selected.title); }} onToggleReading={() => ctl.current.dispatch({ type: 'reading', on: !st.reading })} theme={theme} />}
          </div>
        </div>
      </div>

      <Tooltip bot={st.mode === 'handle' ? hovBot : null} y={hovSlot?.center ?? geo.top} />
      {unreachable && <div role="status" style={{ position: 'absolute', left: Math.max(geo.w, SIZES.handleW) + 8, top: geo.top, fontSize: 12, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>daemon unreachable, retrying</div>}
    </>
  );
}
```

`apps/overlay/src/App.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { PROTOCOL_PORT } from '@ledge/protocol';
import { createDaemonClient } from './daemon/client';
import { attachClient } from './daemon/store';
import { Surface } from './surface/Surface';
import { screenHeight } from './tauri/bridge';

export function App() {
  const client = useMemo(() => createDaemonClient({ url: `ws://127.0.0.1:${PROTOCOL_PORT}` }), []);
  const [screenH, setScreenH] = useState(window.innerHeight);
  const [dnd, setDnd] = useState(() => { try { return localStorage.getItem('ledge.dnd') === '1'; } catch { return false; } });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('ledge.theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; } });
  useEffect(() => { const off = attachClient(client); client.connect(); screenHeight().then(setScreenH); return () => { off(); client.close(); }; }, [client]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('ledge.theme', theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem('ledge.dnd', dnd ? '1' : '0'); } catch { /* ignore */ } }, [dnd]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') setTheme(t => (t === 'dark' ? 'light' : 'dark')); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  return <Surface screenH={screenH} theme={theme} client={client} dnd={dnd} onToggleDnd={() => setDnd(d => !d)} />;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter overlay test surface`
Expected: PASS, 6 tests. If the fake-timer interplay with the ws client is flaky, raise the `sleep` values to 80 ms; never remove the assertions.

- [ ] **Step 6: Try it in the browser against the real daemon or the mock**

```bash
pnpm --filter overlay dev        # http://localhost:1420, connects to ws://127.0.0.1:47831
```
With Plan 1 running (`ledge daemon` in WSL) the handle shows your real bots. Without it, run `node -e "import('./apps/overlay/test/mockDaemon.ts')"` is not possible from plain node; instead use `pnpm --filter overlay exec tsx test/devMock.ts`, a 15-line script you create that calls `createMockDaemon({ port: 47831 })`, seeds five `fakeSession`s and toggles one into `waiting_permission` every 8 s.

- [ ] **Step 7: Commit**

```bash
git add apps/overlay/src/surface/Surface.tsx apps/overlay/src/tauri/bridge.ts apps/overlay/src/App.tsx apps/overlay/test/surface.test.tsx apps/overlay/test/devMock.ts
git commit -m "feat(overlay): the living surface wired to the daemon, with the end-to-end flow tests"
```

---

### Task 10: Keyboard first

**Files:**
- Create: `apps/overlay/src/keyboard/useKeyboard.ts`, `apps/overlay/src/keyboard/Coachmark.tsx`
- Modify: `apps/overlay/src/surface/Surface.tsx` (add `useKeyboard`, number badges already come from `openedBy`, render `Coachmark`, expand the focused row's actions)
- Modify: `apps/overlay/src/surface/SessionList.tsx` (prop `focusedId`, focused row grows to 100 px and shows `Approve Y`, `Deny N`, `Open ↵` when the row is pending with a yes/no ask)
- Test: `apps/overlay/test/keyboard.test.tsx`

**Interfaces:**
- Produces: `useKeyboard(opts: { enabled: boolean; mode: Mode; sessions: Session[]; focusedId: string | null; onFocus(id|null); onOpen(id); onDecide(id, d); onNextAsk(); onClose(); onReplyFocus(); onToggleDnd(); onHelp() })` bound to `window` `keydown` while `enabled` (list or session opened by keyboard, and no text input focused): `j`/`ArrowDown`, `k`/`ArrowUp` move the focus, `1`–`9` focus a row, `Enter` opens, `y` approves and `n` denies when the focused row's ask is a permission (a question opens the row instead), `Tab` focuses the next pending row, `r` focuses the reply field, `d` toggles dnd, `Escape` closes, `?` toggles the coachmark.
- `Coachmark` is anchored under the focused row, shown on the first three keyboard opens (`localStorage['ledge.coachmarks']` counter) and on `?`; "Got it" dismisses.

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/keyboard.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useKeyboard } from '../src/keyboard/useKeyboard';
import { fakeSession } from './mockDaemon';

const sessions = [
  fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }),
  fakeSession('b', { name: 'Pim', state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' }, startedAt: '2026-10-09T18:01:00.000Z' }),
  fakeSession('c', { name: 'Lu', startedAt: '2026-10-09T18:02:00.000Z' })
];
const press = (key: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...extra });

describe('useKeyboard', () => {
  it('moves with j/k and digits, opens with Enter, decides with y/n on a permission only', () => {
    const h = { onFocus: vi.fn(), onOpen: vi.fn(), onDecide: vi.fn(), onNextAsk: vi.fn(), onClose: vi.fn(), onReplyFocus: vi.fn(), onToggleDnd: vi.fn(), onHelp: vi.fn() };
    const { rerender } = renderHook(({ focusedId }) => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId, ...h }), { initialProps: { focusedId: null as string | null } });
    press('j'); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    rerender({ focusedId: 'a' }); press('j'); expect(h.onFocus).toHaveBeenLastCalledWith('b');
    rerender({ focusedId: 'b' }); press('k'); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    press('3'); expect(h.onFocus).toHaveBeenLastCalledWith('c');
    rerender({ focusedId: 'a' }); press('y'); expect(h.onDecide).toHaveBeenCalledWith('a', 'accept');
    press('n'); expect(h.onDecide).toHaveBeenCalledWith('a', 'deny');
    rerender({ focusedId: 'b' }); press('y'); expect(h.onOpen).toHaveBeenCalledWith('b');
    press('Enter'); expect(h.onOpen).toHaveBeenLastCalledWith('b');
    press('Tab'); expect(h.onNextAsk).toHaveBeenCalled();
    press('Escape'); expect(h.onClose).toHaveBeenCalled();
    press('?'); expect(h.onHelp).toHaveBeenCalled();
    press('d'); expect(h.onToggleDnd).toHaveBeenCalled();
  });
  it('does nothing while disabled or while typing in an input', () => {
    const onFocus = vi.fn();
    renderHook(() => useKeyboard({ enabled: false, mode: 'list', sessions, focusedId: null, onFocus, onOpen: () => {}, onDecide: () => {}, onNextAsk: () => {}, onClose: () => {}, onReplyFocus: () => {}, onToggleDnd: () => {}, onHelp: () => {} }));
    press('j'); expect(onFocus).not.toHaveBeenCalled();
    const onFocus2 = vi.fn();
    renderHook(() => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId: null, onFocus: onFocus2, onOpen: () => {}, onDecide: () => {}, onNextAsk: () => {}, onClose: () => {}, onReplyFocus: () => {}, onToggleDnd: () => {}, onHelp: () => {} }));
    const input = document.createElement('input'); document.body.appendChild(input); input.focus();
    fireEvent.keyDown(input, { key: 'j' }); expect(onFocus2).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter overlay test keyboard`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/overlay/src/keyboard/useKeyboard.ts`:
```ts
import { useEffect } from 'react';
import type { Session } from '@ledge/protocol';
import type { Mode } from '../surface/geometry';

const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
const typing = () => { const el = document.activeElement; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable); };

export function useKeyboard(o: { enabled: boolean; mode: Mode; sessions: Session[]; focusedId: string | null; onFocus: (id: string | null) => void; onOpen: (id: string) => void; onDecide: (id: string, d: 'accept' | 'deny') => void; onNextAsk: () => void; onClose: () => void; onReplyFocus: () => void; onToggleDnd: () => void; onHelp: () => void }) {
  useEffect(() => {
    if (!o.enabled) return;
    const h = (e: KeyboardEvent) => {
      if (typing() && e.key !== 'Escape') return;
      const ids = o.sessions.map(s => s.id); const i = o.focusedId ? ids.indexOf(o.focusedId) : -1;
      const focused = o.sessions.find(s => s.id === o.focusedId);
      const k = e.key;
      if (k === 'j' || k === 'ArrowDown') { o.onFocus(ids[Math.min(ids.length - 1, i + 1)] ?? null); }
      else if (k === 'k' || k === 'ArrowUp') { o.onFocus(ids[Math.max(0, i - 1)] ?? null); }
      else if (/^[1-9]$/.test(k)) { const id = ids[Number(k) - 1]; if (id) o.onFocus(id); }
      else if (k === 'Enter') { if (focused) o.onOpen(focused.id); }
      else if (k === 'y' || k === 'n') { if (focused && isPending(focused)) { if (focused.pending?.kind === 'permission' || focused.pending?.kind === 'diff' || focused.pending?.kind === 'plan') o.onDecide(focused.id, k === 'y' ? 'accept' : 'deny'); else o.onOpen(focused.id); } }
      else if (k === 'Tab') { e.preventDefault(); o.onNextAsk(); }
      else if (k === 'r') { o.onReplyFocus(); }
      else if (k === 'd') { o.onToggleDnd(); }
      else if (k === 'Escape') { o.onClose(); }
      else if (k === '?') { o.onHelp(); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [o.enabled, o.mode, o.sessions, o.focusedId, o.onFocus, o.onOpen, o.onDecide, o.onNextAsk, o.onClose, o.onReplyFocus, o.onToggleDnd, o.onHelp]);
}
```

`apps/overlay/src/keyboard/Coachmark.tsx`:
```tsx
import { Kbd } from '../ui/Kbd';
import { Button } from '../ui/Button';
import { transition } from '../motion';
export function Coachmark({ visible, top, onDismiss }: { visible: boolean; top: number; onDismiss: () => void }) {
  return (
    <div role="dialog" aria-label="Keyboard" aria-hidden={!visible} style={{ position: 'absolute', left: 44, top, width: 300, display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: 'var(--popover)', border: '1px solid var(--input)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-overlay)', opacity: visible ? 1 : 0, transform: `translateY(${visible ? 0 : -6}px)`, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut'], ['transform', 'grow', visible ? 140 : 0]]) }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>Move with the keyboard</span>
      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
        <span><Kbd>J</Kbd> <Kbd>K</Kbd> up and down</span><span><Kbd>Tab</Kbd> next ask</span><span><Kbd>1</Kbd>…<Kbd>9</Kbd> jump</span><span><Kbd>Y</Kbd> <Kbd>N</Kbd> decide</span><span><Kbd>Esc</Kbd> close</span>
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Shown on the first three keyboard opens</span><span style={{ flexGrow: 1 }} />
        <Button variant="secondary" size="sm" onClick={onDismiss}>Got it</Button>
      </div>
    </div>
  );
}
```

In `Surface.tsx` add `focusedId` state, the hook, the `Coachmark` (top = `geo.top + 56 + 8 + (rowIndex + 1) * 56` when `st.openedBy === 'keyboard'`), a `coachCount` from `localStorage['ledge.coachmarks']` incremented on each keyboard open, and pass `focusedId` to `SessionList`. In `SessionList`, a row with `focusedId === s.id` gets `outline: 2px solid var(--ring)` inset, and when its ask is yes/no it grows to 100 px with a second line of `Approve <Kbd accent>Y</Kbd>`, `Deny <Kbd>N</Kbd>`, `Open <Kbd>↵</Kbd>` small buttons (`onDecide` and `onOpen` props added to the list). `onNextAsk` focuses the next pending row after the focused one, wrapping.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test`
Expected: PASS, every file.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/keyboard apps/overlay/src/surface apps/overlay/test/keyboard.test.tsx
git commit -m "feat(overlay): keyboard-first navigation, inline row actions and the coachmark"
```

---

### Task 11: Tauri shell

**Files:**
- Create: `apps/overlay/src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/icons/` (run `pnpm --filter overlay tauri icon` on a 1024 px PNG of the Claude-head bot drawn from `Bot.tsx` at 1024, or any square placeholder for now)
- Test: `cargo test` in `src-tauri` (one unit test on the title matcher), plus the manual checklist.

**Interfaces:**
- Commands: `set_frame(top: i32, width: u32, height: u32)` moves and resizes the window to `(0, top)` on the primary monitor's work area, so the window is exactly the surface plus a 360 px right margin for the tooltip and the "daemon unreachable" line (transparent, click-through outside the surface is not needed: the window only covers the strip it draws in); `focus_terminal(title: String)` finds the top-level window whose title contains `title` or, failing that, contains `Windows Terminal`, and calls `SetForegroundWindow` (V1 limitation, stated in the spec's open points: the terminal window comes to the front, the exact tab is not switched).
- Window: `decorations: false`, `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`, `focus: false` at start, `shadow: false`; `windows.webviewInstallMode` default.

- [ ] **Step 1: Write the shell**

`apps/overlay/src-tauri/Cargo.toml`:
```toml
[package]
name = "ledge-overlay"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = ["Win32_Foundation", "Win32_UI_WindowsAndMessaging"] }
```

`apps/overlay/src-tauri/build.rs`:
```rust
fn main() { tauri_build::build() }
```

`apps/overlay/src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Ledge",
  "version": "0.1.0",
  "identifier": "be.paradow.ledge",
  "build": { "beforeDevCommand": "pnpm dev", "devUrl": "http://localhost:1420", "beforeBuildCommand": "pnpm build", "frontendDist": "../dist" },
  "app": {
    "windows": [{ "label": "main", "title": "Ledge", "width": 400, "height": 200, "x": 0, "y": 400, "decorations": false, "transparent": true, "alwaysOnTop": true, "skipTaskbar": true, "resizable": false, "focus": false, "shadow": false }],
    "security": { "csp": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src ws://127.0.0.1:47831" }
  },
  "bundle": { "active": true, "targets": ["nsis"], "icon": ["icons/icon.ico", "icons/icon.png"] }
}
```

`apps/overlay/src-tauri/capabilities/default.json`:
```json
{ "identifier": "default", "windows": ["main"], "permissions": ["core:default", "core:window:allow-set-position", "core:window:allow-set-size", "global-shortcut:allow-register", "global-shortcut:allow-unregister"] }
```

`apps/overlay/src-tauri/src/main.rs`:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{LogicalPosition, LogicalSize, Manager};

#[tauri::command]
fn set_frame(window: tauri::Window, top: i32, width: u32, height: u32) -> Result<(), String> {
    window.set_position(LogicalPosition::new(0, top)).map_err(|e| e.to_string())?;
    window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

/// True when a window title should be brought forward for `wanted`.
pub fn title_matches(title: &str, wanted: &str) -> bool {
    let t = title.to_lowercase();
    t.contains(&wanted.to_lowercase()) || t.contains("windows terminal")
}

#[cfg(windows)]
#[tauri::command]
fn focus_terminal(title: String) -> Result<bool, String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible, SetForegroundWindow};
    struct Search { wanted: String, exact: Option<HWND>, any: Option<HWND> }
    unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
        let s = &mut *(lp.0 as *mut Search);
        if !IsWindowVisible(hwnd).as_bool() { return BOOL(1); }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf) as usize;
        let t = String::from_utf16_lossy(&buf[..n]);
        if t.to_lowercase().contains(&s.wanted.to_lowercase()) { s.exact = Some(hwnd); return BOOL(0); }
        if s.any.is_none() && t.to_lowercase().contains("windows terminal") { s.any = Some(hwnd); }
        BOOL(1)
    }
    let mut search = Search { wanted: title, exact: None, any: None };
    unsafe { let _ = EnumWindows(Some(cb), LPARAM(&mut search as *mut Search as isize)); }
    match search.exact.or(search.any) { Some(h) => unsafe { Ok(SetForegroundWindow(h).as_bool()) }, None => Ok(false) }
}

#[cfg(not(windows))]
#[tauri::command]
fn focus_terminal(_title: String) -> Result<bool, String> { Ok(false) }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![set_frame, focus_terminal])
        .setup(|app| { if let Some(w) = app.get_webview_window("main") { let _ = w.set_always_on_top(true); } Ok(()) })
        .run(tauri::generate_context!())
        .expect("error while running Ledge");
}

#[cfg(test)]
mod tests {
    use super::title_matches;
    #[test] fn matches_bot_title_or_terminal() {
        assert!(title_matches("Otto · harness-assistant - Windows Terminal", "Otto · harness-assistant"));
        assert!(title_matches("PowerShell - Windows Terminal", "Pim · speos-api"));
        assert!(!title_matches("Visual Studio Code", "Pim · speos-api"));
    }
}
```

- [ ] **Step 2: Build on Windows**

From a Windows PowerShell with Rust (`rustup`), Node and pnpm installed, in the checkout (`\\wsl.localhost\Ubuntu\home\paradow\Workspace\harness-assistant` is slow for cargo; prefer `git clone` to `C:\src\ledge`):
```powershell
pnpm install
pnpm --filter overlay tauri dev
```
Expected: a borderless, transparent window on the left edge showing the handle; `Ctrl+Alt+L` opens the list; the window moves and resizes with the surface; with Plan 1's daemon running in WSL the real bots appear. `cargo test` in `src-tauri` passes the title matcher test.

- [ ] **Step 3: Commit**

```bash
git add apps/overlay/src-tauri
git commit -m "feat(overlay): tauri shell with frame sizing, global shortcut and terminal focus"
```

---

### Task 12: Theme, settings and docs

**Files:**
- Modify: `apps/overlay/src/App.tsx` (already persists `dnd` and `theme`; add `Ctrl+Alt+T` theme toggle documented), `README.md`
- Create: `apps/overlay/README.md`
- Test: `apps/overlay/test/theme.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/theme.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { App } from '../src/App';

describe('App theme', () => {
  it('defaults to dark, toggles with Ctrl+Alt+T and persists', () => {
    localStorage.clear();
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('ledge.theme')).toBe('light');
  });
});
```

- [ ] **Step 2: Run, implement if needed, run again**

Run: `pnpm --filter overlay test theme`
Expected: PASS with the `App.tsx` from Task 9 (the toggle is already there); if the `ws` connection attempt logs an error in jsdom, stub `WebSocket` in `test/setup.ts` with a no-op class.

- [ ] **Step 3: Write the docs**

`apps/overlay/README.md`:
```markdown
# Ledge overlay

React UI lives in `src/`, tested in WSL. The Tauri shell in `src-tauri/` builds on Windows.

## Develop (WSL)
pnpm --filter overlay dev            # http://localhost:1420
pnpm --filter overlay exec tsx test/devMock.ts   # a fake daemon on 47831 with five bots
pnpm --filter overlay test

## Build (Windows PowerShell, Rust installed)
pnpm --filter overlay tauri dev
pnpm --filter overlay tauri build    # NSIS installer in src-tauri/target/release/bundle

## Keys
Ctrl+Alt+L open/close · J K move · 1-9 jump · Enter open · Y N decide · Tab next ask · R reply · D do not disturb · Esc close · ? keys · Ctrl+Alt+T theme

## Known V1 limits
Focus brings the Windows Terminal window forward; it does not switch to the exact tab yet.
```

- [ ] **Step 4: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add apps/overlay/README.md apps/overlay/test/theme.test.tsx apps/overlay/test/setup.ts README.md
git commit -m "docs(overlay): usage, keys and V1 limits"
git push
```

---

## Self-review notes

- Spec coverage: section 5 surface/handle/bubble/list/session/keyboard → Tasks 4 to 10; section 6 bots → Task 3; section 7 motion → Task 1 and every component's `transition()`; section 8 overlay errors (unreachable, frozen bots, snapshot replaces state, removed bots fold) → Tasks 2 and 9; section 9 overlay tests (components on a mock daemon, animations zeroed, scenarios named after board 9) → every task; Tauri → Task 11. Deferred to Plan 3: diff, plan and report cards, long command view, finished summary, sub-agents, queue bandeau, reading-mode content.
- Names consistent across tasks: `layout`, `slotSizes`, `SIZES`, `transition`, `createSurfaceController`, `useDaemon`, `attachClient`, `createDaemonClient`, `botState`, `poseFor`, `Handle`, `HandleBot`, `Bubble`, `SessionList`, `rowHint`, `SessionView`, `measureSessionH`, `useKeyboard`, `setFrame`, `focusTerminal`.
- Review Focus pins: 1 → Task 9 "a removed session that is open falls back to the list" and Task 4 `removed`; 2 → Task 4 "a second ask queues" and Task 6 "+N more"; 3 → Task 4 "an ask during the dwell"; 4 → Task 9 "a draft survives a daemon disconnect"; 5 → Task 4 geometry "never exceeds the screen minus margins" and the list's `overflowY: auto` in Task 7.
