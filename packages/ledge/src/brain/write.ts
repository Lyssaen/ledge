// What a session proposes about the user's notes (brain spec §3.6), checked before a decision is put to the user, written only
// once the user answers « oui »: a dated fact appended under `## Ajouts` (a short new note), or the note flagged « à revoir ».
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainChoice, BrainProposal, NoteInfo } from '@ledge/protocol';
import { redact } from '../chat/forge.js';
import { brainFile, NOTE_MAX, notesDir, oldFor, readBrainState, readNotes, type BrainState } from './notes.js';

/** The most open proposals one session may have waiting for the user. */
export const PENDING_MAX = 3;
export const ADDITIONS = '## Ajouts';

function writeBrainState(state: BrainState, from: string): void {
  const file = brainFile(from); const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n'); renameSync(tmp, file);
}

/** Why a session's proposal is not put to the user, or null. `pending`: its open proposals now. */
export async function checkProposal(p: BrainProposal, pending: number, from = notesDir()): Promise<string | null> {
  if (pending >= PENDING_MAX) return `trop de propositions en attente (${PENDING_MAX} au plus) : attends que l'utilisateur réponde`;
  const texts = [p.fact, p.source ?? '', p.title ?? '', p.when ?? ''];
  for (const t of texts) if (redact(t) !== t) return 'cela ressemble à un secret : une note dit où il est, jamais sa valeur';
  if (texts.some(t => /[\r\n]/.test(t))) return 'une seule ligne, sans retour à la ligne';
  const { notes } = await readNotes(from);
  const note = notes.find(n => n.name.toLowerCase() === p.note.toLowerCase());
  if (p.create) {
    if (p.kind !== 'add') return 'on ne signale pas une note qui n\'existe pas';
    if (note) return `la note ${note.name} existe déjà : propose-lui un ajout`;
    return null;
  }
  if (!note || note.scope === 'chat') return `Ledge ne connaît pas la note « ${p.note} » : \`ledge brain\` les liste`;
  return null;
}

/** The decision put to the user: its title and two lines, each a ready answer (« oui — … », « non — … »). */
export function proposalTask(p: BrainProposal): { title: string; text: string } {
  const src = p.source ? ` (source : ${p.source})` : '';
  if (p.kind === 'flag') return {
    title: `Note ${p.note} à revoir ?`,
    text: `oui — marquer la note ${p.note} « à revoir » : ${p.fact}${src}\nnon — ne rien marquer`
  };
  return {
    title: p.create ? `Nouvelle note ${p.note} ?` : `Note ${p.note} : ajouter ce fait ?`,
    text: `oui — ${p.create ? `créer la note ${p.note}${p.title ? ` (« ${p.title} »)` : ''} avec` : `ajouter à la note ${p.note}`} : « ${p.fact} »${src}\nnon — ne rien écrire\noui : <ton texte> — écrire ton texte à la place`
  };
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The user's answer read: « oui » (and its forms, a ready line included), « oui : <texte> » (that text instead), anything else no. */
export function readAnswer(answer: string): { yes: false } | { yes: true; text?: string } {
  const edited = /^\s*oui\s*:\s*(.+)$/is.exec(answer);
  if (edited) return { yes: true, text: edited[1]!.replace(/\s*[\r\n]+\s*/g, ' ').trim() };
  return /^(oui|ok|d'accord|valide[rz]?|ajoute[rz]?)\b/.test(plain(answer)) ? { yes: true } : { yes: false };
}

/** The note's text with `line` appended to its `## Ajouts` section (made at the end when missing). */
export function appendAddition(text: string, line: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  const at = lines.findIndex(l => l.trim() === ADDITIONS);
  if (at < 0) return `${lines.join('\n')}\n\n${ADDITIONS}\n\n${line}\n`;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i]!)) { end = i; break; }
  while (end > at + 1 && !lines[end - 1]!.trim()) end--;
  return [...lines.slice(0, end), line, ...lines.slice(end)].join('\n') + '\n';
}

/** The note `name` names (any case) as its file spells it, or null: the chat's `note.add` card checks it before it is shown. */
export const noteName = (name: string, from = notesDir()): string | null => noteFile(name, from);

/** The note file `name` names (any case), directly in `from`, or null. */
function noteFile(name: string, from: string): string | null {
  try {
    const f = readdirSync(from, { withFileTypes: true }).find(e => e.isFile() && e.name.toLowerCase() === `${name.toLowerCase()}.md`);
    return f ? f.name.replace(/\.md$/i, '') : null;
  } catch { return null; }
}

/**
 * The user answered: on « oui » (or a button's `yes`), the fact is appended (or the note created, or the flag kept), dated and
 * signed by the session that proposed it; otherwise nothing is written. A choice's `text` replaces the fact, its `title` and
 * `when` a new note's. The result is what the proposer is told. Synchronous: the task's close and the write are one step.
 */
export function applyProposal(p: BrainProposal, answer: string | BrainChoice, by: string, at: string, from = notesDir()): string {
  const a: BrainChoice = typeof answer === 'string' ? readAnswer(answer) : answer;
  if (!a.yes) return typeof answer === 'string' ? `rien n'est écrit : l'utilisateur a répondu « ${answer.trim().slice(0, 200)} »` : 'rien n\'est écrit : l\'utilisateur a refusé';
  const fact = a.text ?? p.fact;
  const edited = a.text !== undefined && a.text !== p.fact;
  for (const t of [fact, a.title ?? '', a.when ?? '']) if (redact(t) !== t) return 'rien n\'est écrit : la réponse ressemble à un secret';
  const state = readBrainState(from);
  const name = noteFile(p.note, from);
  if (p.kind === 'flag') {
    if (!name) return `rien n'est marqué : la note ${p.note} n'existe plus`;
    state.flags = [...state.flags.filter(f => f.note !== name), { note: name, what: fact, by, at }];
    writeBrainState(state, from);
    return `la note ${name} est marquée « à revoir » : ${fact}`;
  }
  const line = `- ${fact}${p.source ? ` — ${p.source}` : ''} (proposé par ${by}${edited ? ', corrigé par l\'utilisateur' : ''}, le ${at.slice(0, 10)})`;
  return addLine(p.note, line, fact, !!p.create, { title: a.title ?? p.title ?? p.note, when: a.when ?? p.when ?? '(à compléter)' }, state, from);
}

