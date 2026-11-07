// The rules both New session forms (LaunchComposer, the IDE's LaunchModal) share when they send.
import type { KeyboardEvent } from 'react';
import { launchMessage, NO_PICK, withPick, type LaunchForm, type LaunchMessage } from './model';
import type { ModelsState } from './useModels';
import { savePick } from './modelPrefs';

/** OMP is launched by the daemon itself, with no fallback to another harness: where it cannot be reached (not installed, a daemon
 *  that does not know it, no credentials), the launch is blocked with the reason (spec 2026-10-20 §3.1). */
export function ompBlocked(form: Pick<LaunchForm, 'tool'>, online: boolean, models: ModelsState): string | null {
  return form.tool === 'omp' && online && models.status === 'ready' && models.error ? models.error : null;
}

/** The message sent for `form`: the model chosen is remembered for the project (unless the daemon is too old for models, which then
 *  takes none), and OMP's approval mode goes only to a daemon that takes it (an older one launches it asking). */
export function sentMessage(form: LaunchForm, project: string, name: string, o: { outdated: boolean; approvable: boolean }): LaunchMessage {
  if (!o.outdated) savePick(project, form.tool, { model: form.model, effort: form.effort });
  const sent = { ...(o.outdated ? withPick(form, NO_PICK) : form), approval: o.approvable ? form.approval : 'always-ask' as const };
  return launchMessage(sent, name);
}

/** Only Ctrl / ⌘ ↵ and « Launch » send: a plain Enter on a tile or a chip would submit the form implicitly (the textarea keeps its newline). */
export function launchKeys(submit: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); submit(); }
    else if (e.target instanceof HTMLInputElement) e.preventDefault();
  };
}
