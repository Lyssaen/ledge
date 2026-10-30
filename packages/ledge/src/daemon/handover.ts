import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEF_MAX, isArchived, type Autonomy, type Handover, type Session, type Tool } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Mailbox } from './mailbox.js';
import { log } from '../log.js';

/** How long a session has to write its brief before Ledge writes one itself. */
export const BRIEF_MS = 10 * 60_000;
/** How much of the brief the relief's first instruction quotes; the whole one is `ledge handover show`. */
const PROMPT_BRIEF_MAX = 6000;

export interface HandoverDeps {
  store: Pick<Store, 'get' | 'all' | 'upsert' | 'patch' | 'onChange'>;
  /** The request for a brief goes before anything waiting: past the brief's deadline Ledge writes an empty one. */
  mailbox: Pick<Mailbox, 'notify'>;
  /** Launches the relief as `session.launch` would. */
  launch(req: { tool: Tool; cwd: string; prompt: string; model?: string; effort?: string; autonomy?: Autonomy }): Promise<Session>;
  /** Stops the relieved session's agent. */
  close(s: Session): Promise<unknown>;
  /** Where briefs are kept, one `<session id>.md` each. */
  dir: string;
  now?: () => string;
  briefMs?: number;
}

export interface Handovers {
  /** Starts a session's relief: null once asked, else why not. */
  start(id: string, o?: { auto?: boolean }): string | null;
  /** The brief written by the session being relieved: null once taken, else why not. */
  brief(by: string, text: string): string | null;
  /** The brief a session may read again: its predecessor's, else the one it wrote. */
  show(by: string): { text: string } | { reason: string };
  close(): void;
}

/** The live session a relieved one handed its seat to, down the chain of reliefs; none once the chain has ended. */
export function reliefOf(get: (id: string) => Session | undefined, s: Session): Session | undefined {
  let cur: Session | undefined = s;
  for (let hops = 0; cur && hops < 50; hops++) {
    if (cur.state !== 'exited' && !isArchived(cur)) return cur === s ? undefined : cur;
    const to: string | undefined = cur.handover?.state === 'done' ? cur.handover.to : undefined;
    cur = to ? get(to) : undefined;
  }
  return undefined;
}

/** Names of relieved sessions whose seat still lives: no other launch takes them, so a message to one still reaches its seat. */
export function heldNames(all: Session[]): string[] {
  const byId = new Map(all.map(s => [s.id, s] as const));
  return all.filter(s => s.handover?.state === 'done' && reliefOf(id => byId.get(id), s)).map(s => s.name);
}

/** The sections a brief must carry (OpenRig's recap contract, cut to what a relief needs): each as a heading or « Name : ». */
const SECTIONS: [string, RegExp][] = [
  ['Fait', /fait|done/], ['En cours', /en cours|in progress/], ['Suite', /suite|next/], ['Décisions', /d[ée]cisions?/]
].map(([name, re]) => [name as string, new RegExp(`(?:^|[\\s#*(-])(?:${(re as RegExp).source})\\s*\\**\\s*(?::|$)`, 'im')]);
/** The sections a brief lacks, in order; none when it is whole. */
export const briefGaps = (text: string): string[] => SECTIONS.filter(([, re]) => !re.test(text)).map(([name]) => name);

const quote = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/**
 * The relief of a session whose context is nearly full (context handover spec §3.3): its brief asked at its next free
 * moment, a fresh session given that brief, and the old one closed.
 */
