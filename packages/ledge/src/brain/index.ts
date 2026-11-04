// What a session Ledge launched is told of the brain (spec 2026-11-04 §3.4), and what `ledge brain` prints: the index, a note,
// or what Ledge says of itself. Everything is read on this machine, at the moment it is asked: a note edited by hand is seen at once.
import { projectOf, type Machines, type Projects } from '@ledge/protocol';
import { readMachines } from '../daemon/machines.js';
import { readProjects } from '../daemon/projects.js';
import { installedAgents, ledgeMd, readGuide } from '../chat/guide.js';
import { projectsMd } from '../chat/context.js';
import { LEDGE_VERSION } from '../version.js';
import { forSession, NOTE_MAX, noteDate, notesDir, oldFor, oneLine, readNotes, type Note } from './notes.js';

/** The most notes a session is told of when it starts: the rest is one `ledge brain` away. */
export const INDEX_TOLD = 20;

/** What Ledge writes of itself, under names a note cannot take (`@`): a note keeps its own plain name. */
export const GENERATED = {
  '@ledge': "ce qu'est Ledge : ses écrans, ses commandes, les actions de son chat, sa version et les agents installés",
  '@projects': 'les projets, leurs dépôts par machine et les dossiers rangés',
  '@machines': 'les machines que Ledge connaît'
} as const;
export type Generated = keyof typeof GENERATED;

/** The session's project, by its folder, as the daemon files it (null: none). */
export function projectFor(cwd: string, projects: Projects = readProjects()): { id: string; name: string } | null {
  const id = projectOf({ cwd }, projects);
  const p = id ? projects.projects.find(x => x.id === id) : undefined;
  return p ? { id: p.id, name: p.name } : null;
}