/** What the user told the chat to keep (« retiens que… », the chat's `note.add` card): appended at once, signed by the user. */
export function addFromUser(note: string, fact: string, at: string, from = notesDir(), source?: string): { reason?: string; result?: string } {
  if (redact(fact) !== fact || redact(source ?? '') !== (source ?? '')) return { reason: 'cela ressemble à un secret : une note dit où il est, jamais sa valeur' };
  if (!noteFile(note, from)) return { reason: `la note ${note} n'existe plus` };
  const line = `- ${fact}${source ? ` — ${source}` : ''} (dit par l'utilisateur, le ${at.slice(0, 10)})`;
  const r = addLine(note, line, fact, false, null, readBrainState(from), from);
  return r.startsWith('rien') ? { reason: r.replace(/^rien n'est écrit : /, '') } : { result: r };
}

function addLine(note: string, line: string, fact: string, create: boolean, fresh: { title: string; when: string } | null, state: BrainState, from: string): string {
  const name = noteFile(note, from);
  let path: string;
  try {
    if (name) {
      path = join(from, `${name}.md`);
      if (statSync(path).size > NOTE_MAX) return `rien n'est écrit : la note ${name} est trop longue pour que Ledge la réécrive`;
      writeFileSync(path, appendAddition(readFileSync(path, 'utf8'), line));
    } else {
      if (!create || !fresh) return `rien n'est écrit : la note ${note} n'existe plus`;
      mkdirSync(from, { recursive: true });
      path = join(from, `${note}.md`);
      writeFileSync(path, `---\ntitle: ${JSON.stringify(fresh.title)}\nwhen: ${JSON.stringify(fresh.when)}\n---\n\n${ADDITIONS}\n\n${line}\n`, { flag: 'wx' });
    }
  } catch (e) { return `rien n'est écrit : ${(e as Error).message}`; }
  state.written[name ?? note] = statSync(path).mtime.toISOString();
  writeBrainState(state, from);
  return name ? `ajouté à la note ${name} : ${fact}` : `note ${note} créée avec : ${fact}`;
}

/** The note's text with `checked: <day>` in its front matter (replaced, added, or a front matter made). */
export function withChecked(text: string, day: string): string {
  const src = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
  if (!m) return `---\nchecked: ${day}\n---\n\n${src}`;
  const lines = m[1]!.split(/\r?\n/);
  const at = lines.findIndex(l => /^\s*checked\s*:/.test(l));
  if (at >= 0) lines[at] = `checked: ${day}`; else lines.push(`checked: ${day}`);
  return `---\n${lines.join('\n')}\n---${m[2]}${src.slice(m[0].length)}`;
}

/** « Vérifiée aujourd'hui »: the user checked the note; its flag, if any, goes (the note changed by the user's hand). */
export function markChecked(note: string, day: string, from = notesDir()): string | null {
  const name = noteFile(note, from);
  if (!name) return `la note ${note} n'existe plus`;
  const path = join(from, `${name}.md`);
  try {
    if (statSync(path).size > NOTE_MAX) return `la note ${name} est trop longue pour que Ledge la réécrive`;
    writeFileSync(path, withChecked(readFileSync(path, 'utf8'), day));
  } catch (e) { return (e as Error).message; }
  const state = readBrainState(from);
  if (state.flags.some(f => f.note === name)) { state.flags = state.flags.filter(f => f.note !== name); writeBrainState(state, from); }
  return null;
}

/** « Effacer le signalement ». */
export function clearFlag(note: string, from = notesDir()): string | null {
  const state = readBrainState(from);
  const name = noteFile(note, from) ?? note;
  if (!state.flags.some(f => f.note === name)) return null;
  state.flags = state.flags.filter(f => f.note !== name);
  writeBrainState(state, from);
  return null;
}

/** Réglages › Notes: every note, its scope, dates, flag (who, when) and the count of lines under « ## Ajouts ». */
export async function noteInfos(from = notesDir(), now = new Date().toISOString()): Promise<NoteInfo[]> {
  const { notes } = await readNotes(from);
  const state = readBrainState(from);
  return notes.map(n => {
    const flag = n.flag ? state.flags.filter(f => f.note === n.name).at(-1) : undefined;
    const old = oldFor(n, now);
    const lines = n.body.split('\n'); const at = lines.findIndex(l => l.trim() === ADDITIONS);
    let additions = 0;
    if (at >= 0) for (let i = at + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]!); i++) if (/^\s*-\s/.test(lines[i]!)) additions++;
    return { name: n.name, file: n.file, title: n.title, ...(n.when ? { when: n.when } : {}), firstLine: n.firstLine, scope: n.scope, projects: n.projects,
      modifiedAt: n.modifiedAt, ...(n.checkedAt ? { checkedAt: n.checkedAt } : {}), ...(old ? { oldDays: old } : {}),
      ...(flag ? { flag: { what: flag.what, by: flag.by, at: flag.at } } : {}), additions, truncated: n.truncated };
  });
}
