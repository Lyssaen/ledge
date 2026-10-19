import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';
import type { MobileClientMessage, MobilePairing, MobileState } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';
import { clearPairingRequest, setPairingDialogOpen, usePairingRequest } from './pairingRequest';

/** The mockup's phone (docs/mockups/mobile-access/main.tsx): the dialog's device, Settings › Mobile access's icon and devices.
 *  It lives here, in the first bundle with the dialog, so the dialog does not pull the settings chunk. */
export const PHONE = ['M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** The oldest request first: every pairing lives as long, so the one that expires first came first. */
const byAge = (a: MobilePairing, b: MobilePairing) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt);

/** Seconds left until `iso`, read at each render and refreshed every second while `running`. */
function useSecondsLeft(iso: string | null, running: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [running, iso]);
  return iso === null ? 0 : Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000));
}

/**
 * « Lier un appareil » (docs/mockups/mobile-access, scenario « pairing »), mounted by the shell so it opens on any screen as soon
 * as a pairing comes to `confirm`; those are shown one at a time, the oldest first. Approve and Deny are commands to the daemon;
 * what follows is the daemon's state: approved (wait for the phone), linked or expired (« Fermer »), refused (closes). Escape,
 * the backdrop and the title's close only close it: Settings › Mobile access › « Comparer le code » opens it again.
 */
export function PairingDialog({ mobile, fleet, notify }: { mobile: MobileState | undefined; fleet: { sendMobile(msg: MobileClientMessage): void }; notify(text: string): void }): JSX.Element | null {
  const { t } = useI18n();
  const c = t.pairing;
  const body = useId();
  // The pairing on screen; the ones closed here (they do not reopen by themselves); the last look at the one on screen, so a
  // linked or expired result stays until « Fermer » after the daemon forgets it.
  const [shownId, setShownId] = useState<string | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const kept = useRef<MobilePairing | null>(null);

  const pairings = mobile?.enabled ? mobile.pairings : [];
  const live = shownId === null ? undefined : pairings.find(p => p.id === shownId);
  const last = kept.current;
  const current: MobilePairing | null =
    live && !closed.has(live.id) && (live.state === 'confirm' || live.state === 'approved' || live.state === 'linked' || live.state === 'expired') ? live
    : !live && shownId !== null && last?.id === shownId && !closed.has(shownId) && mobile?.enabled && (last.state === 'linked' || last.state === 'expired') ? last
    : pairings.filter(p => p.state === 'confirm' && !closed.has(p.id)).sort(byAge)[0] ?? null;
  kept.current = current;
  const id = current?.id ?? null;

  const close = useCallback((which: string) => {
    setClosed(s => new Set(s).add(which));
    setShownId(null);
    clearPairingRequest();
  }, []);
  // What is on screen stays there (a confirm that became approved is no longer « the oldest to confirm »).
  useEffect(() => { if (id !== null) setShownId(id); }, [id]);
  // « Comparer le code »: that pairing again, even after Escape (declared after the effect above, so it wins in one commit).
  const request = usePairingRequest();
  useEffect(() => {
    if (!request) return;
    clearPairingRequest();
    setClosed(s => { if (!s.has(request.id)) return s; const n = new Set(s); n.delete(request.id); return n; });
    setShownId(request.id);
  }, [request]);
  // The shell and the section follow; Escape closes from wherever the focus is, before the window's shortcuts see it.
  useEffect(() => {
    if (id === null) return;
    const dismiss = () => close(id);
    setPairingDialogOpen({ id, dismiss });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); dismiss(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); setPairingDialogOpen(null); };
  }, [id, close]);

  const waiting = current !== null && (current.state === 'confirm' || current.state === 'approved');
  const left = useSecondsLeft(current?.expiresAt ?? null, waiting);
  if (!current) return null;

  const send = (msg: MobileClientMessage): boolean => {
    try { fleet.sendMobile(msg); return true; } catch (e) {
      notify((e as Error).name === 'DaemonOutdated' ? t.settings.mobile.refused.outdated : t.settings.mobile.refused.offline);
      return false;
    }
  };
  const groups = (current.code ?? '').split(' ').filter(Boolean);
  const spelled = groups.map(g => [...g].join(' ')).join(', ');
  const dismiss = () => close(current.id);
  const login = mobile?.account?.login;

  return (
    <Modal title={c.title} className="pair-modal" describedBy={body} onClose={dismiss}>
      <div className="pair-content">
        {waiting && <>
          <p id={body}>{login ? <>{c.intro.before}<strong>@{login}</strong>{c.intro.after}</> : c.introNoAccount}</p>
          <div className="pair-device"><span className="machine-glyph" aria-hidden="true"><Icon d={PHONE} size={16} /></span><strong>{current.label}</strong></div>
          <div className={current.state === 'approved' ? 'pair-code dim' : 'pair-code'}>
            <span className="pair-code-label">{c.codeLabel}</span>
            <output className="mono" aria-label={c.codeSpelled(spelled)}>
              {groups.map((g, i) => <span key={i}>{i > 0 && <span className="pair-gap" />}{g}</span>)}
            </output>
          </div>
        </>}
        {current.state === 'confirm' && <>
          <p>{c.check}</p>
          <p className="pair-warn">{c.warn}</p>
          <div className="pair-actions">
            <span className="set-hint pair-expiry">{c.expiresIn(mmss(left))}</span>
            <span className="spacer" />
            <Button autoFocus onClick={() => { if (send({ type: 'mobile.pairing.deny', id: current.id })) dismiss(); }}>{c.deny}</Button>
            <Button variant="primary" onClick={() => send({ type: 'mobile.pairing.approve', id: current.id })}>{c.approve}</Button>
          </div>
        </>}
        {current.state === 'approved' && (
          <div className="set-well pair-wait">
            <span className="ledge-spin" aria-hidden="true"><Icon d={ICONS.refresh.d} size={14} /></span>
            <span role="status" aria-live="polite"><strong>{c.approved.strong}</strong>{c.approved.rest}</span>
          </div>
        )}
        {current.state === 'linked' && <>
          <div role="status" className="set-well ok pair-result" id={body}><Icon d={ICONS.check.d} size={16} /><span><strong>{c.linked.strong(current.label)}</strong>{c.linked.rest}</span></div>
          <div className="pair-actions"><span className="spacer" /><Button variant="primary" autoFocus onClick={dismiss}>{c.close}</Button></div>
        </>}
        {current.state === 'expired' && <>
          <div role="alert" className="set-well bad pair-result" id={body}><Icon d={ICONS.close.d} size={16} /><span>{c.expired}</span></div>
          <div className="pair-actions"><span className="spacer" /><Button variant="primary" autoFocus onClick={dismiss}>{c.close}</Button></div>
        </>}
      </div>
    </Modal>
  );
}
