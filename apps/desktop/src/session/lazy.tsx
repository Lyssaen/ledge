import { lazy, Suspense, type JSX } from 'react';
import type { WorkspaceProps } from './Workspace';

type WorkspaceModule = typeof import('./Workspace');
type Loaded = { default: WorkspaceModule['Workspace'] };
let loaded: WorkspaceModule | undefined;

/** Fetches the session page's chunk (the page, its thread, the Markdown reader and the diffs): kept apart from the shell so the
 *  first bundle stays small. Once it is there, the page renders at once (see Page). */
export function loadWorkspace(): Promise<WorkspaceModule> {
  return loaded ? Promise.resolve(loaded) : import('./Workspace').then(m => (loaded = m));
}

// A chunk already loaded is handed over synchronously: React.lazy then resolves within the same render, without suspending.
const Page = lazy(() => (loaded
  ? { then: (ok: (m: Loaded) => void) => ok({ default: loaded!.Workspace }) } as PromiseLike<Loaded> as Promise<Loaded>
  : loadWorkspace().then(m => ({ default: m.Workspace }))));

/** The session place, behind a sober wait (an empty workspace) the first time its chunk is fetched. */
export function SessionPlace(props: WorkspaceProps): JSX.Element {
  return <Suspense fallback={<div className="conversation-workspace" aria-busy="true" />}><Page {...props} /></Suspense>;
}
