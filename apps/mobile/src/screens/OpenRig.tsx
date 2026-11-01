import { useEffect, useRef, useState } from 'react';
import { point } from '../model/point';
import type { PhoneThreadItem } from '@ledge/protocol';
import { foldLabel, rigPlace, rigProgress, sortRigs } from '../model/rigs';
import { href, navigate } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { Header, linkView } from '../ui/Header';
import { TabBar } from '../ui/TabBar';

const card = 'block rounded-card border border-line bg-surface p-4';
const button = 'rounded-control border border-line px-3 py-2 text-left disabled:opacity-50';
const field = 'w-full rounded-control border border-line bg-surface p-3';

export function Rigs({ store }: { store: MobileStore }) {
  const s = useMobile(store); const rigs = sortRigs([...s.rigs.values()], [...s.escalations.values()]);
  return <><Header title="Rigs" subtitle={`${rigs.length} rigs`} link={linkView(s)} /><main className="min-h-0 flex-1 space-y-3 overflow-y-auto">
    {rigs.map(r => { const p = rigProgress(r); return <a className={card} key={r.key} href={href({ name: 'rig', key: r.key, view: 'seats' })}><strong>{r.kernel ? 'Noyau OpenRig · ' : ''}{r.name}</strong><p>{rigPlace(r)}{r.branch ? ` · ${r.branch}` : ''}</p><p>{p.working}/{p.total} au travail · {r.repos} dépôts</p></a>; })}
    {!rigs.length && <p>Aucun rig pour le moment.</p>}<a className={button} href={href({ name: 'new-rig' })}>Lancer un rig…</a>
  </main><TabBar count={[...s.escalations.values()].filter(e => e.state === 'pending').length} active="rigs" openrig /></>;
}

export function RigPage({ store, rigKey, view }: { store: MobileStore; rigKey: string; view: 'seats' | 'exchanges' | 'queue' }) {
  const s = useMobile(store); const rig = s.rigs.get(rigKey); const [notice, setNotice] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { if (view !== 'seats') store.requestExchanges(rigKey); }, [store, rigKey, view]);
  const exchanges = (s.rigExchanges.get(rigKey) ?? []).filter(e => view !== 'queue' || e.kind === 'task' || e.kind === 'handoff');
  const action = async (verb: 'down' | 'restart', seatRef?: string) => { const result = await store.rigAction({ type: 'rig.act', key: rigKey, verb, ...(seatRef ? { seatRef } : {}) }); setNotice(result.status === 'applied' ? 'Demande acceptée.' : `Action non appliquée : ${result.status}`); };
  if (!rig) return <main><p>Ce rig est arrêté</p><a href={href({ name: 'rigs' })}>Retour aux rigs</a></main>;
  return <><Header title={rig.name} subtitle={rigPlace(rig)} link={linkView(s)} /><main className="min-h-0 flex-1 space-y-3 overflow-y-auto"><nav className="flex gap-2">{(['seats', 'exchanges', 'queue'] as const).map(v => <a className={button} key={v} href={href({ name: 'rig', key: rigKey, view: v })}>{v === 'seats' ? 'Sièges' : v === 'exchanges' ? 'Échanges' : 'Queue'}</a>)}</nav>
    {view !== 'seats' && s.rigExchangeCuts.has(rigKey) && <p>Les 200 derniers échanges sont affichés.</p>}
    {view === 'seats' ? rig.seats.map(seat => <div className={card} key={seat.ref}><strong>{seat.address} · {seat.name}</strong><p>{seat.runtime}{seat.model ? ` · ${seat.model}` : ''} · {seat.state}{seat.contextPct !== undefined ? ` · ${seat.contextPct}%` : ''}</p>{seat.sessionId && <a href={href({ name: 'thread', sessionId: seat.sessionId })}>Ouvrir le siège</a>} <button className={button} disabled={!s.fresh} onClick={() => void action('restart', seat.ref)}>Relancer le siège…</button></div>) : exchanges.map(e => <div className={card} key={e.id}><strong>{e.from} → {e.to}</strong><p>{e.text}</p></div>)}
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (message.trim() && store.sayLedge(`@${rig.name} ${message.trim()}`)) navigate({ name: 'chat' }); }}><input className={field} aria-label={`Écrire à Ledge sur ${rig.name}`} value={message} onChange={event => setMessage(event.target.value)} /><button className={button} disabled={!s.fresh || !message.trim()}>Envoyer</button></form>
    <button className={button} disabled={!s.fresh} onClick={() => void action('down')}>Arrêter le rig…</button>{notice && <p role="status">{notice}</p>}
  </main><TabBar count={0} active="rigs" openrig /></>;
}

