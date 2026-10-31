import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';
import type { PreviewTool } from './harness';

/** Session management: end a session, archive it (it leaves its table and waits in Archives), or delete it for good. */
export type ManagedAgent = { id: string; name: string; tool: PreviewTool; project: string; state: BotState; task: string; machine: string; repos: string; parent?: string; offline?: boolean; since?: number };
/** An archived session: the principal and the sub-agents that left with it; `ago` is in minutes. */
export type ArchivedEntry<A extends ManagedAgent = ManagedAgent> = { agent: A; helpers: A[]; ago: number; turns: number };
export type ManageAction = 'open' | 'terminal' | 'rename' | 'end' | 'archive' | 'delete' | 'resume' | 'restore' | { file: string };

export const archiveIcon = ['M3 4h18v4H3z', 'M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8', 'M10 12h4'];
export const trashIcon = ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12', 'M9 7V4h6v3'];
export const stopIcon = ['M6 6h12v12H6z'];
export const resumeIcon = ['M4 12a8 8 0 1 0 2.3-5.6', 'M4 4v4h4', 'M10 9l5 3-5 3z'];
export const restoreIcon = ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'];
export const terminalIcon = ['m4 6 5 6-5 6', 'M12 18h8'];
export const renameIcon = ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'];
export const dotsIcon = ['M5 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z', 'M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z', 'M19 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z'];

