import { loadChat } from '../chat/lazy';
import { loadComposer } from '../launch/lazy';
import { loadEditor } from '../projects/lazy';
import { loadWorkspace } from '../session/lazy';
import { loadSettings } from '../settings/lazy';

let pending: Promise<unknown> = Promise.resolve();

/** Fetches the session page's, the New session form's, the project editor's, the chat's and the settings' chunks once the
 *  shell is up, so a first opening rarely waits for them. A chunk that fails here is left to its place, which loads it again
 *  and says so (ChunkBoundary): nothing rejects unheard. */
export function preloadPlaces(): void {
  pending = Promise.allSettled([pending, loadWorkspace(), loadComposer(), loadEditor(), loadChat(), loadSettings()]);
}

/** Settles once every preload started so far did: the tests wait for it before their environment goes. */
export function preloaded(): Promise<unknown> { return pending; }
