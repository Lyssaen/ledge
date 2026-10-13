import { spawn as nodeSpawn } from 'node:child_process';
import { runJsonl } from './run.js';

/** Who Ledge is when it answers (spec 2026-10-11 §5.4). */
export const PERSONA = `Tu es Ledge, le compagnon qui veille sur les sessions d'agents (Claude Code, Codex, Cursor Agent) de l'utilisateur. Tu lis, tu ne touches à rien : seulement des commandes de lecture (cat, ls, rg…), aucune commande qui modifie quoi que ce soit, pas d'écriture, et tu n'envoies jamais rien toi-même à une session.
Tes sources : le dossier courant contient sessions.md (toutes les sessions, leur état et le nom de leurs fichiers), pane-<id>.txt (les dernières lignes du terminal d'une session), reply-<id>.md (sa dernière réponse), git-<id>.txt (status, log et diff --stat de son dossier) et folders.md (les dossiers récents où l'utilisateur a lancé des sessions). Les dépôts eux-mêmes sont lisibles, avec les outils de lecture de ton harnais, pour aller plus loin.
Commence toujours par lire sessions.md. Ne lis que ce que la question demande.
Réponds dans la langue de la question, en 3 à 10 lignes, en Markdown simple : paragraphes courts, listes à puces, \`code\` pour les commandes, fichiers et branches. Nomme chaque bot par son prénom en gras (**Nova**) la première fois. Dis d'où vient chaque fait et de quand il date quand cela compte. Si une information manque, dis-le au lieu de supposer. Tu n'agis jamais toi-même ; tu peux lui dire quel bot ouvrir. Quand l'utilisateur demande explicitement d'ouvrir ou de lancer une session, et seulement si le dossier est sûr — un chemin absolu lu dans sessions.md ou folders.md, ou donné tel quel par l'utilisateur —, réponds en une ou deux lignes puis termine par un bloc \`\`\`ledge-session contenant {"cwd": "<chemin>", "prompt": "<l'instruction, s'il y en a une>"}. Si plusieurs dossiers conviennent ou aucun, ne mets pas de bloc : cite les candidats et demande lequel. Quand l'utilisateur demande explicitement de dire, demander ou envoyer quelque chose à une session, et seulement si une seule session de sessions.md correspond et qu'elle n'est pas en lecture seule, réponds en une ou deux lignes puis termine par un bloc \`\`\`ledge-relay contenant {\"session\": \"<id>\", \"text\": \"<l'instruction, formulée pour l'agent>\"}. Si plusieurs sessions conviennent ou aucune, ne mets pas de bloc : cite les candidats et demande laquelle.`;

export interface RunOptions {
  persona?: string;
  question: string; cwd: string; addDirs: string[]; sessionId: string; resume: boolean; env: NodeJS.ProcessEnv;
  /** The executable and its leading arguments (`['claude']` by default; tests pass `[node, fake-claude.mjs]`). */
  bin?: string[]; maxTurns?: number;
}

/** `claude -p` headless, restricted to reading (spec §5.2); the question goes on stdin, never in argv. */
export function claudeArgs(o: RunOptions): string[] {
  return ['-p', '--restricted', '--tools', 'Read,Grep,Glob', '--permission-mode', 'dontAsk', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--max-turns', String(o.maxTurns ?? 16), '--append-system-prompt', o.persona ?? PERSONA, ...o.addDirs.flatMap(d => ['--add-dir', d]), ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId])];
}

export type ClaudeEvent = { type: 'init'; sessionId: string } | { type: 'tool'; tool: string; path?: string } | { type: 'delta'; text: string } | { type: 'result'; text: string; isError: boolean };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** One stream-json line as Ledge events (a message can hold several tool uses); nothing for the lines Ledge does not use. */
export function parseLine(line: string): ClaudeEvent[] {
  let m: Json; try { m = obj(JSON.parse(line)); } catch { return []; }
  if (m.type === 'system' && m.subtype === 'init' && str(m.session_id)) return [{ type: 'init', sessionId: str(m.session_id)! }];
  if (m.type === 'stream_event') {
    const ev = obj(m.event); const d = obj(ev.delta);
    return ev.type === 'content_block_delta' && d.type === 'text_delta' && str(d.text) !== undefined ? [{ type: 'delta', text: str(d.text)! }] : [];
  }
  if (m.type === 'assistant') {
    const content = obj(m.message).content;
    return (Array.isArray(content) ? content : []).map(obj).filter(b => b.type === 'tool_use').map(b => { const i = obj(b.input); const path = str(i.file_path) ?? str(i.path); return { type: 'tool' as const, tool: String(b.name ?? ''), ...(path ? { path } : {}) }; });
  }
  if (m.type === 'result') return [{ type: 'result', text: str(m.result) ?? '', isError: m.is_error === true || (m.subtype !== undefined && m.subtype !== 'success') }];
  return [];
}

export interface RunHandle { done: Promise<{ code: number | null; stderr: string }>; kill(): void }

/** Spawns Claude Code and feeds every stream line to `onEvent`; `done` resolves with the exit code and the tail of stderr. */
export function runClaude(o: RunOptions, onEvent: (e: ClaudeEvent) => void, spawnImpl: typeof nodeSpawn = nodeSpawn): RunHandle {
  const [file = 'claude', ...pre] = o.bin ?? ['claude'];
  return runJsonl(file, [...pre, ...claudeArgs(o)], { cwd: o.cwd, env: o.env, question: o.question }, parseLine, onEvent, spawnImpl);
}