/** One index line: the name `ledge brain` takes, the title, when to read it, its date. */
export const indexLine = (n: Note, now?: string): string => { const old = oldFor(n, now); return `- ${n.name} — « ${n.title} » — ${n.when ? `quand : ${n.when}` : `première ligne : ${n.firstLine || '(vide)'}`} — ${noteDate(n)}${old ? ` — ancienne (${old} jours) : vérifie avant de t'y fier` : ''}${n.truncated ? ' — longue : seul le début est lu' : ''}${n.flag ? ` — à revoir : ${oneLine(n.flag)}` : ''}`; };

/**
 * The brain block of a launched session's start context: how to read what Ledge says of itself, then the index of the notes
 * offered to its project (at most INDEX_TOLD), when there are some. Never the notes themselves.
 */
export function brainContext(notes: readonly Note[]): string {
  const lines = ["Ce que Ledge sait de lui-même (ses écrans, ses commandes, ses actions) : `ledge brain @ledge` ; tout ce qu'il sait : `ledge brain`."];
  if (notes.length) {
    const shown = notes.slice(0, INDEX_TOLD);
    lines.push(
      "Notes de l'utilisateur sur son environnement (machines, services, habitudes), à lire avec `ledge brain <nom>` seulement si ton travail en a besoin ; pour le code, le CLAUDE.md ou AGENTS.md du dépôt prime :",
      ...shown.map(n => indexLine(n)),
      ...(notes.length > shown.length ? [`- et ${notes.length - shown.length} autre(s) : \`ledge brain\``] : [])
    );
  }
  lines.push("Tu apprends un fait durable sur l'environnement (pas sur le code) : `ledge brain propose <nom> \"<fait>\" \"<comment tu le sais>\"` (`new:<nom>` pour une nouvelle note, avec `--title \"<titre>\" --when \"<quand la lire>\"`) ; une note te semble fausse : `ledge brain flag <nom> \"<ce qui ne va pas>\"`. Jamais la valeur d'un secret. L'utilisateur valide avant que rien ne s'écrive.");
  return lines.join('\n');
}

/** The brain block for a session in `cwd`; a failure (an unreadable folder) is no block, never a failed start. */
export async function sessionBrain(cwd: string, from = notesDir()): Promise<string> {
  const { notes } = await readNotes(from).catch(() => ({ notes: [] as Note[] }));
  return brainContext(forSession(notes, projectFor(cwd)));
}

const machinesMd = (machines: Machines): string => ['# Machines', '', 'The machines this Ledge knows (Settings › Machines).', '',
  ...machines.map(m => `- ${m.label} (${m.id})${m.id === 'local' ? ': this machine, where the daemon runs' : ''}${m.ssh ? `: ssh ${m.ssh}` : ''}${m.disabled ? ', disabled' : ''}`), ''].join('\n');

/** What Ledge says of itself under a generated name. */
export async function generated(name: Generated): Promise<string> {
  if (name === '@projects') return projectsMd(readProjects());
  if (name === '@machines') return machinesMd(readMachines());
  return ledgeMd({ guide: await readGuide(), version: LEDGE_VERSION, agents: await installedAgents(process.env.PATH) });
}

export interface BrainOptions {
  /** The folder of the notes (`~/.ledge/context`). */
  from?: string;
  /** Where the command runs: its project decides which notes the index offers. */
  cwd?: string;
  /** Inside a session Ledge launched (LEDGE_SESSION): a `chat` note is neither listed nor read. */
  inSession?: boolean;
}

/** `ledge brain [<name>]`: the index, or one entry. */
export async function runBrain(args: string[], o: BrainOptions = {}): Promise<{ line: string; code: number }> {
  const from = o.from ?? notesDir();
  const cwd = o.cwd ?? process.cwd();
  const inSession = o.inSession ?? !!process.env.LEDGE_SESSION;
  const { notes, more } = await readNotes(from);
  const name = args[0];
  if (args.length > 1 || name === '--help' || name === '-h') return { line: 'ledge brain [<nom>]   l\'index de ce que Ledge sait, ou une entrée (une note, @ledge, @projects, @machines)', code: name === '--help' || name === '-h' ? 0 : 1 };
  if (!name) {
    const project = projectFor(cwd);
    const offered = inSession ? forSession(notes, project) : notes;
    const others = inSession ? notes.filter(n => n.scope !== 'chat' && !offered.includes(n)) : [];
    return { code: 0, line: [
      'Ce que Ledge écrit de lui-même :',
      ...Object.entries(GENERATED).map(([k, v]) => `- ${k} — ${v}`),
      '',
      `Notes de l'utilisateur (${from})${inSession && project ? `, pour le projet ${project.name}` : ''} :`,
      ...(offered.length ? offered.map(n => `${indexLine(n)}${!inSession && n.scope !== 'all' ? ` — réservée ${n.scope === 'chat' ? 'au chat' : 'aux sessions'}` : ''}`) : ['- (aucune)']),
      ...(others.length ? [`- et ${others.length} note(s) d'autres projets : ${others.map(n => n.name).join(', ')}`] : []),
      ...(more > 0 ? [`- et ${more} note(s) au-delà de 200, jamais lues`] : []),
      '',
      'Lis une entrée avec `ledge brain <nom>`.'
    ].join('\n') };
  }
  if (name in GENERATED) return { line: (await generated(name as Generated)).trimEnd(), code: 0 };
  const note = notes.find(n => n.name.toLowerCase() === name.toLowerCase() || n.file.toLowerCase() === name.toLowerCase());
  if (!note) return { line: `Ledge ne connaît pas « ${name} » : \`ledge brain\` liste ce qu'il sait.`, code: 1 };
  if (inSession && note.scope === 'chat') return { line: `La note « ${note.name} » est réservée au chat de Ledge.`, code: 1 };
  return { code: 0, line: [
    `# ${note.name} — « ${note.title} » — ${noteDate(note)} (${note.path})`,
    '',
    note.body,
    ...(note.truncated ? ['', `[coupée par Ledge : seuls les ${NOTE_MAX} premiers octets sur ${note.size} sont lus]`] : [])
  ].join('\n') };
}
