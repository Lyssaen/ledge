# Ledge alive: working hop, finished notification, sounds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the overlay feel alive: a working bot hops every 3.6 to 4.4 s, a bot that finishes its task unfolds a 6 s "finished" bubble with a sound, and a small family of synthesised sound cues plays for asks, results and the user's own decisions, all governed by a Sounds section in Settings.

**Architecture:** Three overlay-only additions on top of the existing surface. (1) The hop is CSS on a new `.hop` group inside the `Bot` SVG, switched by a `data-hop` attribute computed like the other motion flags. (2) The finished bubble is a second bubble kind in the pure surface machine (`bubbleKind`, `done` queue), fed by a new `finished` event that `useDaemonAsks` derives from a `working → idle` transition, and drawn by `Bubble` in a `finished` variant. (3) Sounds are a pure decision module (`decideSound`) plus an injectable `SoundPlayer` (Web Audio in production, a fake in tests), driven by session changes that `useDaemonAsks` now reports through `onChange`, and by the surface's own `decide`/`reply` for the user's ticks. Preferences live in `localStorage` like the other settings. The daemon is untouched: it already emits the `idle` transition on `Stop`/`PaneIdle`.

**Tech Stack:** React 19, TypeScript 5 strict, Vite 6, Vitest 2 + jsdom + Testing Library (`apps/overlay`), Web Audio API, Tauri v2 shell (one new Rust command, `foreground_is_terminal`, Windows only).

**Spec:** `docs/superpowers/specs/2026-10-09-ledge-design.md`, revision 3 (2026-10-10): section 5 "La bulle de fin de tâche" and "Réglages : notifications et sons", section 6 "Le saut de travail", section 7 (`hop` curve), section 7 ter "Sons", section 9 "Saut, fin de tâche et sons". The validated mockups are boards 20, 21 and 22 of the Ledge canvas (https://claude.ai/artifact/57oDjsKdabQBmPgAXn15mc), row "Alive".

## Global Constraints

- Everything here runs and is tested in WSL with `cd apps/overlay && pnpm vitest run <file>`; `pnpm --filter overlay typecheck` must pass before every commit. The Rust change compiles only on Windows; it is written defensively (`#[cfg(windows)]` plus a non-Windows stub) exactly like `focus_terminal`.
- Hop: period `3600 + (hash % 9) * 100` ms, offset `--bot-phase` like breathing; the hop itself is 480 ms (13.3 % of a 3.6 s cycle) with keyframes at 0 / 14 / 44 / 70 / 86 / 100 % of those 480 ms; height in screen px `clamp(2, size * 0.12, 7)` converted to SVG units `H / size * 96`; `working` only; the only ambient motion kept at ≤ 20 px; off under reduced motion (OS or app), read-only, frozen, paused, inert.
- Finished bubble: opens only on a transition `working | starting → idle`, only in `handle` mode with no ask queued, never under DND, never when the setting is `sound` or `none`; bot grows 280 ms then the bubble unfolds 260 ms later (the existing `unfold` timer, 540 ms); holds 6000 ms (`FINISHED_BUBBLE_MS`), paused by hover, focus and a hidden document with the exact remainder; an ask replaces it; several finished notices chain oldest first; `exited` never bubbles.
- Sounds: sine and triangle only, 8 ms attack, exponential release, peak −18 dBFS (gain 0.12 at Normal; Quiet × 0.5, Loud × 1.8), nothing over 350 ms; one cue per 1500 ms except the user's own ticks; cut by DND, by the Sounds switch, by the category, and by "only when the terminal is behind" when Windows Terminal is the foreground window; a join cue is ignored for 1500 ms after the daemon connects (snapshot replay).
- Preferences in `localStorage`: `ledge.finished` (`both` default), `ledge.sounds` (JSON: `enabled` true, `volume` `normal`, categories `requests`/`finished`/`errors`/`decisions` true and `team` false, `onlyWhenTerminalBehind` true). Every read is wrapped in try/catch and falls back to the defaults.
- Copy: French default, English second, every key typed on both sides (`Messages`); sentence case, no emoji; "Claude Code", "Codex", "Cursor Agent"; durations through `t.time`.
- Motion: no bounce on surfaces, badges or panels; the hop is on the bot only; `VITE_LEDGE_MOTION=0` and `prefers-reduced-motion` already zero every CSS animation of `.bot` (bots.css) and that must stay true for the hop.
- Accessibility: real `button`/`input`/`label` controls; icon-only buttons carry `aria-label`; the finished bubble's badge is text, never a colour alone.

## Review Focus

1. A session that goes `idle → working → idle` twice within a second (a quick turn): exactly one finished bubble per real transition, never two stacked, and the second transition while the first bubble is up re-arms its 6 s clock (pinned in Task 3, "a second finished notice chains").
2. A `PaneIdle` after a `Stop` (the daemon sends `idle` again with no `working` in between): no second bubble, no second sound (pinned in Task 4, "idle again without working in between is not a finish").
3. The user clicks Approve in an ask bubble 300 ms after a knock cue played: the tick must still play (user ticks bypass the 1.5 s rule) (pinned in Task 7).
4. The daemon reconnects with five sessions in its snapshot: no five join pops (pinned in Task 7, "join cues are swallowed right after connect").
5. `localStorage` throws (private window, blocked storage): the sound and finished settings fall back to their defaults and the settings view still renders and toggles in memory (pinned in Task 2).

---

## File structure

```
apps/overlay/
  src/bots/bots.css                 # modify: .hop group, bot-hop / bot-pulse keyframes, data-hop rules
  src/bots/Bot.tsx                  # modify: <g class="hop"> wrapper, --bot-hop, --bot-hop-cycle, data-hop
  src/sounds/preferences.ts         # create: FinishedNotify, SoundPrefs, defaults, load/save, useSoundPrefs()
  src/sounds/cues.ts                # create: Cue, SoundCategory, CATEGORY_OF, CUES (note lists)
  src/sounds/player.ts              # create: SoundPlayer interface, createWebAudioPlayer(), createSilentPlayer()
  src/sounds/decide.ts              # create: pure decideSound()
  src/sounds/useSounds.ts           # create: hook: session changes + user ticks -> player, with the terminal check
  src/daemon/changes.ts             # create: SessionChange type + changeOf(was, now)
  src/surface/machine.ts            # modify: bubbleKind, done queue, 'finished' event, FINISHED_BUBBLE_MS
  src/surface/useDaemonAsks.ts      # modify: finished dispatch, workingSince, onChange(SessionChange)
  src/surface/Bubble.tsx            # modify: kind='finished' variant (title, sub-line, badge, OK/Open, 6 s bar)
  src/surface/Handle.tsx            # modify: HandleBot.lifted (big without tick)
  src/surface/Surface.tsx           # modify: wiring (finished pref, lifted bot, bubble kind, sounds, settings props)
  src/surface/SettingsView.tsx      # modify: "When a bot finishes", Sounds, Volume, Play when, Terminal behind
  src/i18n/messages.ts              # modify: bubble.finished*, settings.finished*, settings.sounds*
  src/format.ts                     # modify: duration(ms, t)
  src/tauri/bridge.ts               # modify: foregroundIsTerminal()
  src-tauri/src/main.rs             # modify: foreground_is_terminal command (+ handler registration)
  src-tauri/tauri.conf.json         # modify: additionalBrowserArgs with the autoplay policy
  test/bot.test.tsx                 # modify: hop cases
  test/machine.test.ts              # modify: finished cases
  test/changes.test.ts              # create
  test/sounds.test.ts               # create: decideSound, cues, preferences
  test/bubble.test.tsx              # modify: finished variant
  test/surface.test.tsx             # modify: finished bubble end to end, sounds through a fake player
  test/settings.test.tsx            # create: the new settings sections
docs/superpowers/specs/2026-10-09-ledge-design.md   # already revised (revision 3)
docs/tour.md                        # modify: one paragraph on the hop, the finished bubble and sounds
```

---

### Task 1: The working hop

**Files:**
- Modify: `apps/overlay/src/bots/bots.css`
- Modify: `apps/overlay/src/bots/Bot.tsx`
- Test: `apps/overlay/test/bot.test.tsx`

**Interfaces:**
- Consumes: `Bot` props as they are (`state`, `size`, `readOnly`, `frozen`, `paused`, `reducedMotion`, `seed`).
- Produces: the SVG root carries `data-hop="true|false"` and the CSS variables `--bot-hop` (SVG units, e.g. `16.00px` at 12 px) and `--bot-hop-cycle` (`3600ms`–`4400ms`). Nothing else changes for callers.

- [ ] **Step 1: Write the failing tests**

Append to `apps/overlay/test/bot.test.tsx`, inside `describe('Bot', …)` (reuse the file's imports; `render` and `cleanup` come from Testing Library, `afterEach(cleanup)` is already there):

```tsx
  describe('working hop', () => {
    const svg = () => document.querySelector('svg.bot') as SVGSVGElement;
    const vars = () => { const s = svg().getAttribute('style') ?? ''; return Object.fromEntries([...s.matchAll(/(--bot-[a-z-]+):\s*([^;]+)/g)].map(m => [m[1], m[2].trim()])); };

    it('hops only while working, at 12 px as at 48 px', () => {
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={12} theme="dark" />);
      expect(svg()).toHaveAttribute('data-hop', 'true');
      cleanup();
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={48} theme="dark" />);
      expect(svg()).toHaveAttribute('data-hop', 'true');
      for (const state of ['starting', 'approval', 'question', 'idle', 'error', 'done', 'readonly'] as const) {
        cleanup();
        render(<Bot seed="s1" tool="claude" state={state} pose={1} size={32} theme="dark" />);
        expect(svg(), state).toHaveAttribute('data-hop', 'false');
      }
    });

    it('is off under reduced motion, read-only, frozen and paused', () => {
      const cases = [{ reducedMotion: true }, { readOnly: true }, { frozen: true }, { paused: true }];
      for (const extra of cases) {
        cleanup();
        render(<Bot seed="s1" tool="claude" state="working" pose={1} size={32} theme="dark" {...extra} />);
        expect(svg(), JSON.stringify(extra)).toHaveAttribute('data-hop', 'false');
      }
    });

    it('sizes the hop in SVG units from clamp(2, size * 0.12, 7) px and cycles every 3.6 to 4.4 s', () => {
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={12} theme="dark" />);
      expect(vars()['--bot-hop']).toBe('16.00px');            // 2 px of 12 → 16 SVG units
      cleanup();
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={48} theme="dark" />);
      expect(vars()['--bot-hop']).toBe('11.52px');            // 5.76 px of 48
      cleanup();
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={96} theme="dark" />);
      expect(vars()['--bot-hop']).toBe('7.00px');             // capped at 7 px
      const cycle = parseInt(vars()['--bot-hop-cycle'], 10);
      expect(cycle).toBeGreaterThanOrEqual(3600); expect(cycle).toBeLessThanOrEqual(4400);
      expect(svg().querySelector('g.hop > g.body')).not.toBeNull();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/overlay && pnpm vitest run test/bot.test.tsx`
Expected: the three new tests FAIL (`data-hop` attribute missing, `--bot-hop` undefined).

- [ ] **Step 3: Add the hop group and variables to `Bot.tsx`**

In `apps/overlay/src/bots/Bot.tsx`:

1. After `const h = seedHash(seed);` add:

```tsx
  // The working hop (spec §6): the only ambient motion kept at ≤ 20 px, so the handle shows progress. Height in screen px,
  // converted to SVG units so a 12 px bot lifts 2 px and a 48 px bot 5.8 px; period 3.6–4.4 s, offset per bot like breathing.
  const hop = state === 'working' && !reduced && !readOnly && !frozen && !paused;
  const hopPx = Math.min(7, Math.max(2, size * 0.12));
  const hopUnits = (hopPx / size) * 96;
  const hopCycle = 3600 + (h % 9) * 100;
```

2. In the `style` object add two variables after `'--bot-phase'`:

```tsx
    '--bot-hop': `${hopUnits.toFixed(2)}px`,
    '--bot-hop-cycle': ms(hopCycle),
```

3. On the `<svg>` add the attribute `data-hop={String(hop)}` after `data-reduced`.

4. Wrap the body group: replace

```tsx
      <g className="body">
        <g className="pose">
```

with

```tsx
      <g className="hop">
      <g className="body">
        <g className="pose">
```

and close it: the body's closing `</g>` (the one before `</svg>`, after `.arm`'s `</g>`) becomes `</g>\n      </g>`. The result must be `svg > ellipse.ground + g.hop > g.body > g.pose`.

- [ ] **Step 4: Add the CSS**

In `apps/overlay/src/bots/bots.css`, after the `.bot .body { … }` rule add:

```css
/* The working hop (spec §6): a 480 ms hop inside a 3.6–4.4 s cycle on the group that wraps the body, so breathing and
   the hop compose. Only data-hop="true" (working, not reduced/read-only/frozen/paused) animates; the simplified crop keeps it. */
.bot .hop { transform-origin: 48px 83px; }
.bot[data-hop="true"] .hop {
  animation: bot-hop var(--bot-hop-cycle, 3.6s) linear infinite;
  animation-delay: var(--bot-phase, 0s);
}
/* Reduced motion keeps the progress signal: the antenna light pulses at the running-dot rhythm (hidden at ≤ 20 px). */
.bot[data-reduced="true"][data-state="working"]:not([data-frozen="true"]):not([data-paused="true"]):not([data-readonly="true"]) .antenna-light {
  animation: bot-pulse 1.2s ease-in-out infinite !important;
}
```

and after `@keyframes bot-breathe { … }` add:

```css
/* 480 ms of a 3.6 s cycle = 13.3 %: anticipation squash, rise with stretch, land with squash, settle, then still. */
@keyframes bot-hop {
  0% { transform: translateY(0) scale(1, 1); animation-timing-function: ease-in; }
  1.9% { transform: translateY(0) scale(1.06, .92); animation-timing-function: cubic-bezier(.2, .7, .3, 1); }
  5.9% { transform: translateY(calc(var(--bot-hop, 8px) * -1)) scale(.96, 1.06); animation-timing-function: cubic-bezier(.6, 0, .9, .4); }
  9.3% { transform: translateY(0) scale(1.05, .95); animation-timing-function: ease-out; }
  11.5% { transform: translateY(0) scale(.99, 1.01); }
  13.3%, 100% { transform: translateY(0) scale(1, 1); }
}
@keyframes bot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
```

Note: the percentages are fixed for a 3.6 s cycle; a 4.4 s cycle stretches the hop to 585 ms, within the spec's tolerance (the spec fixes the cycle, the keyframes follow). Do not touch the `[data-reduced="true"] *` rule: it must still kill `bot-hop`, which is why the pulse rule carries `!important` and is scoped to `data-reduced="true"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/overlay && pnpm vitest run test/bot.test.tsx test/bot-motion.test.tsx test/prototype-parity.test.tsx`
Expected: PASS (if `prototype-parity` snapshots the SVG structure, update the expected structure to include `g.hop`; it is a structural parity test, not a pixel one).

- [ ] **Step 6: Typecheck and commit**

```bash
cd apps/overlay && pnpm typecheck && cd ../.. && git add apps/overlay/src/bots apps/overlay/test/bot.test.tsx apps/overlay/test/prototype-parity.test.tsx
git commit -m "feat(overlay): working bots hop every 3.6 to 4.4 s, in the handle too

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Notification and sound preferences store

**Files:**
- Create: `apps/overlay/src/sounds/preferences.ts`
- Test: `apps/overlay/test/sounds.test.ts` (created here, extended in Task 7)

**Interfaces:**
- Produces:

```ts
export type FinishedNotify = 'both' | 'bubble' | 'sound' | 'none';
export type SoundVolume = 'quiet' | 'normal' | 'loud';
export type SoundCategory = 'requests' | 'finished' | 'errors' | 'decisions' | 'team';
export interface SoundPrefs { enabled: boolean; volume: SoundVolume; categories: Record<SoundCategory, boolean>; onlyWhenTerminalBehind: boolean }
export const DEFAULT_SOUNDS: SoundPrefs;
export const VOLUME_GAIN: Record<SoundVolume, number>;   // quiet .5, normal 1, loud 1.8
export function loadFinished(): FinishedNotify; export function loadSounds(): SoundPrefs;
export function useSoundPrefs(): { finished: FinishedNotify; sounds: SoundPrefs; setFinished(v: FinishedNotify): void; setSounds(patch: Partial<SoundPrefs> & { categories?: Partial<Record<SoundCategory, boolean>> }): void };
```

- [ ] **Step 1: Write the failing tests**

Create `apps/overlay/test/sounds.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DEFAULT_SOUNDS, loadFinished, loadSounds, useSoundPrefs } from '../src/sounds/preferences';

