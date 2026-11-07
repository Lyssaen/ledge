import { lazy, Suspense, type ComponentType, type JSX } from 'react';
import { ChunkBoundary } from '../shell/ChunkBoundary';

type ComposerModule = typeof import('./LaunchComposer');
export type LaunchComposerProps = Parameters<ComposerModule['LaunchComposer']>[0];
export type LaunchModalProps = Parameters<ComposerModule['LaunchModal']>[0];
let loaded: ComposerModule | undefined;

/** Fetches the New session form's chunk (the form, the IDE's modal, their repository inspection): kept apart from the shell so the
 *  first bundle stays small. Once it is there, the forms render at once (see place). */
export function loadComposer(): Promise<ComposerModule> {
  return loaded ? Promise.resolve(loaded) : import('./LaunchComposer').then(m => (loaded = m));
}

// A chunk already loaded is handed over synchronously: React.lazy then resolves within the same render, without suspending.
function place<P extends object>(pick: (m: ComposerModule) => ComponentType<P>) {
  type Loaded = { default: ComponentType<P> };
  return lazy(() => (loaded
    ? { then: (ok: (m: Loaded) => void) => ok({ default: pick(loaded!) }) } as PromiseLike<Loaded> as Promise<Loaded>
    : loadComposer().then(m => ({ default: pick(m) }))));
}
const Form = place(m => m.LaunchComposer);
const ModalForm = place(m => m.LaunchModal);

/** The New session form, behind a sober wait (an empty form) the first time its chunk is fetched; a chunk that fails to load leaves a note (ChunkBoundary). */
export function LaunchPlace(props: LaunchComposerProps): JSX.Element {
  return <ChunkBoundary><Suspense fallback={<div className="composer" aria-busy="true" />}><Form {...props} /></Suspense></ChunkBoundary>;
}

/** The IDE's New session modal (LaunchModal), from the same chunk and with the same waits. */
export function LaunchModalPlace(props: LaunchModalProps): JSX.Element {
  return <ChunkBoundary><Suspense fallback={<div className="launch-modal" aria-busy="true" />}><ModalForm {...props} /></Suspense></ChunkBoundary>;
}
