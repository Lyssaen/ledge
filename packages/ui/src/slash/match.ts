import type { SlashCommand } from '@ledge/protocol';

/**
 * The chat's « / » list (mockup docs/mockups/ledge-slash-commands.html): open while the draft is a command's first word
 * still being typed (`/`, `/rev`), shut as soon as a space or a line follows it. Returns what follows the slash, lowercased.
 */
export function slashQuery(draft: string): string | null {
  const m = /^\/(\S*)$/.exec(draft);
  return m ? m[1]!.toLowerCase() : null;
}

/** A command the query finds: `shown` is the name it matched by (an alias when only the alias did), `at` where in it. */
export interface SlashMatch { command: SlashCommand; shown: string; at: number }

/**
 * The commands for `query`: names and aliases that start with it first (the exact one at the head), then those that
 * contain it, then descriptions that do; alphabetical within each. A command Ledge does not send stays in the list, after
 * the others of its rank, for its reason to be read.
 */
export function matchCommands(list: readonly SlashCommand[], query: string): SlashMatch[] {
  const q = query.toLowerCase();
  const found: Array<SlashMatch & { rank: number }> = [];
  for (const command of list) {
    const names = [command.name, ...(command.aliases ?? [])];
    const lower = names.map(n => n.toLowerCase());
    let rank = -1, shown = command.name, at = -1;
    const exact = lower.indexOf(q);
    const starts = lower.findIndex(n => n.startsWith(q));
    const holds = lower.findIndex(n => n.includes(q));
    if (exact >= 0 && q) { rank = 0; shown = names[exact]!; at = 0; }
    else if (starts >= 0) { rank = 1; shown = names[starts]!; at = 0; }
    else if (holds >= 0) { rank = 2; shown = names[holds]!; at = lower[holds]!.indexOf(q); }
    else if (command.description?.toLowerCase().includes(q)) rank = 3;
    if (rank < 0) continue;
    // A name found by an alias reads as the command's own name when that one matches too.
    if (shown !== command.name && command.name.toLowerCase().startsWith(q)) { shown = command.name; at = 0; }
    found.push({ command, shown, at: q ? at : -1, rank });
  }
  return found
    .sort((a, b) => a.rank - b.rank || Number(!!a.command.blocked) - Number(!!b.command.blocked) || a.shown.localeCompare(b.shown))
    .map(({ rank: _r, ...m }) => m);
}

/** The command the draft starts with, by its exact name or alias (`/code-review high` → code-review), if the list has it. */
export function draftCommand(draft: string, list: readonly SlashCommand[]): SlashCommand | undefined {
  const m = /^\/(\S+)/.exec(draft.trimStart()); if (!m) return undefined;
  const name = m[1]!.toLowerCase();
  return list.find(c => c.name.toLowerCase() === name || c.aliases?.some(a => a.toLowerCase() === name));
}

/** The draft once a command is chosen: `/name ` and the cursor after it, ready for its arguments. */
export const completed = (command: SlashCommand): string => `/${command.name} `;
