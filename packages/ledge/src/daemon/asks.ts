import { randomBytes } from 'node:crypto';
import { backendOf, isArchived, type Ask, type AskRefusal, type Session } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Mailbox } from './mailbox.js';
import { formatLedgeAnswer } from './crossSession.js';
import { jsonJournal, type Journal } from './journal.js';
import { log } from '../log.js';

export type AsksJournal = Journal<Ask[]>;
type Refusal = { code: AskRefusal; reason: string };

export interface AsksDeps {
  store: Pick<Store, 'get' | 'all' | 'onChange'>;
  /** The mailbox's own lines: the answer is typed at its asker's next free moment. */
  mailbox: Pick<Mailbox, 'notify'>;
  now?: () => string;
  journal?: AsksJournal;
  /** Every change of every ask: the fronts show it. */
  onAsk?(a: Ask): void;
}
export interface Asks {
  create(by: string, question: string, options: string): Ask | Refusal;
  answer(id: string, text: string): Ask | Refusal;
  all(): Ask[];
  close(): void;
}

/** Closed asks kept: a week, 200 at most. */
const CLOSED_TTL_MS = 7 * 24 * 3600 * 1000;
const CLOSED_MAX = 200;
const closed = (a: Ask) => a.state !== 'open';

/** A session Ledge launched and can type into, live (the rule `ledge send` follows). */
const reachable = (s: Session | undefined): boolean =>
  !!s && s.source === 'launcher' && s.state !== 'exited' && !isArchived(s) && (!!s.tmuxSession || backendOf(s) === 'omp-rpc');

/**
 * Decisions a lone session asks the user (`ledge ask`): the user answers through a front or `ledge decide`, and the
 * answer is typed to the asker as a `<ledge-answer>`. The first answer wins. An asker that ends before the answer drops
 * its ask. With a journal, asks outlive the daemon.
 */
export function createAsks(d: AsksDeps): Asks {
  const now = d.now ?? (() => new Date().toISOString());
  const asks = new Map<string, Ask>();
  for (const a of d.journal?.load() ?? []) asks.set(a.id, a);

  const save = () => {
    const oldest = Date.parse(now()) - CLOSED_TTL_MS;
    const shut = [...asks.values()].filter(closed);
    for (const a of shut) if (Date.parse(a.closedAt ?? a.at) < oldest) asks.delete(a.id);
    const left = shut.filter(a => asks.has(a.id));
    for (const a of left.slice(0, Math.max(0, left.length - CLOSED_MAX))) asks.delete(a.id);
    d.journal?.save([...asks.values()]);
  };
  const newId = (): string => { for (;;) { const id = `a${randomBytes(3).toString('hex')}`; if (!asks.has(id)) return id; } };
  const put = (a: Ask): Ask => { asks.set(a.id, a); save(); d.onAsk?.(a); return a; };
  const dropFor = (session: string) => {
    for (const a of [...asks.values()]) if (a.state === 'open' && a.from === session) {
      put({ ...a, state: 'dropped', closedAt: now() });
      log(`ask ${a.id} dropped: ${a.fromName} ended`);
    }
  };
  // What the last daemon left: an asker that ended meanwhile drops its asks now.
  for (const id of new Set([...asks.values()].filter(a => a.state === 'open').map(a => a.from))) {
    const s = d.store.get(id);
    if (!s || s.state === 'exited') dropFor(id);
  }
  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'recents') return;
    if (c.type === 'removed') return dropFor(c.id);
    if (c.session.state === 'exited') dropFor(c.session.id);
  });

  return {
    create(by, question, options) {
      const s = d.store.get(by);
      if (!reachable(s)) return { code: 'not_session', reason: 'seule une session lancée par Ledge pose une décision' };
      const at = now();
      return put({ id: newId(), from: s!.id, fromName: s!.name, question: question.trim(), options: options.trim(), at, state: 'open' });
    },
    answer(id, text) {
      const a = asks.get(id);
      if (!a) return { code: 'unknown', reason: `aucune décision ${id}` };
      if (a.state === 'dropped') return { code: 'dropped', reason: "cette session s'est terminée avant ta réponse" };
      if (a.state === 'answered') return { code: 'closed', reason: 'déjà répondue' };
      const at = now(); const reply = text.trim();
      const answered = put({ ...a, state: 'answered', answer: { text: reply, at }, closedAt: at });
      d.mailbox.notify(a.from, formatLedgeAnswer({ id: a.id, question: a.question, text: reply }), `ask:${a.id}`);
      return answered;
    },
    all: () => [...asks.values()].sort((a, b) => a.at.localeCompare(b.at)),
    close: () => unsubscribe()
  };
}

export function asksJournal(path: string): AsksJournal & { flush(): Promise<void> } {
  return jsonJournal<Ask[]>(path, 'asks', raw => (Array.isArray(raw) ? raw as Ask[] : undefined));
}