describe('sound and finished preferences', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults: bubble and sound on finish; sounds on, normal, team off, terminal rule on', () => {
    expect(loadFinished()).toBe('both');
    expect(loadSounds()).toEqual({ enabled: true, volume: 'normal', categories: { requests: true, finished: true, errors: true, decisions: true, team: false }, onlyWhenTerminalBehind: true });
    expect(DEFAULT_SOUNDS.categories.team).toBe(false);
  });

  it('persists changes and merges a partial categories patch', () => {
    const { result } = renderHook(() => useSoundPrefs());
    act(() => { result.current.setFinished('sound'); result.current.setSounds({ volume: 'loud', categories: { team: true } }); });
    expect(result.current.finished).toBe('sound');
    expect(result.current.sounds.volume).toBe('loud');
    expect(result.current.sounds.categories).toEqual({ requests: true, finished: true, errors: true, decisions: true, team: true });
    expect(localStorage.getItem('ledge.finished')).toBe('sound');
    expect(JSON.parse(localStorage.getItem('ledge.sounds')!).volume).toBe('loud');
    expect(loadSounds().categories.team).toBe(true);
  });

  it('garbage and a throwing storage fall back to the defaults, and toggles still work in memory', () => {
    localStorage.setItem('ledge.finished', 'loudly'); localStorage.setItem('ledge.sounds', '{not json');
    expect(loadFinished()).toBe('both'); expect(loadSounds()).toEqual(DEFAULT_SOUNDS);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadSounds()).toEqual(DEFAULT_SOUNDS);
    const { result } = renderHook(() => useSoundPrefs());
    act(() => result.current.setSounds({ enabled: false }));
    expect(result.current.sounds.enabled).toBe(false);
    get.mockRestore(); set.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/overlay && pnpm vitest run test/sounds.test.ts`
Expected: FAIL, module `../src/sounds/preferences` not found.

- [ ] **Step 3: Write the store**

Create `apps/overlay/src/sounds/preferences.ts` (same shape as `motionPreferences.ts`: module state, listeners, `useSyncExternalStore`):

```ts
import { useCallback, useSyncExternalStore } from 'react';

export type FinishedNotify = 'both' | 'bubble' | 'sound' | 'none';
export type SoundVolume = 'quiet' | 'normal' | 'loud';
export type SoundCategory = 'requests' | 'finished' | 'errors' | 'decisions' | 'team';
export interface SoundPrefs { enabled: boolean; volume: SoundVolume; categories: Record<SoundCategory, boolean>; onlyWhenTerminalBehind: boolean }

export const FINISHED_VALUES: readonly FinishedNotify[] = ['both', 'bubble', 'sound', 'none'];
export const VOLUMES: readonly SoundVolume[] = ['quiet', 'normal', 'loud'];
export const CATEGORIES: readonly SoundCategory[] = ['requests', 'finished', 'errors', 'decisions', 'team'];
/** Multipliers on the −18 dBFS peak (spec §7 ter). */
export const VOLUME_GAIN: Record<SoundVolume, number> = { quiet: 0.5, normal: 1, loud: 1.8 };
export const DEFAULT_SOUNDS: SoundPrefs = { enabled: true, volume: 'normal', categories: { requests: true, finished: true, errors: true, decisions: true, team: false }, onlyWhenTerminalBehind: true };

const FINISHED_KEY = 'ledge.finished';
const SOUNDS_KEY = 'ledge.sounds';

export function loadFinished(): FinishedNotify {
  try { const v = localStorage.getItem(FINISHED_KEY); return (FINISHED_VALUES as readonly string[]).includes(v ?? '') ? (v as FinishedNotify) : 'both'; } catch { return 'both'; }
}
/** Each field is validated on its own, so a partial or outdated record keeps what it can and defaults the rest. */
export function loadSounds(): SoundPrefs {
  try {
    const raw = localStorage.getItem(SOUNDS_KEY); if (!raw) return DEFAULT_SOUNDS;
    const v = JSON.parse(raw) as Partial<SoundPrefs> | null; if (!v || typeof v !== 'object') return DEFAULT_SOUNDS;
    const categories = { ...DEFAULT_SOUNDS.categories };
    for (const c of CATEGORIES) if (typeof v.categories?.[c] === 'boolean') categories[c] = v.categories[c]!;
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SOUNDS.enabled,
      volume: (VOLUMES as readonly string[]).includes(v.volume ?? '') ? (v.volume as SoundVolume) : DEFAULT_SOUNDS.volume,
      categories,
      onlyWhenTerminalBehind: typeof v.onlyWhenTerminalBehind === 'boolean' ? v.onlyWhenTerminalBehind : DEFAULT_SOUNDS.onlyWhenTerminalBehind
    };
  } catch { return DEFAULT_SOUNDS; }
}

let finished = loadFinished();
let sounds = loadSounds();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export type SoundPatch = Partial<Omit<SoundPrefs, 'categories'>> & { categories?: Partial<Record<SoundCategory, boolean>> };
export function setFinished(v: FinishedNotify): void {
  finished = v;
  try { localStorage.setItem(FINISHED_KEY, v); } catch { /* storage unavailable: the in-memory value still applies */ }
  emit();
}
export function setSounds(patch: SoundPatch): void {
  sounds = { ...sounds, ...patch, categories: { ...sounds.categories, ...(patch.categories ?? {}) } };
  try { localStorage.setItem(SOUNDS_KEY, JSON.stringify(sounds)); } catch { /* storage unavailable */ }
  emit();
}
/** Test hook: forget the module state (the next read reloads from storage). */
export function resetSoundPrefsForTests(): void { finished = loadFinished(); sounds = loadSounds(); emit(); }

