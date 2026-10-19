import type { Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { folderOf } from '../atelier/filing';

export type Bucket = 'decide' | 'running' | 'done' | 'offline';
/** Kept for the list copy (`t.list.groups`), which the sidebar and the session page still read. */
export type GroupBy = 'project' | 'machine' | 'state';

const bucketOfBot = (b: ReturnType<typeof botState>): Bucket => (b === 'approval' || b === 'question' ? 'decide' : b === 'done' || b === 'idle' ? 'done' : 'running');

export function bucketOf(s: Session): Bucket {
  return s.offline ? 'offline' : bucketOfBot(botState(s));
}

/** A session's repository: `s.repo`, else the name of the `cwd` folder. */
export const repoOf = (s: Session): string => s.repo ?? folderOf(s.cwd);
