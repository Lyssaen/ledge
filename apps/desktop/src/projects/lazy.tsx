import { lazy, Suspense, type JSX } from 'react';
import { ChunkBoundary } from '../shell/ChunkBoundary';

type EditorModule = typeof import('./ProjectEditor');
export type ProjectEditorProps = Parameters<EditorModule['ProjectEditor']>[0];
type Loaded = { default: EditorModule['ProjectEditor'] };
let loaded: EditorModule | undefined;

/** Fetches the project editor's chunk (the editor, its folder browser, the save): kept apart from the shell so the first bundle
 *  stays small. Once it is there, the editor renders at once (see Editor). */
export function loadEditor(): Promise<EditorModule> {
  return loaded ? Promise.resolve(loaded) : import('./ProjectEditor').then(m => (loaded = m));
}

// A chunk already loaded is handed over synchronously: React.lazy then resolves within the same render, without suspending.
const Editor = lazy(() => (loaded
  ? { then: (ok: (m: Loaded) => void) => ok({ default: loaded!.ProjectEditor }) } as PromiseLike<Loaded> as Promise<Loaded>
  : loadEditor().then(m => ({ default: m.ProjectEditor }))));

/** The project editor, behind a sober wait (an empty editor) the first time its chunk is fetched; a chunk that fails to load leaves a note (ChunkBoundary). */
export function EditorPlace(props: ProjectEditorProps): JSX.Element {
  return <ChunkBoundary><Suspense fallback={<div className="pe" aria-busy="true" />}><Editor {...props} /></Suspense></ChunkBoundary>;
}
