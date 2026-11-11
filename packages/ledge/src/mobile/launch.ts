// « Nouvelle session » from the phone (refonte mobile M2 §9, docs/mobile-launch-contract.md): the PC's own launch, with the folders
// checked first so that a refusal reaches the phone as a code it can show.
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { ModelChoice, OmpApproval, Session, Tool } from '@ledge/protocol';
import { resolveFolder } from '../daemon/folders.js';
import { folderTooWide } from '../chat/service.js';
import { PhoneLaunchRefused } from './gateway.js';

export type PhoneLaunchReq = { tool: Tool; cwd: string; dirs?: string[]; prompt: string; model?: string; effort?: string; approval?: OmpApproval };

/** An agent's models as `models.listing` gives them; `error` when the agent could not be asked. */
export type ListModels = (tool: Tool) => Promise<{ models: ModelChoice[]; error?: string }>;

/**
 * Wraps the daemon's `launch`: a folder that is not there is `not_found`; the home folder or one above it (named, or reached through
 * a link), or an option the agent does not take (the daemon's `launch: …` refusals), is `invalid`. So is a model that is not one of
 * the agent's `models.listing`, or an effort that model does not take, when the agent could be asked: a list the PC could not read
 * refuses nothing. Anything else (tmux, the agent's binary) stays a failure.
 */
export function phoneLaunch(launch: (req: PhoneLaunchReq) => Promise<Session>, home?: string, listModels?: ListModels): (req: PhoneLaunchReq) => Promise<{ id: string }> {
  return async req => {
    if ((req.model || req.effort) && listModels) {
      const listing = await listModels(req.tool);
      if (!listing.error && listing.models.length) {
        const model = req.model ? listing.models.find(m => m.id === req.model) : listing.models.find(m => m.isDefault);
        if (req.model && !model) throw new PhoneLaunchRefused('invalid', `${req.tool} does not offer the model ${req.model}`);
        if (req.effort && model?.efforts && !model.efforts.includes(req.effort)) throw new PhoneLaunchRefused('invalid', `${model.id} does not take the effort ${req.effort}`);
      }
    }
    const userHome = resolve(home ?? homedir());
    for (const f of [req.cwd, ...(req.dirs ?? [])]) {
      let path: string;
      try { path = await resolveFolder(f, home); } catch (e) { throw new PhoneLaunchRefused('not_found', (e as Error).message); }
      // The folder as named and where it leads: a link to the home folder or the root is refused as the folder itself would be.
      const wide = await folderTooWide(resolve(path), userHome);
      if (wide) throw new PhoneLaunchRefused('invalid', `the folder is ${wide}`);
    }
    try { return { id: (await launch(req)).id }; }
    catch (e) { if (/^launch: /.test((e as Error).message)) throw new PhoneLaunchRefused('invalid', (e as Error).message); throw e; }
  };
}