export function useSoundPrefs() {
  const f = useSyncExternalStore(subscribe, () => finished, () => finished);
  const s = useSyncExternalStore(subscribe, () => sounds, () => sounds);
  return { finished: f, sounds: s, setFinished: useCallback(setFinished, []), setSounds: useCallback(setSounds, []) };
}
```

In the test's `beforeEach`, also call `resetSoundPrefsForTests()` after `localStorage.clear()` (import it), so module state does not leak between tests.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/overlay && pnpm vitest run test/sounds.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
cd apps/overlay && pnpm typecheck && cd ../.. && git add apps/overlay/src/sounds/preferences.ts apps/overlay/test/sounds.test.ts
git commit -m "feat(overlay): notification and sound preferences store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The finished bubble in the surface machine

**Files:**
- Modify: `apps/overlay/src/surface/machine.ts`
- Test: `apps/overlay/test/machine.test.ts`

**Interfaces:**
- Produces: `SurfaceState` gains `bubbleKind: 'ask' | 'finished'` and `done: string[]`; `SurfaceEvent` gains `{ type: 'finished'; id: string }`; `export const FINISHED_BUBBLE_MS = 6000`; `export type BubbleKind`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/overlay/test/machine.test.ts` inside `describe('surface machine', …)` (the `run` helper is at the top of the file):

```ts
  describe('finished bubble', () => {
    const unfold = { type: 'unfoldElapsed' } as never;
    it('a finish on the bare handle grows the bot, then unfolds a finished bubble with a 6 s clock', () => {
      const r = run([{ type: 'finished', id: 'a' }]);
      expect(r.s.mode).toBe('handle'); expect(r.s.done).toEqual(['a']); expect(r.s.unfoldDue).toBe(true); expect(r.effects).toContain('startTimer:unfold');
      const r2 = run([unfold], r.s);
      expect(r2.s.mode).toBe('bubble'); expect(r2.s.bubbleId).toBe('a'); expect(r2.s.bubbleKind).toBe('finished');
      expect(r2.effects).toContain('startTimer:bubble');
    });
    it('the finished bubble folds after its clock and forgets the notice', () => {
      const { s } = run([{ type: 'finished', id: 'a' }, unfold, { type: 'bubbleElapsed' }]);
      expect(s.mode).toBe('handle'); expect(s.done).toEqual([]); expect(s.bubbleKind).toBe('ask');
    });
    it('a second finished notice chains after the first, oldest first, with a fresh clock', () => {
      const up = run([{ type: 'finished', id: 'a' }, unfold, { type: 'finished', id: 'b' }]);
      expect(up.s.mode).toBe('bubble'); expect(up.s.bubbleId).toBe('a'); expect(up.s.done).toEqual(['a', 'b']);
      const next = run([{ type: 'bubbleElapsed' }], up.s);
      expect(next.s.mode).toBe('bubble'); expect(next.s.bubbleId).toBe('b'); expect(next.s.done).toEqual(['b']); expect(next.effects).toContain('startTimer:bubble');
      expect(run([{ type: 'bubbleElapsed' }], next.s).s.mode).toBe('handle');
    });
    it('the same id twice is one notice', () => {
      expect(run([{ type: 'finished', id: 'a' }, { type: 'finished', id: 'a' }]).s.done).toEqual(['a']);
    });
    it('an ask replaces a finished bubble at once; a finish never replaces an ask bubble', () => {
      const r = run([{ type: 'finished', id: 'a' }, unfold, { type: 'ask', id: 'b' }]);
      expect(r.s.mode).toBe('bubble'); expect(r.s.bubbleId).toBe('b'); expect(r.s.bubbleKind).toBe('ask'); expect(r.s.done).toEqual([]);
      const r2 = run([{ type: 'ask', id: 'b' }, unfold, { type: 'finished', id: 'a' }]);
      expect(r2.s.bubbleId).toBe('b'); expect(r2.s.bubbleKind).toBe('ask'); expect(r2.s.done).toEqual([]);
    });
    it('a finish while an ask waits in the handle, or while the list or a session is open, only shows in the handle', () => {
      expect(run([{ type: 'ask', id: 'b' }, { type: 'finished', id: 'a' }]).s.done).toEqual([]);
      expect(run([{ type: 'edgeEnter' }, { type: 'dwellElapsed' }, { type: 'finished', id: 'a' }]).s.done).toEqual([]);
      expect(run([{ type: 'botClick', id: 'b' }, { type: 'finished', id: 'a' }]).s.done).toEqual([]);
    });
    it('a finish during an edge dwell waits, and unfolds once the pointer leaves the edge', () => {
      const r = run([{ type: 'edgeEnter' }, { type: 'finished', id: 'a' }]);
      expect(r.s.done).toEqual(['a']); expect(r.s.unfoldDue).toBe(true); expect(r.effects.filter(e => e === 'startTimer:unfold')).toHaveLength(0);
      expect(run([{ type: 'edgeLeave' }], r.s).effects).toContain('startTimer:unfold');
    });
    it('hover pauses the 6 s clock, OK (close) and Open leave it, DND drops it, removal advances it', () => {
      const up = run([{ type: 'finished', id: 'a' }, unfold]).s;
      expect(run([{ type: 'surfaceEnter' }], up).effects).toContain('pauseTimer:bubble');
      expect(run([{ type: 'close' }], up).s).toMatchObject({ mode: 'handle', done: [] });
      expect(run([{ type: 'bubbleClick' }], up).s).toMatchObject({ mode: 'session', selectedId: 'a', done: [] });
      expect(run([{ type: 'dnd', on: true }], up).s).toMatchObject({ mode: 'handle', done: [] });
      expect(run([{ type: 'removed', id: 'a', remaining: ['b'] }], up).s).toMatchObject({ mode: 'handle', done: [] });
      expect(run([{ type: 'decidedInBubble' }], up).s.ack).toBeNull();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/overlay && pnpm vitest run test/machine.test.ts`
Expected: the new tests FAIL (unknown event type, `done` undefined).

- [ ] **Step 3: Extend the machine**

In `apps/overlay/src/surface/machine.ts`:

1. Types and constants:

```ts
export type BubbleKind = 'ask' | 'finished';
export interface SurfaceState {
  mode: Mode; selectedId: string | null; bubbleId: string | null; queue: string[]; openedBy: 'mouse' | 'keyboard' | null;
  /** What the bubble shows: a request to decide, or a finished notice (spec §5). */
  bubbleKind: BubbleKind;
  /** Finished notices waiting for, or showing in, a bubble; oldest first. Forgotten whenever the surface leaves the bubble. */
  done: string[];
  … (the rest unchanged)
}
/** A finished notice asks nothing, so it may stay a little longer than an ask (spec §5). */
export const FINISHED_BUBBLE_MS = 6000;
```

Add to `SurfaceEvent`: `| { type: 'finished'; id: string }`.

2. `initialSurface`: add `bubbleKind: 'ask', done: []`. `toHandle`: add `bubbleKind: 'ask', done: []`. `open`: add `bubbleKind: 'ask', done: []` to its state.

3. `showBubble` gets a kind:

```ts
const showBubble = (s: SurfaceState, id: string, extra: Effect[] = [], kind: BubbleKind = 'ask'): Result => ({
  state: { ...s, mode: 'bubble', bubbleId: id, bubbleKind: kind, ack: null, failed: null },
  effects: [...extra, start('bubble', kind === 'finished' ? FINISHED_BUBBLE_MS : TIMERS.bubble), ...(held(s) ? [{ type: 'pauseTimer', name: 'bubble' } as Effect] : [])]
});
```

4. Cases:

```ts
    case 'ask': {
      const queue = s.queue.includes(e.id) ? s.queue : [...s.queue, e.id];
      // A request always comes before a notice: it replaces a finished bubble in place.
      if (s.mode === 'bubble' && s.bubbleKind === 'finished') return showBubble({ ...s, queue, done: [] }, e.id);
      if (s.mode === 'handle' && !s.hot) return { state: { ...s, queue, unfoldDue: true }, effects: [start('unfold')] };
      return same({ ...s, queue, unfoldDue: s.unfoldDue || s.mode === 'handle' });
    }
    /* A bot finished its task (working → idle). Only the bare handle with nothing asked shows it; elsewhere the handle's
       smiling bot is the whole signal. During an edge dwell it waits like an ask. */
    case 'finished': {
      if (s.mode !== 'handle' || s.queue.length > 0 || s.done.includes(e.id)) return same(s);
      const done = [...s.done, e.id];
      if (!s.hot) return { state: { ...s, done, unfoldDue: true }, effects: [start('unfold')] };
      return same({ ...s, done, unfoldDue: true });
    }
    case 'unfoldElapsed': {
      const ask = s.queue[0]; const fin = s.done[0];
      if (s.mode !== 'handle' || s.hot || (ask === undefined && fin === undefined)) return same({ ...s, unfoldDue: false });
      return ask !== undefined ? showBubble({ ...s, unfoldDue: false }, ask) : showBubble({ ...s, unfoldDue: false }, fin!, [], 'finished');
    }
```

In `edgeLeave`, the re-arm condition becomes `s.mode === 'handle' && s.unfoldDue && (s.queue.length > 0 || s.done.length > 0)`.

`removed`: compute `const done = s.done.filter(id => id !== e.id);` and before the existing bubble checks add:

```ts
      if (s.mode === 'bubble' && s.bubbleKind === 'finished' && s.bubbleId === e.id)
        return done.length ? showBubble({ ...s, queue, done }, done[0], [], 'finished') : { state: toHandle({ ...s, queue }), effects: cancelAll };
```

and make every returned state in that case carry `done`.

`bubbleElapsed`:

```ts
    case 'bubbleElapsed': {
      if (s.mode !== 'bubble' || s.ack) return same(s);
      if (s.bubbleKind === 'finished' && s.done.length > 1) return showBubble({ ...s, done: s.done.slice(1) }, s.done[1], [], 'finished');
      return { state: toHandle(s), effects: [] };
    }
```

`decidedInBubble`: add `|| s.bubbleKind !== 'ask'` to its guard. `shortcut` (bubble → list): add `bubbleKind: 'ask', done: []`. `dnd` on: `const quiet = { ...s, queue: [], done: [], unfoldDue: false };`.

5. `transition`'s rev bump already fires on `bubbleId` changes; add `|| n.bubbleKind !== s.bubbleKind`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/overlay && pnpm vitest run test/machine.test.ts`
Expected: PASS, old and new.

- [ ] **Step 5: Typecheck and commit**

```bash
cd apps/overlay && pnpm typecheck && cd ../.. && git add apps/overlay/src/surface/machine.ts apps/overlay/test/machine.test.ts
git commit -m "feat(overlay): the surface machine shows a finished notice as a second bubble kind

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Session changes: finished, joined, left, asked, failed

**Files:**
- Create: `apps/overlay/src/daemon/changes.ts`
- Modify: `apps/overlay/src/surface/useDaemonAsks.ts`
- Test: `apps/overlay/test/changes.test.ts`

**Interfaces:**
- Produces:

```ts
// src/daemon/changes.ts
export type SessionChange =
  | { kind: 'joined'; id: string }
  | { kind: 'asked'; id: string; ask: 'approval' | 'question' }
  | { kind: 'finished'; id: string }
  | { kind: 'failed'; id: string }
  | { kind: 'left'; id: string; exitCode: number | null };