/** A session still runs when its agent is reachable and has not finished. */
export const isLive = (a: ManagedAgent) => !a.offline && a.state !== 'done';
export const ago = (m: number) => m < 60 ? `il y a ${Math.max(1, Math.round(m))} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : m < 2880 ? 'hier' : `il y a ${Math.round(m / 1440)} j`;

/** The session menu: opened from a seat (right click or its "…"), a row of the Liste, or the session page. */
export function SessionMenu({ agent, at, kids, projects = [], onAction, onClose }: { agent: ManagedAgent; at: { x: number; y: number }; kids: number; projects?: { id: string; name: string }[]; onAction: (a: ManageAction) => void; onClose: () => void }) {
  const [filing, setFiling] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useEffect(() => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); setPos({ x: Math.min(at.x, innerWidth - r.width - 8), y: at.y + r.height > innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y }); el.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus() }, [at.x, at.y]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const items = [...ref.current!.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)')]; const i = items.indexOf(document.activeElement as HTMLElement); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() } };
    document.addEventListener('mousedown', close); window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', key, true) };
  }, [onClose]);
  const live = isLive(agent);
  const item = (a: ManageAction, icon: string[], label: string, hint?: React.ReactNode, o: { danger?: boolean; disabled?: string } = {}) =>
    <button role="menuitem" className={o.danger ? 'danger' : ''} disabled={!!o.disabled} title={o.disabled} onClick={() => { onClose(); onAction(a) }}><span><Icon d={icon} size={14} />{label}</span>{hint && <small>{hint}</small>}</button>;
  return <div ref={ref} className="session-menu" role="menu" aria-label={`Gérer la session ${agent.name}`} style={{ left: pos.x, top: pos.y }}>
    <div className="session-menu-head"><strong>{agent.name}</strong><small>{agent.task}</small></div>
    {item('open', ICONS.external.d, 'Ouvrir la session', <Kbd>Entrée</Kbd>)}
    {item('terminal', terminalIcon, agent.tool === 'omp' ? 'Shell libre du projet' : 'Terminal', <Kbd>T</Kbd>, { disabled: agent.offline ? `${agent.machine} est injoignable.` : undefined })}
    {item('rename', renameIcon, 'Renommer…', <Kbd>F2</Kbd>)}
    <button role="menuitem" aria-haspopup="menu" aria-expanded={filing} onClick={() => setFiling(!filing)}><span><Icon d={ICONS.folder.d} size={14} />Ranger dans…</span><Icon d={ICONS.chevronRight.d} size={12} /></button>
    {filing && <div className="session-menu-sub" role="menu" aria-label="Ranger dans">{projects.filter(x => x.id !== agent.project).map(x => <button key={x.id} role="menuitem" onClick={() => { onClose(); onAction({ file: x.id }) }}><span><i className={`side-swatch swatch-${x.id}`} />{x.name}</span></button>)}</div>}
    <hr />
    {agent.state === 'done' && !agent.offline
      ? item('resume', resumeIcon, 'Reprendre la session')
      : item('end', stopIcon, 'Terminer la session', undefined, { disabled: agent.offline ? `${agent.machine} est injoignable : Ledge ne peut pas l’arrêter.` : undefined })}
    {item('archive', archiveIcon, live ? 'Terminer et archiver…' : 'Archiver', <Kbd>E</Kbd>)}
    {kids > 0 && <p className="session-menu-note">{kids} sous-agent{kids > 1 ? 's' : ''} {kids > 1 ? 'partent' : 'part'} avec {agent.name}.</p>}
    <hr />
    {item('delete', trashIcon, 'Supprimer…', <Kbd>Suppr</Kbd>, { danger: true })}
  </div>;
}

export type Confirm = { kind: 'end' | 'archive' | 'delete'; names: string[]; live: number; offline: string[]; archived?: boolean; kids: number };
/** Ending is irreversible, deleting too: both ask first. Archiving a session that still runs ends it, so it asks as well. */
export function ConfirmDialog({ c, onConfirm, onCancel }: { c: Confirm; onConfirm: () => void; onCancel: () => void }) {
  const who = c.names.length === 1 ? c.names[0] : `ces ${c.names.length} sessions`;
  const Who = c.names.length === 1 ? c.names[0] : `Ces ${c.names.length} sessions`;
  const text = c.kind === 'end'
    ? { title: `Terminer ${who} ?`, body: <>L’agent s’arrête maintenant, même au milieu d’une tâche. Sa conversation reste lisible et {c.names.length > 1 ? 'les sessions restent' : 'il reste'} à {c.names.length > 1 ? 'leur' : 'sa'} table, marqué{c.names.length > 1 ? 'es' : 'e'} « Terminée ».</>, ok: 'Terminer' }
    : c.kind === 'archive'
      ? { title: `Terminer et archiver ${who} ?`, body: <>{c.live === 1 && c.names.length === 1 ? `${c.names[0]} travaille encore : Ledge l’arrête, puis le range dans les Archives.` : `${c.live} session${c.live > 1 ? 's' : ''} travaille${c.live > 1 ? 'nt' : ''} encore : Ledge les arrête, puis les range dans les Archives.`} Vous pourrez relire la conversation ou la reprendre plus tard.</>, ok: 'Terminer et archiver' }
      : { title: `Supprimer ${who} ?`, body: <>{Who} disparai{c.names.length > 1 ? 'ssent' : 't'} de Ledge{c.archived ? ', archives comprises' : ''} : fil, documents et position à la table. {c.live > 0 && <>{c.live > 1 ? `${c.live} sessions travaillent` : 'La session travaille'} encore : Ledge {c.live > 1 ? 'les' : 'l’'}arrête d’abord. </>}L’historique gardé par l’outil de l’agent sur la machine n’est pas touché.</>, ok: 'Supprimer définitivement' };
  return <div className="modal-backdrop confirm-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
    <section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
      <div className={`confirm-icon ${c.kind}`}><Icon d={c.kind === 'delete' ? trashIcon : c.kind === 'end' ? stopIcon : archiveIcon} size={18} /></div>
      <h2 id="confirm-title">{text.title}</h2>
      <p id="confirm-body">{text.body}</p>
      {c.kids > 0 && <p className="confirm-extra muted">{c.kids} sous-agent{c.kids > 1 ? 's' : ''} {c.kind === 'delete' ? (c.kids > 1 ? 'sont supprimés' : 'est supprimé') : c.kind === 'end' ? (c.kids > 1 ? 's’arrêtent' : 's’arrête') : (c.kids > 1 ? 'partent' : 'part')} avec {c.names.length > 1 ? 'eux' : c.names[0]}.</p>}
      {c.offline.length > 0 && <p className="confirm-extra muted">{c.offline.join(', ')} : machine injoignable. Ledge {c.kind === 'delete' ? 'l’oublie' : 'le range'} sans pouvoir l’arrêter ; l’agent s’arrêtera de lui-même ou au retour de la machine.</p>}
      <div className="confirm-actions"><Button autoFocus onClick={onCancel}>Annuler</Button><Button variant="primary" className={c.kind === 'delete' ? 'danger-btn' : ''} onClick={onConfirm}>{text.ok}</Button></div>
    </section>
  </div>;
}

/** The undo toast: archiving is reversible for a few seconds without opening the Archives. */
export function UndoToast({ text, onUndo, seconds }: { text: string; onUndo?: () => void; seconds: number }) {
  return <div className="toast undo-toast" role="status"><span>{text}</span>{onUndo && <button onClick={onUndo}>Annuler <Kbd>Ctrl Z</Kbd></button>}<i style={{ animationDuration: `${seconds}s` }} /></div>;
}