export function createHandovers(d: HandoverDeps): Handovers {
  const now = d.now ?? (() => new Date().toISOString());
  const briefMs = d.briefMs ?? BRIEF_MS;
  /** The reliefs waiting for their brief, by session: the fallback timer, and whether Ledge started it. */
  const waiting = new Map<string, { timer: ReturnType<typeof setTimeout>; auto: boolean }>();
  const file = (id: string) => join(d.dir, `${id}.md`);

  const mark = (id: string, h: Omit<Handover, 'at'>) => {
    const cur = d.store.get(id);
    if (cur) d.store.upsert({ ...cur, handover: { ...h, at: now() } });
  };

  /** What Ledge writes when the session wrote nothing: where it worked and its last reply. */
  const fallback = (s: Session): string => {
    return [
      `Bilan écrit par Ledge : ${s.name} n'a pas écrit le sien. Il n'a noté ni décisions ni pièges : vérifie avant de défaire quoi que ce soit.`,
      ...(s.branch ? ['', `Branche : ${s.branch} (${s.workdir ?? s.cwd})`] : []),
      ...(s.lastReply?.text ? ['', 'Sa dernière réponse :', s.lastReply.text] : [])
    ].join('\n');
  };

  async function relieve(id: string, brief: string, auto: boolean): Promise<void> {
    const s = d.store.get(id);
    if (!s) return;
    try { mkdirSync(d.dir, { recursive: true }); writeFileSync(file(id), `${brief.trim()}\n`); }
    catch (e) { log(`brief of ${id} not kept: ${(e as Error).message}`); }
    mark(id, { state: 'launching', ...(auto ? { auto: true } : {}) });
    const prompt = [
      `Tu prends la relève de ${s.name}, dont le contexte était plein. Voici son bilan :`,
      '',
      quote(brief.trim(), PROMPT_BRIEF_MAX),
      '',
      'Relis le bilan complet avec `ledge handover show`.'
    ].join('\n');
    let relief: Session;
    try {
      relief = await d.launch({ tool: s.tool, cwd: s.cwd, prompt, ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), ...(s.autonomy ? { autonomy: s.autonomy } : {}) });
    } catch (e) {
      const reason = (e as Error).message;
      log(`relief of ${s.name} (${id}) not launched: ${reason}`);
      mark(id, { state: 'failed', reason, ...(auto ? { auto: true } : {}) });
      return;
    }
    const at = now();
    const fresh = d.store.get(relief.id) ?? relief;
    d.store.upsert({ ...fresh, relieves: { id, name: s.name, at } });
    const cur = d.store.get(id);
    if (cur && cur.state !== 'exited') await d.close(cur).catch(e => log(`relieved ${id} not closed: ${(e as Error).message}`));
    mark(id, { state: 'done', to: relief.id, toName: relief.name, ...(auto ? { auto: true } : {}) });
    log(`${s.name} (${id}) relieved by ${relief.name} (${relief.id})`);
  }

  const finish = (id: string, brief: string | undefined) => {
    const w = waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer); waiting.delete(id);
    const s = d.store.get(id);
    if (!s) return;
    void relieve(id, brief ?? fallback(s), w.auto).catch(e => { log(`relief of ${id} failed: ${(e as Error).message}`); mark(id, { state: 'failed', reason: (e as Error).message }); });
  };

  // A session that ends before writing its brief: Ledge writes it.
  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'removed') { const w = waiting.get(c.id); if (w) { clearTimeout(w.timer); waiting.delete(c.id); } return; }
    if (c.type === 'updated' && c.session.state === 'exited' && waiting.has(c.session.id)) finish(c.session.id, undefined);
  });

  return {
    start(id, o = {}) {
      const s = d.store.get(id);
      if (!s) return 'session inconnue';
      if (s.source !== 'launcher') return `${s.name} n'a pas été lancée par Ledge`;
      if (s.state === 'exited' || isArchived(s)) return `${s.name} est terminée`;
      if (s.tool === 'omp' || !s.tmuxSession) return `${s.name} n'a pas de terminal où demander son bilan`;
      if (waiting.has(id) || s.handover?.state === 'briefing' || s.handover?.state === 'launching') return `la relève de ${s.name} est déjà en cours`;
      const share = s.context ? ` (${Math.round((s.context.used / s.context.window) * 100)} %)` : '';
      const asked = d.mailbox.notify(id, `<ledge-handover>Ton contexte est presque plein${share} : une nouvelle session va prendre ta place. Écris ton bilan de relève en une seule commande : ledge handover "<bilan>", avec ces sections : Fait : … En cours : … Suite : … Décisions : … (chacune avec sa raison), puis les pièges et les fichiers clés. Un bilan sans l'une d'elles est refusé. Ne commence rien d'autre ensuite.</ledge-handover>`, `handover:${id}:${now()}`, { first: true });
      if (!asked) return `impossible d'écrire à ${s.name}`;
      const auto = o.auto === true;
      waiting.set(id, { timer: setTimeout(() => finish(id, undefined), briefMs), auto });
      mark(id, { state: 'briefing', ...(auto ? { auto: true } : {}) });
      log(`relief of ${s.name} (${id}) asked${auto ? ' by Ledge' : ''}`);
      return null;
    },
    brief(by, text) {
      if (!waiting.has(by)) return 'aucune relève ne t\'attend : Ledge ne t\'a pas demandé de bilan';
      const t = text.trim();
      if (!t) return 'le bilan est vide';
      // The relief starts from this alone: a brief without its sections is refused while there is still time to write it.
      const gaps = briefGaps(t);
      if (gaps.length) return `bilan incomplet, il manque : ${gaps.join(', ')}. Réécris-le en entier.`;
      finish(by, t.slice(0, BRIEF_MAX));
      return null;
    },
    show(by) {
      const s = d.store.get(by);
      if (!s) return { reason: 'session inconnue' };
      const id = s.relieves?.id ?? by;
      try { return { text: readFileSync(file(id), 'utf8') }; }
      catch { return { reason: s.relieves ? `le bilan de ${s.relieves.name} est introuvable` : 'aucun bilan : tu ne prends la relève de personne' }; }
    },
    close() { unsubscribe(); for (const w of waiting.values()) clearTimeout(w.timer); waiting.clear(); }
  };
}