/** The one change a session update means, or null. `was` undefined = first sight. */
export function changeOf(was: Session | undefined, now: Session): SessionChange | null;
```

`useDaemonAsks` options gain `finishedBubble: boolean` and `onChange?: (c: SessionChange, info: { elapsedMs?: number }) => void`; it dispatches `{ type: 'finished', id }` when `finishedBubble && !dnd` on a `finished` change.

- [ ] **Step 1: Write the failing tests**

Create `apps/overlay/test/changes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { changeOf } from '../src/daemon/changes';
import { fakeSession } from './mockDaemon';

const s = (extra = {}) => fakeSession('a', extra);
const ask = { kind: 'permission', text: 'npm test', source: 'hook' } as const;

describe('changeOf', () => {
  it('first sight is a join', () => { expect(changeOf(undefined, s())).toEqual({ kind: 'joined', id: 'a' }); });
  it('working or starting to idle is a finish; idle again without working in between is not', () => {
    expect(changeOf(s({ state: 'working' }), s({ state: 'idle' }))).toEqual({ kind: 'finished', id: 'a' });
    expect(changeOf(s({ state: 'starting' }), s({ state: 'idle' }))).toEqual({ kind: 'finished', id: 'a' });
    expect(changeOf(s({ state: 'idle' }), s({ state: 'idle' }))).toBeNull();
    expect(changeOf(s({ state: 'waiting_permission', pending: ask }), s({ state: 'idle' }))).toBeNull();
  });
  it('a new request is an ask, typed by the state; the same request again is nothing', () => {
    expect(changeOf(s({ state: 'working' }), s({ state: 'waiting_permission', pending: ask }))).toEqual({ kind: 'asked', id: 'a', ask: 'approval' });
    expect(changeOf(s({ state: 'working' }), s({ state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } }))).toEqual({ kind: 'asked', id: 'a', ask: 'question' });
    expect(changeOf(s({ state: 'waiting_permission', pending: ask }), s({ state: 'waiting_permission', pending: ask }))).toBeNull();
  });
  it('into error, or an exit with a non-zero code, is a failure; a clean exit is a leave', () => {
    expect(changeOf(s({ state: 'working' }), s({ state: 'error', lastError: 'boom' }))).toEqual({ kind: 'failed', id: 'a' });
    expect(changeOf(s({ state: 'working' }), s({ state: 'exited', exitCode: 2 }))).toEqual({ kind: 'failed', id: 'a' });
    expect(changeOf(s({ state: 'working' }), s({ state: 'exited', exitCode: 0 }))).toEqual({ kind: 'left', id: 'a', exitCode: 0 });
    expect(changeOf(s({ state: 'working' }), s({ state: 'exited', exitCode: null }))).toEqual({ kind: 'left', id: 'a', exitCode: null });
    expect(changeOf(s({ state: 'exited', exitCode: 0 }), s({ state: 'exited', exitCode: 0 }))).toBeNull();
  });
  it('a preview or activity update is nothing', () => {
    expect(changeOf(s({ state: 'working' }), s({ state: 'working', lastActivityAt: '2026-10-09T18:05:00.000Z' }))).toBeNull();
  });
});
```

Append to `apps/overlay/test/surface.test.tsx` (inside `describe('<Surface>')`, reusing `pim`, `pimAsks`, `surface`, `mock`, `sleep`):

```tsx
  it('a bot that finishes its task (working → idle) unfolds a finished bubble that folds after 6 s', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '28px' });
    await act(async () => { vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '336px' });
    expect(screen.getByText('Pim finished')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5900); });
    expect(surface()).toHaveStyle({ width: '336px' });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('idle again without working in between is not a finish, and DND or the Handle-only setting keep the handle', async () => {
    localStorage.setItem('ledge.finished', 'none');
    const { rerender } = render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '28px' });
    localStorage.setItem('ledge.finished', 'both');
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '28px' });
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle', lastActivityAt: '2026-10-09T18:09:00.000Z' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '28px' });
  });
```

The second test reads the `ledge.finished` setting through the store of Task 2; because the store caches module state, call `resetSoundPrefsForTests()` (import from `../src/sounds/preferences`) right after each `localStorage.setItem` in that test. (These surface tests go red here and green at the end of Task 6.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/overlay && pnpm vitest run test/changes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `changes.ts`**

```ts
import type { Session } from '@ledge/protocol';

export type SessionChange =
  | { kind: 'joined'; id: string }
  | { kind: 'asked'; id: string; ask: 'approval' | 'question' }
  | { kind: 'finished'; id: string }
  | { kind: 'failed'; id: string }
  | { kind: 'left'; id: string; exitCode: number | null };

const pending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
const sameRequest = (a: Session['pending'], b: Session['pending']) => !!a && !!b && a.kind === b.kind && a.text === b.text && a.helperId === b.helperId;

/**
 * The one change a daemon update means for a session, or null (spec §5 and §7 ter). Pure, so the finished bubble and
 * the sound cues read the same facts: a finish is a real `working | starting → idle` transition, an ask is a request
 * that was not there before, a failure is `error` or a non-zero exit, a leave is a clean exit.
 */
export function changeOf(was: Session | undefined, now: Session): SessionChange | null {
  if (!was) return { kind: 'joined', id: now.id };
  if (now.state === 'exited' && was.state !== 'exited') {
    const code = now.exitCode ?? null;
    return code !== null && code !== 0 ? { kind: 'failed', id: now.id } : { kind: 'left', id: now.id, exitCode: code };
  }
  if (now.state === 'error' && was.state !== 'error') return { kind: 'failed', id: now.id };
  if (now.state === 'idle' && (was.state === 'working' || was.state === 'starting')) return { kind: 'finished', id: now.id };
  if (pending(now) && !(pending(was) && sameRequest(was.pending, now.pending))) return { kind: 'asked', id: now.id, ask: now.state === 'waiting_permission' ? 'approval' : 'question' };
  return null;
}
```

- [ ] **Step 4: Run the change tests to verify they pass**

Run: `cd apps/overlay && pnpm vitest run test/changes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Report changes and dispatch finishes from `useDaemonAsks`**

In `apps/overlay/src/surface/useDaemonAsks.ts`:

1. Import: `import { changeOf, type SessionChange } from '../daemon/changes';`
2. Options: add `finishedBubble: boolean; onChange?: (c: SessionChange, info: { elapsedMs?: number }) => void;` to the parameter type and destructure `finishedBubble`. Keep `onChange` in a ref like `onRejected`: `const onChange = useRef(o.onChange); onChange.current = o.onChange;`
3. A ref for the turn clock: `const workingSince = useRef<Map<string, number>>(new Map());`
4. In the sessions effect, at the top of the `for (const s of sessions)` loop body, before the existing `if (isPending(s) && !wasTracked)`:

```ts
      const change = changeOf(was, s);
      // The turn clock starts when a bot sets to work from rest; a permission answered mid-turn does not restart it.
      if (s.state === 'working' && (!was || was.state === 'idle' || was.state === 'starting')) workingSince.current.set(s.id, Date.now());
      if (change) {
        const since = workingSince.current.get(s.id);
        const elapsedMs = change.kind === 'finished' && since !== undefined ? Date.now() - since : undefined;
        if (change.kind === 'finished') workingSince.current.delete(s.id);
        onChange.current?.(change, { elapsedMs });
        if (change.kind === 'finished' && finishedBubble && !dnd) dispatch({ type: 'finished', id: s.id });
      }
```

and in the removal loop (`for (const id of before.keys()) if (!now.has(id))`) also `workingSince.current.delete(id)`.

5. Add `finishedBubble` to the effect's dependency array next to `dnd`.

- [ ] **Step 6: Typecheck**

Run: `cd apps/overlay && pnpm typecheck`
Expected: one error in `Surface.tsx` (`finishedBubble` missing in the `useDaemonAsks` call). Fix it minimally for now by passing `finishedBubble: true`; Task 6 wires the real setting.

Run: `cd apps/overlay && pnpm vitest run test/changes.test.ts test/surface.test.tsx`
Expected: changes PASS; in surface, the first new test fails only on the text `Pim finished` (the bubble unfolds but still renders the ask copy), the second fails on the `none` setting. Both go green in Task 6.

- [ ] **Step 7: Commit**

```bash
git add apps/overlay/src/daemon/changes.ts apps/overlay/src/surface/useDaemonAsks.ts apps/overlay/src/surface/Surface.tsx apps/overlay/test/changes.test.ts apps/overlay/test/surface.test.tsx
git commit -m "feat(overlay): session changes (joined, asked, finished, failed, left) and the finished event

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The finished bubble variant and its copy

**Files:**
- Modify: `apps/overlay/src/surface/Bubble.tsx`
- Modify: `apps/overlay/src/i18n/messages.ts`
- Modify: `apps/overlay/src/format.ts`
- Test: `apps/overlay/test/bubble.test.tsx`, `apps/overlay/test/format.test.ts`

**Interfaces:**
- Produces: `Bubble` props gain `kind?: BubbleKind` (default `'ask'`) and `elapsedMs?: number`; `format.ts` gains `export function duration(ms: number, t: Messages = messagesFor()): string`; messages gain `bubble.finished(name)`, `bubble.finishedSub(duration, project)`, `bubble.finishedSubNoTime(project)`, `bubble.ok`, `bubble.openSession`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/overlay/test/format.test.ts` (the file imports from `../src/format`; add `duration` to that import and `messagesFor` from `../src/i18n/lang` if not there):

```ts
describe('duration', () => {
  it('reads minutes and seconds in the current language', () => {
    expect(duration(160_000, messagesFor('en'))).toBe('2m 40s');
    expect(duration(160_000, messagesFor('fr'))).toBe('2 min 40 s');
    expect(duration(48_000, messagesFor('en'))).toBe('48s');
    expect(duration(3_600_000 + 5 * 60_000, messagesFor('en'))).toBe('1h 5m');
  });
});
```

Append to `apps/overlay/test/bubble.test.tsx` inside `describe('<Bubble>')`:

```tsx
  it('a finished notice speaks in the bot name, shows the work time and the project, and offers OK and Open', () => {
    const onOpen = vi.fn(); const onDismiss = vi.fn();
    const idle = fakeSession('a', { state: 'idle' });
    render(<Bubble session={idle} kind="finished" elapsedMs={160_000} moreCount={0} visible paused={false} onOpen={onOpen} onDismiss={onDismiss} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByText('Otto finished')).toBeInTheDocument();
    expect(screen.getByText('2m 40s of work · harness-assistant')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalled();
    expect(document.querySelector('[data-timer]')).toHaveAttribute('data-remaining', '6000');
  });
  it('a finished notice without a known work time shows the project alone', () => {
    render(<Bubble session={fakeSession('a', { state: 'idle' })} kind="finished" moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByText('harness-assistant')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/overlay && pnpm vitest run test/format.test.ts test/bubble.test.tsx`
