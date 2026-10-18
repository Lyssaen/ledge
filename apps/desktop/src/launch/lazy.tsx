import { lazy, Suspense, type JSX } from 'react';
import { ChunkBoundary } from '../shell/ChunkBoundary';

type ComposerModule = typeof import('./LaunchComposer');
export type LaunchComposerProps = Parameters<ComposerModule['LaunchComposer']>[0];
type Loaded = { default: ComposerModule['LaunchComposer'] };
let loaded: ComposerModule | undefined;

/** Fetches the New session form's chunk (the form, its repository inspection): kept apart from the shell so the first bundle
 *  stays small. Once it is there, the form renders at once (see Form). */
export function loadComposer(): Promise<ComposerModule> {
  return loaded ? Promise.resolve(loaded) : import('./LaunchComposer').then(m => (loaded = m));
}

// A chunk already loaded is handed over synchronously: React.lazy then resolves within the same render, without suspending.
const Form = lazy(() => (loaded
  ? { then: (ok: (m: Loaded) => void) => ok({ default: loaded!.LaunchComposer }) } as PromiseLike<Loaded> as Promise<Loaded>
  : loadComposer().then(m => ({ default: m.LaunchComposer }))));

/** The New session form, behind a sober wait (an empty form) the first time its chunk is fetched; a chunk that fails to load leaves a note (ChunkBoundary). */
export function LaunchPlace(props: LaunchComposerProps): JSX.Element {
  return <ChunkBoundary><Suspense fallback={<div className="composer" aria-busy="true" />}><Form {...props} /></Suspense></ChunkBoundary>;
}
