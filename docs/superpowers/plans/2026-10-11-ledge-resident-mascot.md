# Resident Ledge Mascot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Ledge's own mascot visible in the notch with and without sessions, animate its interactions, and use its silhouette for the Windows tray.

**Architecture:** `ResidentMascot` owns one SVG and its animation lifecycle. `Handle` permanently places it above session bots; `Surface` routes its click to the existing list and proximity coordinates to its gaze. Geometry reserves the resident's height. The tray loads a raster rendering of the same silhouette.

**Tech Stack:** React, TypeScript, CSS, Tauri 2/Rust, Vitest, Playwright.

**Spec:** `docs/mockups/ledge-mascot.html` in the source checkout (interactive approved design); user clarification: mascot remains present with sessions and becomes the tray icon.

## Global Constraints

- Preserve existing session actions, pending badges and native frame behavior.
- Honor app/OS reduced motion, DND, hidden/inert views and offline state.
- Keep the resident accessible by pointer and keyboard; bilingual copy.
- Tray icon is static; live status is shown in the notch, not inferred from a tray pixel.

## Review Focus

- Zero sessions: the handle stays visible and the resident opens the list.
- Many sessions: the resident remains visible and the handle stays within screen bounds.
- Pointer leaves, inactive view, DND or reduced motion: gaze and timers stop.
- Offline: resident remains visible and the launch controls stay blocked by existing logic.
- Tray build: dedicated icon loads without changing the app's bundle icon.

---

### Task 1: Permanent notch resident

**Files:** `apps/overlay/src/surface/geometry.ts`, `Handle.tsx`, `Surface.tsx`, `SessionList.tsx`, `i18n/messages.ts`, `bots/ResidentMascot.tsx`, `bots/resident.css`; tests in `apps/overlay/test/resident.test.tsx`, `geometry.test.ts`, `handle.test.tsx`.

**Interfaces:** `ResidentMascot({ size, theme, paused, frozen, reducedMotion, dnd, pointer, gestureKey, boopKey })`; `Handle` adds `onOpenHome` and resident status props; geometry reserves a 20px resident slot at the top.

- [x] Write behavior tests for zero/active sessions, click, gaze, motion preferences, lifecycle and list empty state.
- [x] Run focused tests and confirm failure because the new behavior is absent.
- [x] Implement the SVG, gesture hook, handle layout and Surface wiring.
- [x] Run focused tests and the full overlay suite; fix regressions.

### Task 2: Tray identity and end-to-end behavior

**Files:** `apps/overlay/src-tauri/icons/ledge-tray.svg`, `ledge-tray.png`, `src-tauri/src/main.rs`; `apps/overlay/e2e/resident.spec.ts`.

**Interfaces:** Tauri `build_tray` loads dedicated `ledge-tray.png`; public overlay behavior remains unchanged.

- [x] Write browser tests for persistent resident, real pointer interaction and click; cover theme and reduced motion in unit tests.
- [x] Add the icon assets and tray loader; run browser tests. (`cargo` is not installed in this environment.)
- [x] Run typecheck, full overlay tests, browser tests and review the worktree diff.