Expected: FAIL (`duration` not exported; `kind` prop unknown, text not found).

- [ ] **Step 3: Add the copy**

In `apps/overlay/src/i18n/messages.ts`, in `fr.bubble` add after `lostDefault`:

```ts
    finished: (name: string) => `${name} a terminé`,
    finishedSub: (duration: string, project: string) => `${duration} de travail · ${project}`,
    finishedSubNoTime: (project: string) => project,
    ok: 'OK',
    openSession: 'Ouvrir',
```

and in `en.bubble`:

```ts
    finished: (name: string) => `${name} finished`,
    finishedSub: (duration: string, project: string) => `${duration} of work · ${project}`,
    finishedSubNoTime: (project: string) => project,
    ok: 'OK',
    openSession: 'Open',
```

(`en` is typed as `Messages`, so a key missing on either side fails `pnpm typecheck` and the "same keys" i18n test.)

- [ ] **Step 4: Add `duration` to `format.ts`**

```ts
/** A work duration from `t.time`: "2m 40s" / "2 min 40 s", "48s", "1h 5m". */
export function duration(ms: number, t: Messages = messagesFor()): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h > 0) return m > 0 ? `${t.time.hours(h)} ${t.time.minutes(m)}` : t.time.hours(h);
  if (m > 0) return s > 0 ? `${t.time.minutes(m)} ${t.time.seconds(s)}` : t.time.minutes(m);
  return t.time.seconds(s);
}
```

- [ ] **Step 5: The finished variant in `Bubble.tsx`**

1. Imports: `import { FINISHED_BUBBLE_MS, type BubbleKind } from './machine';`, `import { duration } from '../format';`, `import { Badge } from '../ui/Badge';`.
2. Props: add `kind?: BubbleKind; elapsedMs?: number;` to `BubbleProps`, and destructure `kind = 'ask', elapsedMs`.
3. The hold: `const holdMs = kind === 'finished' ? FINISHED_BUBBLE_MS : BUBBLE_HOLD_MS;` and use it in the default of `remainingMs` (`remainingMs = holdMs` cannot reference a later const; set `const remaining = remainingMs ?? holdMs;` and use `remaining` where `remainingMs` was used) and in `const pct = (left / holdMs) * 100;`.
4. `askKey`: for a finished bubble use `${session.id}:finished` so the bar segment restarts per notice: `const askKey = session ? (kind === 'finished' ? `${session.id}:finished` : `${session.id}:${pending?.helperId ?? ''}:${pending?.text ?? ''}`) : undefined;`
5. Title: `const title = !session ? '' : kind === 'finished' ? t.bubble.finished(session.name) : isQ ? … (unchanged)`.
6. Sub-line: replace the `<span className="mono" …>{pending?.text} · {session?.project}</span>` content with `{kind === 'finished' ? (elapsedMs !== undefined ? t.bubble.finishedSub(duration(elapsedMs, t), session!.project) : t.bubble.finishedSubNoTime(session!.project)) : <>{pending?.text} · {session?.project}</>}`.
7. Actions: wrap the existing `review ? … : …` ternary so that a finished bubble renders instead:

```tsx
        {kind === 'finished' ? (
          <>
            <Badge state="idle" />
            <span style={{ flexGrow: 1 }} />
            <Button variant="outline" size="sm" onClick={() => onDismiss?.()}>{t.bubble.ok}</Button>
            <Button variant="primary" size="sm" onClick={() => onOpen()}>{t.bubble.openSession}</Button>
          </>
        ) : review ? ( … unchanged … )}
```

(`Badge` with `state="idle"` reads `t.state.idle`, "Available" / "Disponible".) The `note` line and `moreCount` stay as they are (both empty for a finished bubble). Add `data-kind={kind}` on the root `div`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/overlay && pnpm vitest run test/format.test.ts test/bubble.test.tsx test/i18n.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
cd apps/overlay && pnpm typecheck && cd ../.. && git add apps/overlay/src/surface/Bubble.tsx apps/overlay/src/i18n/messages.ts apps/overlay/src/format.ts apps/overlay/test/bubble.test.tsx apps/overlay/test/format.test.ts
git commit -m "feat(overlay): the bubble has a finished variant with the work time, OK and Open

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Wire the finished bubble into the surface

**Files:**
- Modify: `apps/overlay/src/surface/Handle.tsx`
- Modify: `apps/overlay/src/surface/Surface.tsx`
- Test: `apps/overlay/test/surface.test.tsx` (the two tests added in Task 4), `apps/overlay/test/handle.test.tsx`

**Interfaces:**
- Consumes: `useSoundPrefs()` (Task 2), `SurfaceState.bubbleKind`/`done` (Task 3), `useDaemonAsks({ finishedBubble, onChange })` (Task 4), `Bubble kind/elapsedMs` (Task 5).
- Produces: `HandleBot.lifted?: boolean` (drawn big, no tick, full opacity).

- [ ] **Step 1: Write the failing handle test**

