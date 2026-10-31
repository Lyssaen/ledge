// `ledge.md`: what Ledge is and where each thing is done, for a question about Ledge itself. The hand-written guide
// (docs/ledge-guide.md, shipped beside the CLI) comes first, then what the code says: the version, the agents found on
// the PATH, the actions Ledge may propose and those it never proposes.
import { access, constants, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS, NEVER_PROPOSED, ToolSchema, type ActionDef, type Tool } from '@ledge/protocol';

export const LEDGE_MD = 'ledge.md';

/** Where the guide is: beside the built CLI (`dist/ledge-guide.md`, copied by tsup), else in the repository's docs (dev, tests). */
const GUIDE_FILES = [new URL('../ledge-guide.md', import.meta.url), new URL('../../../../docs/ledge-guide.md', import.meta.url)].map(u => fileURLToPath(u));

/** The hand-written guide's text, or null when neither place holds it. */
export async function readGuide(files: readonly string[] = GUIDE_FILES): Promise<string | null> {
  for (const f of files) { try { return await readFile(f, 'utf8'); } catch { /* next */ } }
  return null;
}

/** The executable each harness runs by default (claude.ts, codex.ts, cursor.ts, omp.ts). */
export const AGENT_BIN: Record<Tool, string> = { claude: 'claude', codex: 'codex', cursor: 'cursor-agent', omp: 'omp' };

/** The agents whose executable is on `path` (the login shell's PATH, as a launched agent sees it). */
export async function installedAgents(path: string | undefined): Promise<Tool[]> {
  const dirs = (path ?? '').split(delimiter).filter(Boolean);
  const found: Tool[] = [];
  for (const tool of ToolSchema.options) {
    for (const d of dirs) {
      try { await access(join(d, AGENT_BIN[tool]), constants.X_OK); found.push(tool); break; } catch { /* not here */ }
    }
  }
  return found;
}

const RISK = { read: 'read only', reversible: 'reversible', destructive: 'irreversible, confirmed twice' } as const;

export interface LedgeInfo {
  /** The hand-written guide; null writes a line saying it is missing. */
  guide: string | null;
  /** The daemon's version. */
  version?: string;
  /** The agents found installed; left out when unknown. */
  agents?: readonly Tool[];
  actions?: readonly ActionDef[];
}

/** The text of `ledge.md`: the guide, then the part generated from the code. */
export function ledgeMd(info: LedgeInfo): string {
  const actions = info.actions ?? ACTIONS;
  return [
    info.guide?.trim() || '# Ledge\n\n(The Ledge guide is missing from this installation: answer from the part below only, and say so.)',
    '',
    '---',
    '',
    '# Generated from the code of this installation',
    '',
    `- Daemon version: ${info.version ?? 'unknown'}`,
    `- Agents installed (found on the PATH): ${info.agents === undefined ? 'unknown' : info.agents.length ? info.agents.join(', ') : 'none found'}`,
    '',
    '## Actions Ledge may propose (a card the user validates)',
    '',
    ...actions.map(a => `- \`${a.id}\` — ${a.summary} — ${typeof a.risk === 'function' ? 'reversible or irreversible depending on the answer' : RISK[a.risk]}`),
    '',
    '## Never proposed: send the user to the screen that does it',
    '',
    ...NEVER_PROPOSED.map(n => `- ${n}`),
    ''
  ].join('\n');
}

export async function writeLedgeMd(dir: string, info: LedgeInfo): Promise<void> {
  await writeFile(join(dir, LEDGE_MD), ledgeMd(info));
}
