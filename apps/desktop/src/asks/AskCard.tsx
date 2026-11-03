import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import type { HumanAnswer, HumanAsk, OpenRigAnswered, Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { spanOf } from '../list/time';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot } from '../shell/SessionBot';
import { endOf, pillOf, whoOf, type AnswerEnd } from './model';
import { plainOf } from './plain';

const FILE = ['M6 3h8l4 4v14H6z', 'M14 3v4h4'];
const ALERT = ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'];
const SEND = ['M5 12h14', 'm13 6 6 6-6 6'];

/** The document reader opens Markdown only; an anchor (« file.md#section ») opens the file. */
const readable = (path: string): boolean => /\.(md|markdown)(#.*)?$/i.test(path);
const fileOf = (path: string): string => path.replace(/#.*$/, '');

/** What the card sends, and which control shows the wheel while it goes. */
type Sending = { key: string; answer: HumanAnswer };

/**
 * One thing a rig asks the person (docs/mockups/ledge-human-operator-ab-lot1.html): who, how long ago, the summary, the body
 * (three lines, « Tout lire »), « Détails », the source, then the answer: a button per option (one question after the other),
 * « Répondre autrement… » for words, « Répondre… » on a row parked on the person, « Vu » on a piece of news. While it goes,
 * every control is off and the clicked one turns; « Pas envoyée : … » offers « Réessayer » (the same answer again).
 */
export function AskCard({ ask, session, answer, onDone, onSource, onOpenSeat, focus }: {
  ask: HumanAsk; session: Session | undefined;
  answer(qitemId: string, a: HumanAnswer): Promise<OpenRigAnswered>;
  /** The answer went (or the ask was settled elsewhere): the card becomes its one-line end. */
  onDone(end: 'sent' | 'already'): void;
  onSource?(path: string): void;
  onOpenSeat?(sessionId: string): void;
  /** Bumped to bring this card into view and give it the focus (« Voir » from the sidebar). */
  focus?: number;
}): JSX.Element {
  const { t, lang } = useI18n();
  const a = t.asks;
  const pill = pillOf(ask);
  // An ask never read whole comes with its summary as body: nothing more to show (design-ux).
  const body = ask.bodyTruncated && ask.body === ask.summary ? '' : ask.body;
  // Rigs write Markdown (the lead): folded, the words without the syntax; unfolded, rendered as in the threads.
  const plain = useMemo(() => plainOf(body), [body]);
  const who = whoOf(ask, session);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<Sending | null>(null);
  // `uncertain`: the answer may have gone (design-ux: amber, « Envoi incertain… »); a retry that comes back « already » is then our own send.
  const [failed, setFailed] = useState<{ why: string; retry: Sending; uncertain: boolean } | null>(null);
  // Choices this card recorded, before the next push says so (a question answered shows « ✓ label », for good).
  const [recorded, setRecorded] = useState<ReadonlyMap<string, string>>(new Map());
  const [all, setAll] = useState(false);
  const [details, setDetails] = useState(false);
  const [clamped, setClamped] = useState(false);
  // Measured for this very text: a new body is measured again before it may show whole.
  const [measuredFor, setMeasuredFor] = useState<string | null>(null);
  const measured = measuredFor === plain;
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || all) return;
    setClamped(el.scrollHeight > el.clientHeight + 1 || plain.split('\n').length > (pill === 'decision' || pill === 'question' ? 3 : 2));
    setMeasuredFor(plain);
  }, [plain, all, pill]);
  useEffect(() => { if (composing) fieldRef.current?.focus(); }, [composing]);
  useEffect(() => {
    if (!focus) return;
    // A frame later: arriving on the home, the conversation's field takes the focus when it mounts, after this card (review P1).
    const id = requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView?.({ block: 'nearest' });
      cardRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [focus]);

  /** What a question was answered with, as shown (« ✓ … »): the option's label, or the person's words; null while it waits. */
  const answerOf = (questionId: string): string | null => {
    const q = ask.questions.find(x => x.id === questionId);
    // What the daemon says wins: a choice changed elsewhere (another window, the TUI) shows as it is (review). This card's own
    // choice only fills the gap until the daemon has one.
    const given = q?.answer;
    if (given) return given.kind === 'words' ? given.text : q?.options.find(o => o.id === given.id)?.label ?? given.id;
    const mine = recorded.get(questionId);
    return mine === undefined ? null : q?.options.find(o => o.id === mine)?.label ?? mine;
  };
  const go = async (s: Sending) => {
    const wasUncertain = failed?.uncertain === true && failed.retry === s;
    setSending(s); setFailed(null);
    const end: AnswerEnd = endOf(await answer(ask.id, s.answer));
    setSending(null);
    if (end.kind === 'sent' || end.kind === 'already') { onDone(end.kind === 'already' && wasUncertain ? 'sent' : end.kind); return; }
    if (end.kind === 'recorded') {
      if (s.answer.kind === 'choice') { const { questionId, optionId } = s.answer; setRecorded(r => new Map(r).set(questionId, optionId)); }
      return;
    }
    const why = end.error === 'openrig_stopped' ? a.stopped : end.error === 'offline' ? t.side.offline : end.message ?? end.error;
    setFailed({ why, retry: s, uncertain: end.error === 'uncertain' });
  };
  const sendWords = () => {
    const words = text.trim();
    if (!words || sending) return;
    void go({ key: 'words', answer: ask.kind === 'parked' ? { kind: 'resolve', text: words } : { kind: 'words', text: words } });
  };

  const busy = sending !== null;
  // The Markdown's links to files open like the source does (a session's side pane), when something can open them.
  const docProps = onSource ? { onDocument: (ref: { path: string }) => { if (readable(ref.path)) onSource(fileOf(ref.path)); } } : {};
  const wheel = (key: string) => (sending?.key === key ? <span className="ask-spin" aria-hidden="true" /> : null);
  const time = (() => {
    if (pill === 'update') return new Date(ask.updatedAt).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    const span = spanOf(Date.now() - (Date.parse(ask.updatedAt) || 0));
    return span === 'now' ? t.list.when.now : `${span.n} ${t.list.when.units[span.unit]}`;
  })();
  const urgent = ask.priority === 'routine' ? null : a.priority[ask.priority];
  const answered = ask.questions.filter(q => answerOf(q.id) !== null).length;
  const several = ask.questions.length > 1;

  const options = (q: HumanAsk['questions'][number], small: boolean) => (
    <div className="ask-acts">
      {q.options.map(o => {
        const key = `${q.id}:${o.id}`;
        return (
          <button key={o.id} type="button" className={cls('ask-btn', small && 'sm', o.recommended && 'pri')} disabled={busy || composing}
            title={o.recommended ? a.recommendedBy(who.name) : undefined}
            onClick={() => void go({ key, answer: { kind: 'choice', questionId: q.id, optionId: o.id } })}>
            {wheel(key)}{o.recommended ? a.recommended(o.label) : o.label}
          </button>
        );
      })}
      {!several && <button type="button" className="ask-btn ghost" disabled={busy} onClick={() => setComposing(true)}>{a.answerOther}</button>}
    </div>
  );

  const compose = (
    <div className="ask-compose">
      <textarea ref={fieldRef} className="ask-field" value={text} placeholder={ask.kind === 'parked' ? a.placeholderParked(who.name) : a.placeholder}
        aria-label={ask.kind === 'parked' ? a.placeholderParked(who.name) : a.placeholder} disabled={busy}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendWords(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setComposing(false); }
        }} />
      {/* Words on a request with several questions settle all of it, the unanswered ones too (dev-back, design-ux). */}
      {several && answered < ask.questions.length && <p className="ask-warn">{a.settlesAll}</p>}
      <div className="ask-acts">
        <button type="button" className="ask-btn pri" disabled={busy || !text.trim()} onClick={sendWords}>{sending?.key === 'words' ? wheel('words') : <Icon d={SEND} size={12} />}{a.send}</button>
        <button type="button" className="ask-btn ghost" disabled={busy} onClick={() => setComposing(false)}>{a.cancel}</button>
        <span className="ask-fine ask-keys">{a.keys}</span>
      </div>
    </div>
  );

  const head = (
    <div className="ask-who">
      {session ? <SessionBot session={session} size={16} paused /> : <span className="ask-hex" aria-hidden="true"><Icon d={SHELL_ICONS.rig} size={13} /></span>}
      {ask.from.rig && <strong>{ask.from.rig}</strong>}
      <span>· {session && onOpenSeat ? <button type="button" className="ask-seat" onClick={() => onOpenSeat(session.id)}>{who.name}</button> : who.name}</span>
      {who.role && <span className="ask-mono">{who.role}</span>}
      <span className={cls('ask-pill', `ask-pill-${pill}`)}>{a.pill[pill]}</span>
      {urgent && <span className="ask-pill ask-pill-urgent">{urgent}</span>}
      <span className="ask-fill" />
      <time dateTime={ask.updatedAt}>{time}</time>
    </div>
  );
  const source = ask.evidenceRef && (
    <div className="ask-acts">
      {readable(ask.evidenceRef) && onSource
        ? <button type="button" className="ask-src" onClick={() => onSource(fileOf(ask.evidenceRef!))}><Icon d={FILE} size={11} />{ask.evidenceRef}</button>
        // Nothing here can open it (not Markdown, or no session knows the seat's folder): shown, not offered (review).
        : <span className="ask-src ask-src-inert" title={ask.evidenceRef}><Icon d={FILE} size={11} />{ask.evidenceRef}</span>}
    </div>
  );

  // The body, folded then « Tout lire », and « Détails »: the decision's pattern, for a piece of news too (review, design-ux).
  const bodyBlock = <>
    {body && (all || (measured && !clamped)
      // Unfolded, or short enough to show whole: the Markdown rendered.
      ? <div className="ask-body ask-md"><ThreadMarkdown text={body} {...docProps} /></div>
      : <p ref={bodyRef} className={cls('ask-body', pill === 'parked' || pill === 'update' ? 'clamp2' : 'clamp3')}>{plain}</p>)}
    {clamped && !all && <button type="button" className="ask-more" onClick={() => setAll(true)}>{a.readAll}</button>}
    {ask.detail && <>
      <button type="button" className="ask-fold" aria-expanded={details} onClick={() => setDetails(d => !d)}>
        <span className={cls('ask-chev', details && 'open')}><Icon d={ICONS.chevronRight.d} size={11} /></span>{a.details}
      </button>
      {details && <div className="ask-body ask-md ask-detail"><ThreadMarkdown text={ask.detail} {...docProps} /></div>}
    </>}
  </>;

  if (pill === 'update') return (
    <article ref={cardRef} tabIndex={-1} className="ask-card ask-update" aria-label={ask.summary} data-ask={ask.id}>
      {head}
      <div className="ask-update-row">
        <div className="ask-update-text">
          <b>{ask.summary}</b>
          {bodyBlock}
        </div>
        <button type="button" className="ask-btn sm ghost" disabled={busy} onClick={() => void go({ key: 'seen', answer: { kind: 'seen' } })}>{wheel('seen')}{a.seen}</button>
      </div>
      {source}
      {failed && <Failed why={failed.why} uncertain={failed.uncertain} onRetry={() => void go(failed.retry)} busy={busy} />}
    </article>
  );

  return (
    <article ref={cardRef} tabIndex={-1} className={cls('ask-card', ask.kind === 'decision' && 'hot')} aria-label={ask.summary} data-ask={ask.id}>
      {head}
      <h4>{ask.summary}</h4>
      {!composing && <>
        {bodyBlock}
        {source}
      </>}
      {composing && !several ? compose
        : ask.questions.length === 0
          ? <div className="ask-acts"><button type="button" className="ask-btn" disabled={busy} onClick={() => setComposing(true)}>{ask.kind === 'parked' ? a.answerParked : a.writeAnswer}</button></div>
          : several
            ? <>
                {ask.questions.map((q, i) => {
                  const chosen = answerOf(q.id);
                  return (
                    <div key={q.id} className="ask-q">
                      <span className="ask-qt">{i + 1}. {q.question}</span>
                      {chosen !== null
                        ? <span className="ask-chosen"><Icon d={ICONS.check.d} size={13} />{chosen}</span>
                        : options(q, true)}
                    </div>
                  );
                })}
                {composing ? <div className="ask-foot">{compose}</div> : <div className="ask-acts ask-foot">
                  <span className="ask-fine">{a.progress(answered, ask.questions.length)}</span>
                  <span className="ask-fill" />
                  <button type="button" className="ask-btn sm ghost" disabled={busy} onClick={() => setComposing(true)}>{a.answerOther}</button>
                </div>}
              </>
            : options(ask.questions[0]!, false)}
      {failed && <Failed why={failed.why} uncertain={failed.uncertain} onRetry={() => void go(failed.retry)} busy={busy} />}
    </article>
  );
}

function Failed({ why, uncertain, onRetry, busy }: { why: string; uncertain: boolean; onRetry(): void; busy: boolean }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className={cls('ask-err', uncertain && 'ask-uncertain')} role="alert">
      <Icon d={ALERT} size={13} /><span>{uncertain ? t.asks.uncertain : t.asks.notSent(why)}</span><span className="ask-fill" />
      <button type="button" className="ask-btn sm" disabled={busy} onClick={onRetry}>{t.asks.retry}</button>
    </div>
  );
}

/** The card's end, for 1.5 s: « ✓ Envoyé à Bix · pilot », or « ✓ Déjà réglée ailleurs ». */
export function AskDone({ end, name, role }: { end: 'sent' | 'already'; name: string; role: string | null }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ask-done" role="status">
      <Icon d={ICONS.check.d} size={14} />
      {end === 'sent' ? <span><b>{t.asks.sentTo} {name}</b>{role && ` · ${role}`}</span> : <span><b>{t.asks.already}</b></span>}
    </div>
  );
}
