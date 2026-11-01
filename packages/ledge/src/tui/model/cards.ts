import { randomUUID } from 'node:crypto';
import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'ink';
import type { DaemonClient, DaemonState } from '@ledge/fleet';
import { proposalRows, type ChatTurn } from '@ledge/protocol';
import type { Screen } from '../context.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { appliable, deniable } from '../ui/ActionBox.js';
import { cardPlan, moveRow, selectedRow, type Room } from './actionCard.js';
import { wrapSegs } from './cells.js';
import { openCards, type Card } from './chat.js';

/** A card's send is done when its turn changes, an error comes without a session id, or after this long. */
const CARD_MS = 20_000;

/** The action cards of Ledge's answers (moved from the Ask screen, unchanged): the two newest drawn under the conversation, the
 *  focus `focus` (0… a card) moving through them, their keys and their sends (launch, relay, close, the generic card's rows). */
export function useCards(o: {
  client: DaemonClient; d: DaemonState; t: Messages; go(s: Screen): void; select(id: string | null): void;
  focus: number; setFocus(f: number | ((f: number) => number)): void;
  /** The room the screen leaves: its rows, and the cards' width. */
  height: number; width: number;
}) {
  const { client, d, t, focus, setFocus } = o;
  // A generic card's send (`rid`) is under way until the daemon answers it (chat.acted), whatever its rows did meanwhile.
  const [busy, setBusy] = useState<{ qid: string; turn: ChatTurn | undefined; errorSeq: number; at: number; rid?: string } | null>(null);
  // The action cards (#94): the row chosen in each, the rows a red box asks to confirm, the card ctrl+r opened again.
  const [rowOf, setRowOf] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState<{ qid: string; rows: number[] } | null>(null);
  const [review, setReview] = useState<string | null>(null);

  // Two cards at most are drawn: tab, the focus and the keys only reach those.
  const cards = useMemo(() => openCards(d.chat).slice(0, 2), [d.chat]);
  // What a card has on screen (#94): all but the frame's two lines, the field's three and the conversation's last one, shared by
  // the cards drawn. A request taller than that is cut: never accepted unread.
  const room: Room = {
    lines: Math.floor((o.height - 6) / Math.max(1, cards.length)),
    height: (text, indent) => text.split('\n').reduce((n, l) => n + Math.max(1, wrapSegs([{ text: l, color: C.fg }], Math.max(10, o.width - 8 - indent)).length), 0)
  };
  const planOf = (turn: ChatTurn) => cardPlan(turn.actions ?? [], room);
  useEffect(() => { if (focus >= cards.length) setFocus(cards.length ? cards.length - 1 : -1); }, [cards.length, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opened again with ctrl+r: its card has the focus once it is back.
  useEffect(() => {
    if (!review) return;
    const i = cards.findIndex(c => c.qid === review);
    if (i >= 0) { setFocus(i); setReview(null); }
  }, [cards, review]); // eslint-disable-line react-hooks/exhaustive-deps
  // A confirmation of a card that went (applied or ignored elsewhere) goes with it.
  useEffect(() => { if (confirming && !cards.some(c => c.kind === 'action' && c.qid === confirming.qid)) setConfirming(null); }, [confirming, cards]);
  // So does one whose rows the screen no longer shows whole (made smaller, a request cut).
  useEffect(() => {
    const turn = confirming && d.chat.find(x => x.qid === confirming.qid);
    if (turn && !confirming.rows.every(i => appliable(planOf(turn).shown[i]!))) setConfirming(null);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  /** The latest card set aside, the one ctrl+r opens again. */
  const ignored = [...d.chat].filter(x => x.ignoredAt).sort((a, b) => b.ignoredAt!.localeCompare(a.ignoredAt!))[0];
  // A card in flight is free again once its turn moved, a refusal came, or nothing happened for a while.
  useEffect(() => {
    if (!busy?.rid) return;
    return client.onMessage(m => { if (m.type === 'chat.acted' && m.rid === busy.rid) setBusy(null); });
  }, [busy?.rid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!busy) return;
    const turn = d.chat.find(x => x.qid === busy.qid);
    if ((turn !== busy.turn && !busy.rid) || (d.errors.at(-1)?.seq ?? 0) > busy.errorSeq) { setBusy(null); return; }
    const timer = setTimeout(() => setBusy(null), Math.max(0, busy.at + CARD_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [busy, d.chat, d.errors]);

  const act = (card: Card) => {
    if (busy || card.kind === 'action') return;
    const turn = d.chat.find(x => x.qid === card.qid);
    if (!turn) return;
    setBusy({ qid: card.qid, turn, errorSeq: d.errors.at(-1)?.seq ?? 0, at: Date.now() });
    if (card.kind === 'launch') {
      const first = proposalRows(turn)[card.rows[0]!]!;
      client.send({ type: 'session.launch', tool: first.tool, cwd: first.cwd, ...(first.prompt ? { prompt: first.prompt } : {}), qid: card.qid, rows: card.rows });
    } else if (card.kind === 'relay') client.send({ type: turn.relay?.status === 'queued' ? 'session.relay.cancel' : 'session.relay', qid: card.qid });
    else client.send({ type: 'session.close', qid: card.qid, rows: card.rows });
  };

  /** A generic card's rows through chat.act: applied, confirmed, or their requests denied (« Refuser »). */
  const send = (qid: string, rows: number[], x: { confirmed?: true; deny?: true } = {}) => {
    const turn = d.chat.find(y => y.qid === qid);
    const rid = randomUUID();
    setBusy({ qid, turn, errorSeq: d.errors.at(-1)?.seq ?? 0, at: Date.now(), rid });
    client.send({ type: 'chat.act', rid, qid, rows, ...x });
  };
  /** The keys of a focused generic card (docs/mockups/ledge-action-card.html, view TUI): ↑ ↓ the row, ↵ applies it, a all
   *  of them, n denies a request, o opens the session, esc sets the card aside; an irreversible one is asked in the box, and
   *  only y confirms it. */
  const actionKey = (qid: string, input: string, key: Pick<Key, 'upArrow' | 'downArrow' | 'return' | 'escape'>): boolean => {
    const turn = d.chat.find(x => x.qid === qid);
    if (!turn?.actions) return false;
    const p = planOf(turn);
    const sel = selectedRow(p, rowOf[qid]);
    const ask = (rows: number[]) => { if (rows.some(i => p.rows[i]!.risk === 'destructive')) setConfirming({ qid, rows }); else send(qid, rows); };
    if (confirming?.qid === qid) {
      if (input === 'y') { const rows = confirming.rows; setConfirming(null); if (rows.every(i => appliable(p.shown[i]!))) send(qid, rows, { confirmed: true }); }
      else if (key.escape) setConfirming(null);
      // ↵ never confirms: a double press dissolves nothing.
      return true;
    }
    const r = p.rows[sel]!, s = p.shown[sel]!;
    if (input === 'o') {
      const id = turn.actions[sel]?.session;
      if ((s === 'stale' || s === 'cut') && id) { o.select(id); o.go('session'); }
      return true;
    }
    // A send under way, or a row still running: nothing else goes until the daemon has answered.
    if (busy?.qid === qid || p.shown.includes('running')) return true;
    if (key.upArrow || input === 'k') { setRowOf(m => ({ ...m, [qid]: moveRow(p, sel, -1) })); return true; }
    if (key.downArrow || input === 'j') { setRowOf(m => ({ ...m, [qid]: moveRow(p, sel, 1) })); return true; }
    if (key.return) { if (appliable(s)) ask([sel]); return true; }
    if (input === 'a' && p.rows.length > 1) { if (p.all.rows.length) ask(p.all.rows); return true; }
    if (input === 'n') { if (deniable(r, s)) send(qid, [sel], { deny: true }); return true; }
    if (key.escape) {
      // Nothing left to do from the card (a request changed): esc goes back, as on a settled card.
      if (p.open.length || p.shown.some(x => x === 'cut')) client.send({ type: 'chat.ignore', qid }); else setFocus(-1);
      return true;
    }
    return false;
  };
  /** A focused generic card's keys, as its state allows. */
  const actionKeys = (qid: string): Array<readonly [string, string]> => {
    const turn = d.chat.find(x => x.qid === qid);
    if (!turn?.actions) return [];
    if (confirming?.qid === qid) return [['y', t.keys.apply], ['esc', t.keys.cancel]];
    const p = planOf(turn);
    const sel = selectedRow(p, rowOf[qid]);
    const r = p.rows[sel]!, s = p.shown[sel]!, many = p.rows.length > 1;
    const next = ['tab', focus + 1 < cards.length ? t.keys.nextCard : t.keys.conversation] as const;
    if (s === 'cut') return [['n', t.keys.deny], ['o', t.keys.openSession(r.target ?? '')], ['esc', t.keys.ignore], next, ['ctrl+n', t.keys.newChat]];
    if (!p.open.length) return [next, ['ctrl+n', t.keys.newChat], ['esc', t.keys.back]];
    return [['↵', many ? t.keys.applyRow : t.keys.apply], ...(many ? [['a', t.keys.applyAll] as const, ['↑ ↓', t.keys.line] as const] : []),
      ...(deniable(r, s) ? [['n', t.keys.deny] as const] : []), ['esc', t.keys.ignore], next, ['ctrl+n', t.keys.newChat]];
  };
  /** ctrl+r: the latest card set aside comes back, focused once it is. */
  const reopen = () => { if (ignored) { client.send({ type: 'chat.ignore', qid: ignored.qid, undo: true }); setReview(ignored.qid); } };

  return { cards, planOf, busy, rowOf, confirming, ignored, act, actionKey, actionKeys, reopen };
}