Append to `apps/overlay/test/handle.test.tsx` (look at the file's existing render helper for `Handle`; it passes `bots`, `slots`, `big`, `visible`, `hoverId`, `onHover`, `onOpen`):

```tsx
  it('a lifted bot (finishing) is drawn big without the edge tick', () => {
    const bots = [{ id: 'a', name: 'Otto', tool: 'claude', state: 'idle', pose: 1, pending: false, lifted: true, tip: '' }] as const;
    render(<Handle bots={bots as never} slots={[{ id: 'a', size: 20, center: 18 }]} big={20} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const btn = screen.getByRole('button', { name: /Otto/ });
    expect(btn).toHaveStyle({ width: '20px', opacity: '1' });
    expect(btn.querySelector('[data-tick]')).toHaveStyle({ opacity: '0' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/overlay && pnpm vitest run test/handle.test.tsx`
Expected: FAIL on width (12px) or opacity.

- [ ] **Step 3: `Handle.tsx`**

Add `lifted?: boolean` to `HandleBot`. In the map: `const up = b.pending || !!b.lifted; const size = up ? big : small; const base = up ? 1 : small / big;` and opacity `hov || up ? 1 : quiet ? 0.55 : 0.8`; the `data-sprite` transition uses `up || hov ? 'pop' : 'shrink'`. The tick keeps `b.pending` (opacity 1 only for a real ask).

- [ ] **Step 4: `Surface.tsx` wiring**

1. Imports: `import { useSoundPrefs } from '../sounds/preferences';`
2. After `const motionPrefs = …`: `const prefs = useSoundPrefs();` and `const finishedBubble = prefs.finished === 'both' || prefs.finished === 'bubble';`
3. Finished work times, so the bubble can say "2m 40s of work": `const [elapsed, setElapsed] = useState<Record<string, number>>({});`
4. The `useDaemonAsks` call: replace `finishedBubble: true` by `finishedBubble`, and add `onChange: (c, info) => { if (c.kind === 'finished' && info.elapsedMs !== undefined) setElapsed(x => ({ ...x, [c.id]: info.elapsedMs! })); }` (Task 8 extends this callback with the sound hook).
5. The lifted bot: the finishing bot is big from the moment its notice is due until the bubble folds.

```tsx
  const liftedId = st.queue.length === 0 && st.done.length > 0 && (st.unfoldDue || (st.mode === 'bubble' && st.bubbleKind === 'finished')) ? st.done[0] : null;
```

In the `bots` memo add `lifted: s.id === liftedId` (and `liftedId` to its deps). In `scaledLayout` pass `bots: bots.map(b => ({ id: b.id, pending: b.pending || !!b.lifted }))`.

6. The `Bubble` element: add `kind={st.bubbleKind} elapsedMs={st.bubbleId ? elapsed[st.bubbleId] : undefined}`. For a finished bubble `onDismiss` already dispatches `close`, `onOpen` already dispatches `bubbleClick`: no change.
7. `bubblePaused` is unchanged (hover, focus, hidden, ack).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/overlay && pnpm vitest run test/handle.test.tsx test/surface.test.tsx`
Expected: PASS, including the two surface tests written in Task 4.

- [ ] **Step 6: Full overlay suite, typecheck, commit**

Run: `cd apps/overlay && pnpm typecheck && pnpm vitest run`
Expected: PASS.

```bash
git add apps/overlay/src/surface/Handle.tsx apps/overlay/src/surface/Surface.tsx apps/overlay/test/handle.test.tsx
git commit -m "feat(overlay): a bot that finishes its task grows and unfolds a 6 s finished bubble

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Sound cues, the player and the pure decision

**Files:**
- Create: `apps/overlay/src/sounds/cues.ts`
- Create: `apps/overlay/src/sounds/player.ts`
- Create: `apps/overlay/src/sounds/decide.ts`
- Test: `apps/overlay/test/sounds.test.ts`

**Interfaces:**
- Produces:

```ts
// cues.ts
export type Cue = 'approval' | 'question' | 'finished' | 'error' | 'accept' | 'deny' | 'join' | 'leave';
export interface Note { freq: number; at: number; dur: number; type: 'sine' | 'triangle'; gain: number; glideTo?: number }  // seconds
export const CUES: Record<Cue, Note[]>;
export const CATEGORY_OF: Record<Cue, SoundCategory>;
export const USER_CUES: ReadonlySet<Cue>;   // accept, deny
// player.ts
export interface SoundPlayer { play(cue: Cue, gain: number): void }
export function createWebAudioPlayer(): SoundPlayer;
export function createSilentPlayer(): SoundPlayer;
// decide.ts
export interface SoundInput { cue: Cue; sounds: SoundPrefs; finished: FinishedNotify; dnd: boolean; terminalInFront: boolean; lastPlayedAt: number | null; connectedAt: number | null; now: number }
export type SoundDecision = { play: true; gain: number } | { play: false; why: 'off' | 'dnd' | 'finished-setting' | 'category' | 'terminal' | 'snapshot' | 'rate' };
export const SOUND_RATE_MS = 1500;
export function decideSound(i: SoundInput): SoundDecision;
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/overlay/test/sounds.test.ts`:

```ts
import { CUES, CATEGORY_OF, USER_CUES } from '../src/sounds/cues';
import { decideSound, SOUND_RATE_MS } from '../src/sounds/decide';
import { createWebAudioPlayer } from '../src/sounds/player';

describe('cues', () => {
  it('every cue is sine or triangle, under 350 ms, peaking at or under the −18 dBFS gain', () => {
    for (const [name, notes] of Object.entries(CUES)) {
      expect(notes.length, name).toBeGreaterThan(0);
      const end = Math.max(...notes.map(n => n.at + n.dur));
      expect(end, name).toBeLessThanOrEqual(0.35);
      for (const n of notes) { expect(['sine', 'triangle']).toContain(n.type); expect(n.gain).toBeLessThanOrEqual(0.14); expect(n.gain).toBeGreaterThan(0); }
    }
    expect(CATEGORY_OF.approval).toBe('requests'); expect(CATEGORY_OF.question).toBe('requests'); expect(CATEGORY_OF.finished).toBe('finished');
    expect(CATEGORY_OF.error).toBe('errors'); expect(CATEGORY_OF.accept).toBe('decisions'); expect(CATEGORY_OF.deny).toBe('decisions');
    expect(CATEGORY_OF.join).toBe('team'); expect(CATEGORY_OF.leave).toBe('team');
    expect([...USER_CUES].sort()).toEqual(['accept', 'deny']);
  });
  it('asks rise or knock, results fall, decisions are single ticks', () => {
    expect(CUES.question[1].freq).toBeGreaterThan(CUES.question[0].freq);
    expect(CUES.finished[1].freq).toBeLessThan(CUES.finished[0].freq);
    expect(CUES.approval).toHaveLength(2); expect(CUES.approval[0].freq).toBe(CUES.approval[1].freq);
    expect(CUES.accept).toHaveLength(1); expect(CUES.deny).toHaveLength(1); expect(CUES.accept[0].freq).toBeGreaterThan(CUES.deny[0].freq);
    expect(CUES.error[0].glideTo!).toBeLessThan(CUES.error[0].freq);
  });
});

describe('decideSound', () => {
  const base = { sounds: DEFAULT_SOUNDS, finished: 'both' as const, dnd: false, terminalInFront: false, lastPlayedAt: null, connectedAt: null, now: 100_000 };
  it('plays an approval at the volume gain', () => {
    expect(decideSound({ ...base, cue: 'approval' })).toEqual({ play: true, gain: 1 });
    expect(decideSound({ ...base, cue: 'approval', sounds: { ...DEFAULT_SOUNDS, volume: 'loud' } })).toEqual({ play: true, gain: 1.8 });
  });
  it('is cut by the switch, DND, the category, and the terminal in front', () => {
    expect(decideSound({ ...base, cue: 'approval', sounds: { ...DEFAULT_SOUNDS, enabled: false } })).toEqual({ play: false, why: 'off' });
    expect(decideSound({ ...base, cue: 'approval', dnd: true })).toEqual({ play: false, why: 'dnd' });
    expect(decideSound({ ...base, cue: 'join' })).toEqual({ play: false, why: 'category' });   // team is off by default
    expect(decideSound({ ...base, cue: 'approval', terminalInFront: true })).toEqual({ play: false, why: 'terminal' });
    expect(decideSound({ ...base, cue: 'approval', terminalInFront: true, sounds: { ...DEFAULT_SOUNDS, onlyWhenTerminalBehind: false } }).play).toBe(true);
  });
  it('the finished cue follows the finished setting', () => {
    expect(decideSound({ ...base, cue: 'finished', finished: 'bubble' })).toEqual({ play: false, why: 'finished-setting' });
    expect(decideSound({ ...base, cue: 'finished', finished: 'none' })).toEqual({ play: false, why: 'finished-setting' });
    expect(decideSound({ ...base, cue: 'finished', finished: 'sound' }).play).toBe(true);
  });
  it('one cue per 1.5 s, except the user\'s own ticks, which always play', () => {
    expect(decideSound({ ...base, cue: 'question', lastPlayedAt: base.now - SOUND_RATE_MS + 1 })).toEqual({ play: false, why: 'rate' });
    expect(decideSound({ ...base, cue: 'question', lastPlayedAt: base.now - SOUND_RATE_MS }).play).toBe(true);
    expect(decideSound({ ...base, cue: 'accept', lastPlayedAt: base.now - 300 }).play).toBe(true);
    expect(decideSound({ ...base, cue: 'deny', lastPlayedAt: base.now - 300, terminalInFront: true }).play).toBe(true);
  });
  it('join cues are swallowed right after connect (snapshot replay), other cues are not', () => {
    const team = { ...DEFAULT_SOUNDS, categories: { ...DEFAULT_SOUNDS.categories, team: true } };
    expect(decideSound({ ...base, cue: 'join', sounds: team, connectedAt: base.now - 1000 })).toEqual({ play: false, why: 'snapshot' });
    expect(decideSound({ ...base, cue: 'join', sounds: team, connectedAt: base.now - 2000 }).play).toBe(true);
    expect(decideSound({ ...base, cue: 'approval', connectedAt: base.now - 1000 }).play).toBe(true);
  });
});

describe('createWebAudioPlayer', () => {
  it('without an AudioContext (jsdom) it is silent and never throws', () => {
    const p = createWebAudioPlayer();
    expect(() => p.play('approval', 1)).not.toThrow();
  });
});
```

Make sure `DEFAULT_SOUNDS` is imported at the top of the test file (it is, from Task 2).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/overlay && pnpm vitest run test/sounds.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `cues.ts`**

```ts
import type { SoundCategory } from './preferences';

export type Cue = 'approval' | 'question' | 'finished' | 'error' | 'accept' | 'deny' | 'join' | 'leave';
/** One oscillator: times in seconds from the cue start, `gain` the peak at Normal volume (0.12 ≈ −18 dBFS). */
export interface Note { freq: number; at: number; dur: number; type: 'sine' | 'triangle'; gain: number; glideTo?: number }

/** The palette (spec §7 ter): one family, asks rise or knock, results fall, the user's actions are ticks. */
export const CUES: Record<Cue, Note[]> = {
  approval: [{ freq: 220, at: 0, dur: 0.07, type: 'triangle', gain: 0.14 }, { freq: 220, at: 0.11, dur: 0.08, type: 'triangle', gain: 0.14 }],
  question: [{ freq: 659.25, at: 0, dur: 0.09, type: 'sine', gain: 0.12 }, { freq: 880, at: 0.09, dur: 0.16, type: 'sine', gain: 0.12 }],
  finished: [{ freq: 880, at: 0, dur: 0.14, type: 'sine', gain: 0.12 }, { freq: 587.33, at: 0.13, dur: 0.19, type: 'sine', gain: 0.12 }],
  error: [{ freq: 180, at: 0, dur: 0.22, type: 'triangle', gain: 0.12, glideTo: 120 }],
  accept: [{ freq: 1318.5, at: 0, dur: 0.035, type: 'sine', gain: 0.1 }],
  deny: [{ freq: 659.25, at: 0, dur: 0.045, type: 'sine', gain: 0.1 }],
  join: [{ freq: 330, at: 0, dur: 0.07, type: 'sine', gain: 0.1, glideTo: 660 }],
  leave: [{ freq: 330, at: 0, dur: 0.18, type: 'triangle', gain: 0.08, glideTo: 240 }]
};
export const CATEGORY_OF: Record<Cue, SoundCategory> = { approval: 'requests', question: 'requests', finished: 'finished', error: 'errors', accept: 'decisions', deny: 'decisions', join: 'team', leave: 'team' };
/** The user's own ticks: never rate-limited, never muted by the terminal rule (they clicked in the overlay). */
export const USER_CUES: ReadonlySet<Cue> = new Set<Cue>(['accept', 'deny']);
```

- [ ] **Step 4: `player.ts`**

```ts
import { CUES, type Cue } from './cues';

export interface SoundPlayer { play(cue: Cue, gain: number): void }

export function createSilentPlayer(): SoundPlayer { return { play() {} }; }

/**
 * Web Audio synthesis, no files (spec §7 ter). The context is created on the first cue and reused; a browser that has
 * none, or refuses it, makes the player silent without an error. 8 ms attack, exponential release, peak capped at 0.5.
 */
export function createWebAudioPlayer(): SoundPlayer {
  let ctx: AudioContext | null | undefined;
  const context = (): AudioContext | null => {
    if (ctx === undefined) {
      const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      try { ctx = AC ? new AC() : null; } catch { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx ?? null;
  };
  return {
    play(cue, gain) {
      const c = context(); if (!c) return;
      try {
        const t0 = c.currentTime;
        for (const n of CUES[cue]) {
          const o = c.createOscillator(), g = c.createGain();
          const peak = Math.min(0.5, n.gain * gain);
          o.type = n.type; o.frequency.setValueAtTime(n.freq, t0 + n.at);
          if (n.glideTo) o.frequency.exponentialRampToValueAtTime(n.glideTo, t0 + n.at + n.dur);
          g.gain.setValueAtTime(0.0001, t0 + n.at);
          g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
          o.connect(g); g.connect(c.destination);
          o.start(t0 + n.at); o.stop(t0 + n.at + n.dur + 0.02);
        }
      } catch { /* a cue that cannot play is dropped: sound is never load-bearing */ }
    }
  };
}
```

- [ ] **Step 5: `decide.ts`**

```ts
import { CATEGORY_OF, USER_CUES, type Cue } from './cues';
import { VOLUME_GAIN, type FinishedNotify, type SoundPrefs } from './preferences';

/** One cue per 1.5 s (spec §7 ter): a burst of asks plays once, the handle shows the rest. */
export const SOUND_RATE_MS = 1500;
/** A snapshot right after connect replays every session as a join: those are not arrivals. */
export const SNAPSHOT_QUIET_MS = 1500;

export interface SoundInput { cue: Cue; sounds: SoundPrefs; finished: FinishedNotify; dnd: boolean; terminalInFront: boolean; lastPlayedAt: number | null; connectedAt: number | null; now: number }
export type SoundDecision = { play: true; gain: number } | { play: false; why: 'off' | 'dnd' | 'finished-setting' | 'category' | 'terminal' | 'snapshot' | 'rate' };

/** Pure: whether a cue plays now and how loud. The order of the cuts is the order of the settings view. */
export function decideSound(i: SoundInput): SoundDecision {
  const user = USER_CUES.has(i.cue);
  if (!i.sounds.enabled) return { play: false, why: 'off' };
  if (i.dnd) return { play: false, why: 'dnd' };
  if (i.cue === 'finished' && i.finished !== 'both' && i.finished !== 'sound') return { play: false, why: 'finished-setting' };
  if (!i.sounds.categories[CATEGORY_OF[i.cue]]) return { play: false, why: 'category' };
  if (!user && i.sounds.onlyWhenTerminalBehind && i.terminalInFront) return { play: false, why: 'terminal' };
  if (i.cue === 'join' && i.connectedAt !== null && i.now - i.connectedAt < SNAPSHOT_QUIET_MS) return { play: false, why: 'snapshot' };
  if (!user && i.lastPlayedAt !== null && i.now - i.lastPlayedAt < SOUND_RATE_MS) return { play: false, why: 'rate' };
  return { play: true, gain: VOLUME_GAIN[i.sounds.volume] };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/overlay && pnpm vitest run test/sounds.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
cd apps/overlay && pnpm typecheck && cd ../.. && git add apps/overlay/src/sounds apps/overlay/test/sounds.test.ts
git commit -m "feat(overlay): sound cues, a Web Audio player and the pure play decision

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Play the cues: the hook, the surface, the terminal check and autoplay

**Files:**
- Create: `apps/overlay/src/sounds/useSounds.ts`
- Modify: `apps/overlay/src/tauri/bridge.ts`
- Modify: `apps/overlay/src-tauri/src/main.rs`
- Modify: `apps/overlay/src-tauri/tauri.conf.json`
- Modify: `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/App.tsx`
- Test: `apps/overlay/test/surface.test.tsx`

**Interfaces:**
- Produces:

```ts
// useSounds.ts
export function useSounds(o: { player: SoundPlayer; dnd: boolean; status: DaemonStatus; terminalInFront?: () => Promise<boolean> }): { onChange: (c: SessionChange) => void; user: (cue: 'accept' | 'deny') => void; test: () => void };
// bridge.ts
export async function foregroundIsTerminal(): Promise<boolean>;   // false outside Tauri or on error
```

`Surface` gains the prop `soundPlayer?: SoundPlayer` (default: a Web Audio player created once per app in `App.tsx`; tests pass a fake).

- [ ] **Step 1: Write the failing surface tests**

Append to `apps/overlay/test/surface.test.tsx`:

```tsx
  describe('sounds', () => {
    const fakePlayer = () => { const played: Array<[string, number]> = []; return { played, play: (c: string, g: number) => { played.push([c, g]); } }; };
    it('an ask knocks, a finish falls, approve ticks; a second ask within 1.5 s is silent', async () => {
      const p = fakePlayer();
      render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { vi.advanceTimersByTime(2000); });                       // past the snapshot quiet window
      await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
      await waitFor(() => expect(p.played).toEqual([['approval', 1]]));
      await act(async () => { mock.upsert(fakeSession('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })); await sleep(50); });
      expect(p.played).toHaveLength(1);                                                 // rate limited
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(p.played.at(-1)).toEqual(['accept', 1]));               // the user's tick always plays
      await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); vi.advanceTimersByTime(2000); });
      await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); });
      await waitFor(() => expect(p.played.at(-1)).toEqual(['finished', 1]));
    });
    it('the snapshot on connect plays no join; DND and the switch silence everything; Sound-only finish plays without a bubble', async () => {
      const p = fakePlayer();
      localStorage.setItem('ledge.sounds', JSON.stringify({ ...DEFAULT_SOUNDS, categories: { ...DEFAULT_SOUNDS.categories, team: true } })); resetSoundPrefsForTests();
      const { rerender } = render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { await sleep(100); });
      expect(p.played).toEqual([]);                                                      // two sessions in the snapshot, no pops
      rerender(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { vi.advanceTimersByTime(2000); mock.upsert(pimAsks()); await sleep(50); });
      expect(p.played).toEqual([]);
      localStorage.setItem('ledge.finished', 'sound'); resetSoundPrefsForTests();
      rerender(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); vi.advanceTimersByTime(2000); mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
      await waitFor(() => expect(p.played).toEqual([['finished', 1]]));
      expect(surface()).toHaveStyle({ width: '28px' });
    });
  });
