import { lazy, Suspense, type JSX } from 'react';
import { ChunkBoundary } from '../shell/ChunkBoundary';
import type { DockHostProps } from './DockHost';
import type { IdeFrameProps } from './IdeFrame';

type IdeModule = typeof import('./IdeFrame');
let loaded: IdeModule | undefined;

/** Fetches the IDE shell's chunk (the frame, dockview and its CSS, ide.css): with the switch off it is never fetched. */
export function loadIde(): Promise<IdeModule> {
  return loaded ? Promise.resolve(loaded) : import('./IdeFrame').then(m => (loaded = m));
}

// A chunk already loaded is handed over synchronously: React.lazy then resolves within the same render, without suspending.
function fromChunk<K extends 'IdeFrame' | 'DockHost'>(key: K) {
  type Loaded = { default: IdeModule[K] };
  return lazy(() => (loaded
    ? { then: (ok: (m: Loaded) => void) => ok({ default: loaded![key] }) } as PromiseLike<Loaded> as Promise<Loaded>
    : loadIde().then(m => ({ default: m[key] }))));
}
const Frame = fromChunk('IdeFrame');
const Dock = fromChunk('DockHost');

/** The IDE shell, behind a sober wait (an empty window) the first time its chunk is fetched; a chunk that fails to load leaves a note (ChunkBoundary). */
export function IdePlace(props: IdeFrameProps): JSX.Element {
  return <ChunkBoundary><Suspense fallback={<div className="ide" aria-busy="true" />}><Frame {...props} /></Suspense></ChunkBoundary>;
}

/** The editing area, for IdePlace's `editor`: it renders inside the frame, so its chunk is already there. */
export function IdeDock(props: DockHostProps): JSX.Element {
  return <Dock {...props} />;
}
