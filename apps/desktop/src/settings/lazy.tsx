import { lazy, Suspense, type JSX } from 'react';
import { ChunkBoundary } from '../shell/ChunkBoundary';
import type { SectionId } from '../nav/state';
import type { SettingsContext } from './SettingsPage';

type SettingsModule = typeof import('./SettingsPage');
type Loaded = { default: SettingsModule['SettingsPage'] };
let loaded: SettingsModule | undefined;

/** Fetches the Settings page's chunk (the page, its sections and their logic): kept apart from the shell so the first bundle
 *  stays small. Once it is there, the page renders at once (see Page). */
export function loadSettings(): Promise<SettingsModule> {
  return loaded ? Promise.resolve(loaded) : import('./SettingsPage').then(m => (loaded = m));
}

// A chunk already loaded is handed over synchronously: React.lazy then resolves within the same render, without suspending.
const Page = lazy(() => (loaded
  ? { then: (ok: (m: Loaded) => void) => ok({ default: loaded!.SettingsPage }) } as PromiseLike<Loaded> as Promise<Loaded>
  : loadSettings().then(m => ({ default: m.SettingsPage }))));

/** The Settings place, behind a sober wait (an empty page) the first time its chunk is fetched; a chunk that fails to load leaves a note (ChunkBoundary). */
export function SettingsPlace(props: { section: SectionId; ctx: SettingsContext }): JSX.Element {
  return <ChunkBoundary><Suspense fallback={<div className="settings-page" aria-busy="true" />}><Page {...props} /></Suspense></ChunkBoundary>;
}