```

Add the imports `DEFAULT_SOUNDS, resetSoundPrefsForTests` from `../src/sounds/preferences` and `fakeSession` is already imported. In the file's `beforeEach`, add `localStorage.clear(); resetSoundPrefsForTests();` so settings never leak between tests.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/overlay && pnpm vitest run test/surface.test.tsx -t sounds`
Expected: FAIL (`soundPlayer` ignored, nothing played).

- [ ] **Step 3: `bridge.ts`**

Add next to `focusTerminal`:

```ts
/** Whether Windows Terminal is the foreground window (the "only when the terminal is behind" sound rule). False outside Tauri. */
export async function foregroundIsTerminal(): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke<boolean>('foreground_is_terminal').catch(() => false);
}
```

- [ ] **Step 4: `useSounds.ts`**

```ts
import { useEffect, useRef } from 'react';
import type { SessionChange } from '../daemon/changes';
import type { DaemonStatus } from '../daemon/client';
import { foregroundIsTerminal } from '../tauri/bridge';
import { decideSound } from './decide';
import type { Cue } from './cues';
import type { SoundPlayer } from './player';
import { useSoundPrefs } from './preferences';

const cueOf = (c: SessionChange): Cue | null => {
  switch (c.kind) {
    case 'asked': return c.ask === 'approval' ? 'approval' : 'question';
    case 'finished': return 'finished';
    case 'failed': return 'error';
    case 'joined': return 'join';
    case 'left': return 'leave';
  }
};

/**
 * Turns session changes and the user's decisions into cues through `decideSound` (spec §7 ter). Owns the two clocks the
 * decision needs: the last cue played and the moment the daemon connected. The terminal check is async (a Tauri command),
 * so a cue is decided once that answer is in; nothing visual ever waits for it.
 */
export function useSounds(o: { player: SoundPlayer; dnd: boolean; status: DaemonStatus; terminalInFront?: () => Promise<boolean> }) {
  const { finished, sounds } = useSoundPrefs();
  const live = useRef({ player: o.player, dnd: o.dnd, finished, sounds, check: o.terminalInFront ?? foregroundIsTerminal });
  live.current = { player: o.player, dnd: o.dnd, finished, sounds, check: o.terminalInFront ?? foregroundIsTerminal };
  const lastPlayedAt = useRef<number | null>(null);
  const connectedAt = useRef<number | null>(null);
  useEffect(() => { if (o.status === 'open') connectedAt.current = Date.now(); }, [o.status]);

  const play = (cue: Cue) => {
    const l = live.current;
    const needsCheck = l.sounds.onlyWhenTerminalBehind && cue !== 'accept' && cue !== 'deny';
    void (needsCheck ? l.check() : Promise.resolve(false)).then(front => {
      const now = Date.now();
      const d = decideSound({ cue, sounds: l.sounds, finished: l.finished, dnd: l.dnd, terminalInFront: front, lastPlayedAt: lastPlayedAt.current, connectedAt: connectedAt.current, now });
      if (!d.play) return;
      lastPlayedAt.current = now;
      l.player.play(cue, d.gain);
    });
  };
  return {
    onChange: (c: SessionChange) => { const cue = cueOf(c); if (cue) play(cue); },
    user: (cue: 'accept' | 'deny') => play(cue),
    /** The settings' Test button: the question cue, through the volume only (no DND, category or terminal cut). */
    test: () => { const l = live.current; l.player.play('question', decideSound({ cue: 'question', sounds: { ...l.sounds, enabled: true, onlyWhenTerminalBehind: false, categories: { ...l.sounds.categories, requests: true } }, finished: 'both', dnd: false, terminalInFront: false, lastPlayedAt: null, connectedAt: null, now: 0 }).play ? ({ quiet: 0.5, normal: 1, loud: 1.8 }[l.sounds.volume]) : 1); }
  };
}
```

`DaemonStatus` is `'connecting' | 'open' | 'unreachable'` (`src/daemon/client.ts`): `'open'` is the connected state.

- [ ] **Step 5: `Surface.tsx` and `App.tsx`**

1. `Surface` props: add `soundPlayer?: SoundPlayer;` (import type from `../sounds/player`), default `createSilentPlayer()` so a `Surface` rendered without one never touches Web Audio (tests, storybook-like renders): `const player = useMemo(() => soundPlayer ?? createSilentPlayer(), [soundPlayer]);`
2. `const sounds = useSounds({ player, dnd, status });` placed before the `useDaemonAsks` call.
3. In the `useDaemonAsks` `onChange` callback add `sounds.onChange(c);` first.
4. In `decide`, after `send({ type: 'session.decide', … })`: `sounds.user(d === 'accept' ? 'accept' : 'deny');`. In `reply`, after `send({ type: 'session.reply', … })`: `sounds.user('accept');`.
5. Keep `sounds.test` for Task 9 (pass it to the settings view there).
6. `App.tsx`: `const [player] = useState(() => createWebAudioPlayer());` and pass `soundPlayer={player}` to `Surface`.

- [ ] **Step 6: The Rust command and the autoplay policy**

In `apps/overlay/src-tauri/src/main.rs`, next to `focus_terminal`:

```rust
/// Windows Terminal's top-level window class (Cascadia). Its tab titles vary; the class does not.
#[cfg(windows)]
#[tauri::command]
fn foreground_is_terminal() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return false; }
        let mut buf = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut buf) as usize;
        String::from_utf16_lossy(&buf[..n]) == "CASCADIA_HOSTING_WINDOW_CLASS"
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn foreground_is_terminal() -> bool { false }
```

Register it: `tauri::generate_handler![set_frame, set_hot_zones, focus_overlay, release_focus, focus_terminal, foreground_is_terminal, list_monitors, set_monitor]`.

In `apps/overlay/src-tauri/tauri.conf.json`, on the `main` window object add `"additionalBrowserArgs": "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required"` (the first three flags are Tauri's own defaults, which this key replaces; the last one lets `AudioContext` start without a click, since the overlay never receives one before its first cue).

- [ ] **Step 7: Run the tests, typecheck, full suite**

Run: `cd apps/overlay && pnpm typecheck && pnpm vitest run`
Expected: PASS (the sounds surface tests included). Note in the commit that the Rust side was compiled on Windows only if it was; otherwise say it awaits a Windows build (the `#[cfg]` split mirrors `focus_terminal`, which builds).

- [ ] **Step 8: Commit**

```bash
git add apps/overlay/src/sounds/useSounds.ts apps/overlay/src/tauri/bridge.ts apps/overlay/src-tauri/src/main.rs apps/overlay/src-tauri/tauri.conf.json apps/overlay/src/surface/Surface.tsx apps/overlay/src/App.tsx apps/overlay/test/surface.test.tsx
git commit -m "feat(overlay): sound cues for asks, results and decisions, quiet when the terminal is in front

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The Settings sections, copy and docs

**Files:**
- Modify: `apps/overlay/src/surface/SettingsView.tsx`
- Modify: `apps/overlay/src/surface/Surface.tsx`
- Modify: `apps/overlay/src/i18n/messages.ts`
- Modify: `docs/tour.md`
- Test: `apps/overlay/test/settings.test.tsx`

**Interfaces:**
- Consumes: `useSoundPrefs`, `FinishedNotify`, `SoundPrefs`, `SoundCategory` (Task 2), `sounds.test` (Task 8), `Segmented` (already exported by `SettingsView.tsx`).
- Produces: `SettingsViewProps` gain `finished: FinishedNotify; onFinished: (v: FinishedNotify) => void; sounds: SoundPrefs; onSounds: (patch: SoundPatch) => void; onTestSound: () => void;`.

- [ ] **Step 1: Write the failing tests**

Create `apps/overlay/test/settings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsView } from '../src/surface/SettingsView';
import { LangProvider } from '../src/i18n/lang';
import { DEFAULT_SOUNDS, type SoundPatch } from '../src/sounds/preferences';

const base = { visible: true, theme: 'dark' as const, dnd: false, reduced: false, osReduced: false, onToggleDnd: () => {}, onReduced: () => {}, onBack: () => {}, onClose: () => {} };
const view = (extra = {}) => {
  const onFinished = vi.fn(); const onSounds = vi.fn<(p: SoundPatch) => void>(); const onTestSound = vi.fn();
  render(<LangProvider lang="en"><SettingsView {...base} finished="both" sounds={DEFAULT_SOUNDS} onFinished={onFinished} onSounds={onSounds} onTestSound={onTestSound} {...extra} /></LangProvider>);
  return { onFinished, onSounds, onTestSound };
};