export function EscalationPage({ store, id }: { store: MobileStore; id: string }) {
  const s = useMobile(store); const e = s.escalations.get(id); const [answers, setAnswers] = useState<Record<string, string>>({}); const [op, setOp] = useState<string | null>(null);
  const phase = op ? s.ops[op]?.phase : undefined; const sent = phase === 'sending' || phase === 'uncertain' || phase === 'applied';
  if (!e) return <main><p>Cette demande n’est plus disponible.</p><a href={href({ name: 'inbox' })}>Retour à À toi</a></main>;
  const complete = e.questions.length ? e.questions.every(q => !!answers[q.id]) : !!answers.text?.trim();
  return <><Header title="À toi" subtitle={e.rigName ?? e.from} link={linkView(s)} /><main className="min-h-0 flex-1 space-y-3 overflow-y-auto"><h2>{e.summary}</h2>{e.detail && <p>{e.detail}</p>}{e.advice && <p>{e.advice}</p>}
    {e.state === 'grace' && <p>Ledge s’en occupe…</p>}{e.answer ? <p>Réponse {e.answer.by === 'user' ? 'par toi' : 'par Ledge'} : {Object.values(e.answer.answers).join(', ')}{e.answer.delivery === 'queued' ? ' · En attente de livraison' : e.answer.delivery === 'sent' ? ' · En cours de livraison' : ''}</p> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (complete) setOp(store.answerEscalation(e.id, answers)); }}>
      {e.questions.length ? e.questions.map(q => <fieldset className={card} key={q.id}><legend>{q.question}</legend>{[...q.options].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended)).map(o => <label className="block py-1" key={o.id}><input type="radio" name={q.id} checked={answers[q.id] === o.id} onChange={() => setAnswers({ ...answers, [q.id]: o.id })} /> {o.label}{o.recommended ? ' · recommandé' : ''}</label>)}</fieldset>) : <textarea className={field} aria-label="Votre réponse" value={answers.text ?? ''} onChange={event => setAnswers({ text: event.target.value })} />}
      <button className={button} disabled={!complete || !s.fresh || sent}>Envoyer la réponse</button>{sent && <p role="status">{phase === 'applied' ? 'Réponse confirmée.' : 'Réponse envoyée, en attente de confirmation.'}</p>}{phase === 'rejected' && <p role="alert">La réponse n’a pas été acceptée. Vérifie son état avant de réessayer.</p>}{phase === 'failed' && <p role="alert">La réponse n’a pas pu être envoyée.</p>}</form>}
  </main></>;
}

function Item({ item, store, talk }: { item: PhoneThreadItem; store: MobileStore; talk: (id: string) => void }) {
  const [status, setStatus] = useState(''); const [review, setReview] = useState(false); const [answerOp, setAnswerOp] = useState<string | null>(null); const state = useMobile(store);
  if (item.kind === 'user' || item.kind === 'ledge') return <p className={card}>{item.text}</p>;
  if (item.kind === 'escalation') { const e = item.escalation; const q = e.questions.length === 1 ? e.questions[0] : undefined; return <section className={card}><a href={href({ name: 'escalation', id: e.id })}><strong>{e.summary}</strong></a>{e.advice && <p>{e.advice}</p>}{e.state === 'grace' && <p>Ledge s’en occupe…</p>}{e.answer ? <p>{e.answer.by === 'user' ? 'Tu as choisi' : 'Ledge a tranché'} · {Object.values(e.answer.answers).join(', ')}</p> : <>{q?.options.map(o => <button key={o.id} className={button} disabled={!state.fresh || (!!answerOp && !['rejected', 'failed'].includes(state.ops[answerOp]?.phase ?? 'sending'))} onClick={() => setAnswerOp(store.answerEscalation(e.id, { [q.id]: o.id }))}>{o.label}{o.recommended ? ' · recommandé' : ''}</button>)}{answerOp && ['rejected', 'failed'].includes(state.ops[answerOp]?.phase ?? '') && <p role="alert">La réponse n’a pas été acceptée. Vérifie la demande avant de réessayer.</p>}<button className={button} onClick={() => talk(e.id)}>En parler</button></>}</section>; }
  if (item.kind === 'exchanges') return <details className={card}><summary>{foldLabel(item)}</summary>{item.items.map(e => <p key={e.id}>{e.from} → {e.to} · {e.text}</p>)}</details>;
  if (item.kind === 'decided') return <div className={card}><p>{item.decision.summary}</p><button className={button} onClick={() => store.revisitDecision(item.decision.id)}>Revenir dessus</button></div>;
  if (item.kind === 'card') return <p className={card}>{item.action.summary}</p>;
  const launched = [...state.rigs.values()].find(r => r.launch?.planId === item.plan.id);
  return <div className={card}><strong>Plan · {item.plan.spec}</strong><p>{item.plan.goal}</p><p>{item.plan.where.kind === 'project' ? `dans ${item.plan.where.project}` : 'hors projet'} · {item.plan.seats.length} sièges</p>{launched ? <div><p>Lancé par toi · {launched.seats.filter(seat => ['ready', 'working', 'idle'].includes(seat.state)).length}/{launched.seats.length} prêts</p><p>{launched.launch?.goalSentAt ? `But donné à ${launched.launch.lead}` : 'Le lead démarre…'}</p><a href={href({ name: 'rig', key: launched.key, view: 'seats' })}>Ouvrir {launched.name}</a></div> : <button className={button} onClick={() => setReview(true)}>Voir le plan</button>}{review && !launched && <section aria-label="Plan du rig"><h3>Ce qui démarre</h3>{item.plan.seats.map(seat => <p key={seat.address}>{seat.address} · {seat.runtime}{seat.model ? ` · ${seat.model}` : ''}</p>)}<h3>Ce qui change</h3>{item.plan.writes.map((w, i) => <p key={i}>{w}</p>)}<button className={button} onClick={() => void store.rigAction({ type: 'rig.launch', planId: item.plan.id }).then(r => setStatus(r.status === 'applied' ? 'Lancé par toi' : r.status === 'rejected' && r.reason === 'invalid' ? 'Plan expiré. Redemander à Ledge.' : `Non lancé : ${r.status}`))}>Lancer · confirmer avec la clé d’accès</button></section>}{status && <p role="status">{status}</p>}{status.startsWith('Plan expiré') && <button className={button} onClick={() => store.sayLedge(item.plan.goal)}>Redemander à Ledge</button>}</div>;
}

