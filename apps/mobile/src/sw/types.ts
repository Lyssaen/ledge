/** What Task 11's pinned service worker reports of the build it serves. */
export type BuildInfo = { version: string; fingerprint: string };

/**
 * The worker's answer to `{ type: 'build' }`: the build whose files it serves (the one the user accepted) and its own
 * build when that one still waits for the user's consent.
 *
 * The messages between the page and the worker cross versions: a page of one build talks to the worker of another.
 * Page to worker: `{ type: 'build' }` with a MessagePort (answered with a BuildAnswer on it) and `{ type: 'accept' }`.
 * Worker to page: `{ type: 'changed' }` once a build is accepted. Change them only in ways older builds still read.
 */
export type BuildAnswer = { current: BuildInfo | null; pending: BuildInfo | null };