describe('<SettingsView> notifications and sounds', () => {
  beforeEach(() => localStorage.clear());
  it('offers the four finished modes and reports a choice', () => {
    const { onFinished } = view();
    expect(screen.getByRole('radio', { name: 'Bubble and sound' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Handle only' }));
    expect(onFinished).toHaveBeenCalledWith('none');
  });
  it('the Sounds switch, the volume, the categories and the terminal rule each send one patch', () => {
    const { onSounds, onTestSound } = view();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sounds' }));
    expect(onSounds).toHaveBeenLastCalledWith({ enabled: false });
    fireEvent.click(screen.getByRole('radio', { name: 'Loud' }));
    expect(onSounds).toHaveBeenLastCalledWith({ volume: 'loud' });
    fireEvent.click(screen.getByRole('checkbox', { name: /A bot joins or leaves/ }));
    expect(onSounds).toHaveBeenLastCalledWith({ categories: { team: true } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only when the terminal is behind' }));
    expect(onSounds).toHaveBeenLastCalledWith({ onlyWhenTerminalBehind: false });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(onTestSound).toHaveBeenCalled();
  });
  it('with sounds off the sound sections are dimmed but still reachable', () => {
    view({ sounds: { ...DEFAULT_SOUNDS, enabled: false } });
    expect(screen.getByTestId('sound-sections')).toHaveStyle({ opacity: '0.5' });
    expect(screen.getByRole('radio', { name: 'Loud' })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/overlay && pnpm vitest run test/settings.test.tsx`
Expected: FAIL (props unknown, controls missing).

- [ ] **Step 3: The copy**

In `apps/overlay/src/i18n/messages.ts`, in `fr.settings` add:

```ts
    finished: 'Quand un bot a terminé', finishedHint: 'Une bulle de 6 s, un son, les deux, ou seulement la poignée.',
    finishedBoth: 'Bulle et son', finishedBubble: 'Bulle', finishedSound: 'Son', finishedNone: 'Poignée seule',
    sounds: 'Sons', soundsHint: 'Des tons courts et doux pour ce qui vous attend. Jamais en Ne pas déranger.',
    volume: 'Volume', volumeHint: 'Test joue le signal de question.', volumeQuiet: 'Bas', volumeNormal: 'Normal', volumeLoud: 'Fort', test: 'Test',
    playWhen: 'Jouer un son quand',
    category: { requests: 'Un bot a besoin de vous · accord, question', finished: 'Un bot a terminé sa tâche', errors: 'Quelque chose échoue', decisions: 'Vous acceptez ou refusez', team: 'Un bot arrive ou part' } as Record<SoundCategory, string>,
    behind: 'Seulement quand le terminal est derrière', behindHint: 'Si l’onglet Windows Terminal de ce bot est devant, vous regardez déjà : pas de son, la bulle s’affiche quand même.',
    soundsNote: 'Un seul son à la fois : une rafale de demandes ne joue qu’une fois, la poignée montre le reste. Ouvrir, fermer et survoler sont silencieux.'
```

and in `en.settings`:

```ts
    finished: 'When a bot finishes', finishedHint: 'A 6 s bubble, a sound, both, or the handle only.',
    finishedBoth: 'Bubble and sound', finishedBubble: 'Bubble', finishedSound: 'Sound', finishedNone: 'Handle only',
    sounds: 'Sounds', soundsHint: 'Short, soft tones for what needs you. Never while Do not disturb is on.',
    volume: 'Volume', volumeHint: 'Test plays the question cue.', volumeQuiet: 'Quiet', volumeNormal: 'Normal', volumeLoud: 'Loud', test: 'Test',
    playWhen: 'Play a sound when',
    category: { requests: 'A bot needs you · approval, question', finished: 'A bot finishes its task', errors: 'Something fails', decisions: 'You approve or deny', team: 'A bot joins or leaves' } as Record<SoundCategory, string>,
    behind: 'Only when the terminal is behind', behindHint: 'If that bot’s Windows Terminal tab is in front, you are already looking: no sound, the bubble still shows.',
    soundsNote: 'One sound at a time: a burst of asks plays once, the handle shows the rest. Opening, closing and hovering are silent.'
```

Import `SoundCategory` type at the top of `messages.ts`: `import type { SoundCategory } from '../sounds/preferences';`

- [ ] **Step 4: `SettingsView.tsx`**

1. Imports: `import { CATEGORIES, FINISHED_VALUES, VOLUMES, type FinishedNotify, type SoundPrefs, type SoundPatch } from '../sounds/preferences';`
2. Props (add to `SettingsViewProps`): `finished: FinishedNotify; onFinished: (v: FinishedNotify) => void; sounds: SoundPrefs; onSounds: (patch: SoundPatch) => void; onTestSound: () => void;`
3. Give `Switch` an optional `name` used as the input's `aria-label` fallback: the existing `Switch` wraps a `<label>` with the text, so `getByRole('checkbox', { name: 'Sounds' })` works as long as the label's first text node is the title; keep the hint in a separate `<span>` inside the label. If the accessible name concatenates title and hint, set `aria-label={label}` on the input.
4. After the `Reduced motion` row (and before the theme button) render:

```tsx
          <Row><Segmented<FinishedNotify> name="ledge-finished" label={t.settings.finished} hint={t.settings.finishedHint} value={p.finished} onChange={p.onFinished}
            options={FINISHED_VALUES.map(v => ({ value: v, label: { both: t.settings.finishedBoth, bubble: t.settings.finishedBubble, sound: t.settings.finishedSound, none: t.settings.finishedNone }[v], wide: v === 'both' }))} /></Row>
          <Row><Switch label={t.settings.sounds} hint={t.settings.soundsHint} checked={p.sounds.enabled} onChange={on => p.onSounds({ enabled: on })} /></Row>
          <div data-testid="sound-sections" style={{ opacity: p.sounds.enabled ? 1 : 0.5, transition: transition([['opacity', 'hover']]) }}>
            <Row>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <div style={{ flexGrow: 1 }}><Segmented name="ledge-volume" label={t.settings.volume} hint={t.settings.volumeHint} value={p.sounds.volume} onChange={v => p.onSounds({ volume: v })}
                  options={VOLUMES.map(v => ({ value: v, label: { quiet: t.settings.volumeQuiet, normal: t.settings.volumeNormal, loud: t.settings.volumeLoud }[v] }))} /></div>
                <Button variant="outline" size="sm" onClick={p.onTestSound}>{t.settings.test}</Button>
              </div>
            </Row>
            <Row>
              <fieldset style={{ margin: 0, padding: 0, border: 'none' }}>
                <legend style={{ padding: '12px 0 4px', fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{t.settings.playWhen}</legend>
                {CATEGORIES.map(c => (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 32, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={p.sounds.categories[c]} onChange={e => p.onSounds({ categories: { [c]: e.target.checked } })} style={{ margin: 0, width: 16, height: 16, accentColor: 'var(--sidebar-primary)' }} />
                    {t.settings.category[c]}
                  </label>
                ))}
              </fieldset>
            </Row>
            <Row><Switch label={t.settings.behind} hint={t.settings.behindHint} checked={p.sounds.onlyWhenTerminalBehind} onChange={on => p.onSounds({ onlyWhenTerminalBehind: on })} /></Row>
            <span style={{ display: 'block', fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', padding: '8px 0' }}>{t.settings.soundsNote}</span>
          </div>
```

Import `Button` from `'../ui/Button'` (the same primitive the bubble uses). `Segmented`'s options are native radios inside labels, so `getByRole('radio', { name })` resolves.

- [ ] **Step 5: `Surface.tsx`**

In the `SettingsView` element add `finished={prefs.finished} onFinished={prefs.setFinished} sounds={prefs.sounds} onSounds={prefs.setSounds} onTestSound={sounds.test}` (`prefs` from Task 6, `sounds` from Task 8).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/overlay && pnpm typecheck && pnpm vitest run test/settings.test.tsx test/i18n.test.tsx test/surface.test.tsx`
Expected: PASS. If the surface's settings height assertions (any test asserting the settings view height) now differ, update the expected height: the view grew by the new rows, which is the intended change.

- [ ] **Step 7: Docs**

In `docs/tour.md`, in the section that describes the handle, add one paragraph:

> **The handle lives.** A working bot hops every 3.6 to 4.4 s, 2 px high in the handle, so you can tell a bot that works from one that waits without opening anything. Under reduced motion the antenna light pulses instead.

In the section about the bubble, add:

> **Finished.** When a bot ends its turn, it grows in the handle and a bubble says "Otto finished · 2m 40s of work · harness-assistant" for 6 s, with OK and Open. A request always comes before a notice. Settings › "When a bot finishes" chooses bubble, sound, both or the handle only.

In the settings section, add:

> **Sounds.** Eight short synthesised cues, one family: asks rise or knock, results fall, your own decisions tick. Settings › Sounds has the switch, the volume with a Test button, one checkbox per category, and "Only when the terminal is behind", which keeps Ledge quiet while Windows Terminal is the front window. Do not disturb silences everything.

(The screen captures in `docs/screens/settings-dark.png` are now out of date; regenerate them with the existing `e2e/screenshots.spec.ts` on the next Windows session, and say so in the commit body if not done here.)

- [ ] **Step 8: Full suite and commit**

Run: `cd apps/overlay && pnpm typecheck && pnpm vitest run`
Expected: PASS.

```bash
git add apps/overlay/src/surface/SettingsView.tsx apps/overlay/src/surface/Surface.tsx apps/overlay/src/i18n/messages.ts apps/overlay/test/settings.test.tsx docs/tour.md
git commit -m "feat(overlay): settings for the finished notification and sounds

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: §6 hop → Task 1; §5 finished bubble → Tasks 3, 4, 5, 6; §5 settings → Tasks 2, 9; §7 ter sounds → Tasks 7, 8; §9 tests → each task's tests; the `exited` rule (no bubble, a leave or error cue) → Task 4 (`changeOf`) and Task 7 (`leave`/`error` cues); the autoplay flag and `foregroundIsTerminal` → Task 8.
- Types used across tasks: `BubbleKind`, `FINISHED_BUBBLE_MS` (Task 3) are consumed by Task 5; `SessionChange`/`changeOf` (Task 4) by Task 8; `SoundPrefs`, `FinishedNotify`, `SoundPatch`, `CATEGORIES`, `FINISHED_VALUES`, `VOLUMES`, `VOLUME_GAIN`, `resetSoundPrefsForTests` (Task 2) by Tasks 7, 8, 9; `SoundPlayer`, `createSilentPlayer`, `createWebAudioPlayer` (Task 7) by Task 8; `HandleBot.lifted` (Task 6) only inside Task 6.
- Review Focus coverage: (1) Task 3 "a second finished notice chains" and Task 4 `workingSince`; (2) Task 4 `changeOf` test and the second surface test; (3) Task 7 `decideSound` user ticks and the Task 8 surface test; (4) Task 7 snapshot test and the Task 8 surface test; (5) Task 2 throwing storage test.
- Out of scope, on purpose: a Windows toast when the overlay is hidden, per-bot sound choices, custom audio files, a Codex/Cursor "files changed" summary in the finished bubble (the daemon does not track it; the bubble shows the work time and the project).