export function LedgeThread({ store }: { store: MobileStore }) {
  const s = useMobile(store); const [text, setText] = useState(''); const [about, setAbout] = useState<string>(); const input = useRef<HTMLInputElement>(null); const pending = [...s.escalations.values()].filter(e => e.state === 'pending');
  const stats = point({ rigs: s.rigs.values(), sessions: s.sessions.values(), escalations: s.escalations.values(), decisionsToday: s.decisionsToday });
  return <><Header title="Ledge" subtitle={`${pending.length} demandes pour toi`} link={linkView(s)} /><main className="min-h-0 flex-1 space-y-3 overflow-y-auto"><nav className="flex gap-2"><a href={href({ name: 'inbox' })}>À toi {stats.toYou}</a><a href={href({ name: 'rigs' })}>Rigs {stats.rigs.length}</a><span>Tranché {stats.ruled}</span></nav>{s.ledgeBefore && <button className={button} onClick={() => store.loadOlderThread()}>Voir les messages précédents</button>}{s.ledgeThread.map(i => <Item key={i.id} item={i} store={store} talk={id => { setAbout(id); input.current?.focus(); }} />)}</main><form className="flex gap-2 py-3" onSubmit={e => { e.preventDefault(); if (text.trim() && store.sayLedge(text.trim(), about)) { setText(''); setAbout(undefined); } }}><input ref={input} className={field} aria-label="Message à Ledge" value={text} onChange={e => setText(e.target.value)} /><button className={button} disabled={!s.fresh || !text.trim()}>Envoyer</button></form><TabBar count={pending.length} active="chat" openrig /></>;
}

export function NewRig({ store }: { store: MobileStore }) {
  const s = useMobile(store); const [goal, setGoal] = useState(''); const [project, setProject] = useState(''); const [spec, setSpec] = useState('');
  const projects = [...new Set([...s.rigs.values()].map(r => r.project).concat([...s.sessions.values()].map(session => session.project ?? null)).filter((v): v is string => !!v))];
  return <><Header title="Lancer un rig" subtitle="But donné au lead" link={linkView(s)} /><form className="min-h-0 flex-1 space-y-3 overflow-y-auto" onSubmit={e => { e.preventDefault(); if (store.prepareRig(goal, project || null, spec || undefined)) navigate({ name: 'chat' }); }}><label>But<textarea className={field} value={goal} maxLength={600} onChange={e => setGoal(e.target.value)} /></label><label>Projet<select className={field} value={project} onChange={e => setProject(e.target.value)}><option value="">Hors projet</option>{projects.map(p => <option key={p}>{p}</option>)}</select></label><label>Spec<input className={field} value={spec} onChange={e => setSpec(e.target.value)} /></label><button className={button} disabled={!s.fresh || !goal.trim()}>Demander le plan à Ledge</button></form></>;
}
