// Settings › Accès mobile, as a design mockup: the real Settings shell, cards and controls of Ledge Desktop, with a new section.
// Nothing here is app code; the scenario bar at the top is a mockup control, outside the window.
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import '../../../apps/desktop/src/styles/app.css';
import { LangProvider, useI18n } from '../../../apps/desktop/src/i18n/lang';
import { loadMessages } from '../../../apps/desktop/src/i18n/messages';
import { Card, Row, SwitchRow } from '../../../apps/desktop/src/settings/controls';
import { Modal } from '../../../apps/desktop/src/shell/Modal';
import { SHELL_ICONS } from '../../../apps/desktop/src/shell/icons';
import './mobile-access.css';

/* ── The Settings shell (SettingsPage.tsx), with « Accès mobile » between « Machines » and « Projets ». ── */

type Section = 'general' | 'appearance' | 'island' | 'notifications' | 'sounds' | 'machines' | 'mobile' | 'projects' | 'shortcuts' | 'about';
const ORDER: readonly Section[] = ['general', 'appearance', 'island', 'notifications', 'sounds', 'machines', 'mobile', 'projects', 'shortcuts', 'about'];
const PHONE = ['M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'];
const TABLET = ['M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'];
const COPY = ['M9 9h11v11H9z', 'M5 15H4V4h11v1'];
/** SettingsPage.tsx's SECTION_ICONS, plus the new section's phone. */
const SECTION_ICONS: Record<Section, readonly string[]> = {
  general: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  appearance: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 3v18'],
  island: ['M3 5h18v14H3z', 'M9 5h6v1.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 6.5z'],
  notifications: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  sounds: ['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  machines: ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'],
  mobile: PHONE,
  projects: ICONS.folder.d,
  shortcuts: ['M2 6h20v12H2z', 'M6 10h.01', 'M10 10h.01', 'M14 10h.01', 'M18 10h.01', 'M7 14h10'],
  about: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 16v-4', 'M12 8h.01']
};
const MOBILE_TITLE = 'Accès mobile';
const MOBILE_HINT = 'Piloter vos agents depuis votre téléphone, via le serveur relais. Le contenu est chiffré de bout en bout : le serveur ne peut ni le lire ni le modifier.';

/* ── Scenarios ── */

type Scenario = 'off' | 'github' | 'connected' | 'pairing' | 'devices' | 'problems';
type Problem = 'unreachable' | 'denied' | 'replaced';
type Popup = 'code' | 'approved' | 'linked' | 'expired';
const SCENARIOS: readonly { id: Scenario; label: string }[] = [
  { id: 'off', label: '1 · Désactivé' }, { id: 'github', label: '2 · Connexion GitHub' }, { id: 'connected', label: '3 · Connecté, sans appareil' },
  { id: 'pairing', label: '4 · Demande de liaison' }, { id: 'devices', label: '5 · Appareils liés' }, { id: 'problems', label: '6 · Problèmes' }
];
const PROBLEMS: readonly { id: Problem; label: string }[] = [{ id: 'unreachable', label: 'a · Injoignable' }, { id: 'denied', label: 'b · Compte refusé' }, { id: 'replaced', label: 'c · Autre PC' }];
const POPUPS: readonly { id: Popup; label: string }[] = [{ id: 'code', label: 'Code' }, { id: 'approved', label: 'Approuvé' }, { id: 'linked', label: 'Lié' }, { id: 'expired', label: 'Expiré' }];

interface Device { id: string; label: string; kind: 'phone' | 'tablet'; online: boolean; seen?: string; linked: string }
const IPHONE: Device = { id: 'iphone', label: 'iPhone · Safari', kind: 'phone', online: true, linked: 'Lié le 19 oct. 2026' };
const IPAD: Device = { id: 'ipad', label: 'iPad · Safari', kind: 'tablet', online: false, seen: 'Vu il y a 3 j', linked: 'Lié le 2 oct. 2026' };
const PIXEL: Device = { id: 'pixel', label: 'Pixel · Chrome', kind: 'phone', online: true, linked: 'Lié le 19 oct. 2026' };
const devicesOf = (s: Scenario): Device[] =>
  s === 'devices' ? [IPHONE, IPAD]
  : s === 'off' ? [{ ...IPHONE, online: false, seen: 'Vu il y a 2 h' }, IPAD]
  : s === 'problems' ? [{ ...IPHONE, online: false, seen: 'Vu il y a 2 h' }]
  : [];

/* ── Small hooks ── */

/** Seconds left from `from`, ticking while `running`; `onEnd` once it reaches zero. */
function useCountdown(from: number, running: boolean, key: unknown, onEnd?: () => void): number {
  const [left, setLeft] = useState(from);
  const end = useRef(onEnd); end.current = onEnd;
  useEffect(() => { setLeft(from); }, [from, key]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setLeft(l => { if (l <= 1) { clearInterval(t); end.current?.(); return 0; } return l - 1; }), 1000);
    return () => clearInterval(t);
  }, [running, key]);
  return left;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/* ── The section ── */

type Account = 'flow' | 'signed' | 'none' | 'denied' | 'replaced';
type Link = 'online' | 'connecting' | 'offline' | 'idle' | 'off';

interface MobileState {
  scenario: Scenario; problem: Problem;
  on: boolean; account: Account; link: Link;
  devices: Device[]; pending: boolean; popup: Popup | null;
}

function initial(scenario: Scenario, problem: Problem): MobileState {
  const base = { scenario, problem, devices: devicesOf(scenario), pending: false, popup: null as Popup | null };
  if (scenario === 'off') return { ...base, on: false, account: 'signed', link: 'off' };
  if (scenario === 'github') return { ...base, on: true, account: 'flow', link: 'idle' };
  if (scenario === 'pairing') return { ...base, on: true, account: 'signed', link: 'online', pending: true, popup: 'code' };
  if (scenario === 'devices') return { ...base, on: true, account: 'signed', link: 'online', pending: true };
  if (scenario === 'problems') {
    if (problem === 'unreachable') return { ...base, on: true, account: 'signed', link: 'offline' };
    return { ...base, on: true, account: problem, link: 'offline' };
  }
  return { ...base, on: true, account: 'signed', link: 'online' };
}

function GitHubAccount({ st, set }: { st: MobileState; set(p: Partial<MobileState>): void }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const left = useCountdown(14 * 60, st.account === 'flow' && st.on, st.account);
  const signIn = () => set({ account: 'flow', link: 'idle' });
  const hint = 'Le compte qui relie ce PC et vos téléphones.';

  if (st.account === 'flow') return (
    <Row label="Compte GitHub" hint={hint} stack>
      <div className="device-flow">
        <span className="device-flow-lead">Saisissez ce code sur GitHub :</span>
        <output className="user-code mono" aria-label="Code à saisir sur GitHub : W D J B, M J H T">WDJB-MJHT</output>
        <div className="set-actions">
          <Button size="sm" variant="primary" onClick={() => setTimeout(() => set({ account: 'signed', link: 'connecting' }), 900)}>
            <Icon d={ICONS.external.d} size={14} />Ouvrir github.com/login/device
          </Button>
          <Button size="sm" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
            <Icon d={copied ? ICONS.check.d : COPY} size={14} />{copied ? 'Copié' : 'Copier le code'}
          </Button>
        </div>
        <div className="device-flow-wait">
          <span className="ledge-spin" aria-hidden="true"><Icon d={ICONS.refresh.d} size={13} /></span>
          <span role="status" aria-live="polite">En attente de la confirmation sur GitHub… · expire dans {Math.ceil(left / 60)} min</span>
          <span className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => set({ account: 'none', link: 'idle' })}>Annuler</Button>
        </div>
      </div>
    </Row>
  );
  if (st.account === 'none') return (
    <Row label="Compte GitHub" hint={hint}>
      <Button size="sm" variant="primary" onClick={signIn}>Se connecter avec GitHub</Button>
    </Row>
  );
  if (st.account === 'denied') return (
    <Row label="Compte GitHub" hint={hint} stack>
      <div role="alert" className="set-well bad">
        <Icon d={ICONS.close.d} size={14} />
        <span>Ce compte GitHub (<strong>@octocat</strong>) n'est pas autorisé sur ce serveur. Demandez à son administrateur de l'ajouter.</span>
      </div>
      <div className="set-actions"><Button size="sm" onClick={signIn}>Réessayer avec un autre compte</Button></div>
    </Row>
  );
  if (st.account === 'replaced') return (
    <Row label="Compte GitHub" hint={hint} stack>
      <div role="alert" className="set-well warn">
        <span>Ce PC a été déconnecté : un autre PC s'est connecté avec ce compte. Un compte n'a qu'un PC.</span>
        <div className="set-actions"><Button size="sm" variant="primary" onClick={signIn}>Se reconnecter</Button></div>
      </div>
    </Row>
  );
  return (
    <Row label="Compte GitHub" hint={hint}>
      <span className="gh-account"><span className="gh-avatar" aria-hidden="true">o</span><strong>@octocat</strong></span>
      <Button size="sm" variant="ghost" onClick={() => set({ account: 'none', link: 'idle', pending: false, popup: null })}>Se déconnecter</Button>
    </Row>
  );
}

function RelayStatus({ st, set }: { st: MobileState; set(p: Partial<MobileState>): void }): JSX.Element {
  const [round, setRound] = useState(0);
  const retrying = st.link === 'offline' && st.account === 'signed';
  const left = useCountdown(30, retrying, round, () => retry());
  function retry() { set({ link: 'connecting' }); setTimeout(() => { set({ link: 'offline' }); setRound(r => r + 1); }, 1400); }
  useEffect(() => {
    if (st.link !== 'connecting' || st.scenario === 'problems') return;
    const t = setTimeout(() => set({ link: 'online' }), 1200);
    return () => clearTimeout(t);
  }, [st.link, st.scenario]);

  const unreachable = st.scenario === 'problems' && st.account === 'signed';
  const status: { cls: string; text: string; detail?: string } =
    st.link === 'off' ? { cls: '', text: 'Désactivé' }
    : st.link === 'idle' ? { cls: '', text: 'Pas encore connecté', detail: st.account === 'flow' ? 'La connexion démarre une fois le compte GitHub confirmé.' : undefined }
    : st.link === 'online' ? { cls: 'online', text: 'Connecté au relais', detail: 'server.ledge.paradow.dev · depuis 09:14' }
    : st.link === 'connecting' ? { cls: 'connecting', text: 'Connexion…' }
    : st.account === 'denied' ? { cls: 'offline', text: 'Hors ligne', detail: 'Le serveur a refusé ce compte.' }
    : st.account === 'replaced' ? { cls: 'offline', text: 'Hors ligne', detail: 'Un autre PC a pris la place de celui-ci.' }
    : { cls: 'offline', text: `Hors ligne · nouvel essai dans ${left} s` };

  return (
    <Row label="État" hint={status.detail} stack={unreachable}>
      <div className="relay-status">
        <span className={`set-status ${status.cls}`} role="status"><i aria-hidden="true" />{status.text}</span>
        {unreachable && <Button size="sm" variant="outline" disabled={st.link === 'connecting'} onClick={retry}><Icon d={ICONS.refresh.d} size={14} />Réessayer</Button>}
      </div>
      {unreachable && (
        <div className="set-well bad">
          <Icon d={ICONS.close.d} size={14} />
          <span>Le serveur relais ne répond pas. Vérifiez l'adresse et votre connexion ; Ledge réessaie tout seul.<code className="raw-error">connect ECONNREFUSED 104.21.48.12:443</code></span>
        </div>
      )}
    </Row>
  );
}

function DeviceEntry({ d, confirming, onAsk, onCancel, onRevoke, off }: { d: Device; confirming: boolean; onAsk(): void; onCancel(): void; onRevoke(): void; off: boolean }): JSX.Element {
  const shown = d.online && !off ? 'online' : 'seen';
  return (
    <article className="machine-entry" aria-label={d.label}>
      <span className="machine-glyph" aria-hidden="true"><Icon d={d.kind === 'tablet' ? TABLET : PHONE} size={16} /></span>
      <div className="machine-main">
        <div className="machine-top">
          <strong>{d.label}</strong><span className="spacer" />
          <span className={`set-status ${shown === 'online' ? 'online' : ''}`}><i aria-hidden="true" />{shown === 'online' ? 'En ligne' : d.seen ?? 'Hors ligne'}</span>
        </div>
        <span className="set-hint">{d.linked}</span>
        {confirming ? (
          <div role="alert" className="set-well warn">
            <span>Révoquer <strong>{d.label}</strong> ? Il perd l'accès tout de suite et devra être lié à nouveau pour revenir.</span>
            <div className="set-actions">
              <Button size="sm" variant="primary" className="danger-btn" onClick={onRevoke}>Révoquer</Button>
              <Button size="sm" variant="ghost" autoFocus onClick={onCancel}>Annuler</Button>
            </div>
          </div>
        ) : (
          <div className="set-actions"><Button size="sm" variant="ghost" onClick={onAsk}>Révoquer</Button></div>
        )}
      </div>
    </article>
  );
}

function Devices({ st, set, onCompare }: { st: MobileState; set(p: Partial<MobileState>): void; onCompare(): void }): JSX.Element {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<string | null>(null);
  const off = !st.on;
  const showPending = st.pending && st.popup === null && st.on;
  const empty = st.devices.length === 0 && !showPending;
  return (
    <Card title="Appareils" hint="Un appareil lié peut tout faire : lire, approuver, répondre, écrire. Révoquez-le s'il est perdu.">
      {off && st.devices.length > 0 && <div role="status" className="set-well devices-off"><Icon d={SECTION_ICONS.mobile} size={14} /><span>L'accès mobile est désactivé : vos appareils liés ne peuvent pas se connecter.</span></div>}
      {revoked && <div role="status" className="set-well ok devices-off"><Icon d={ICONS.check.d} size={14} /><span><strong>{revoked}</strong> est révoqué.</span></div>}
      {showPending && (
        <article className="machine-entry pending-entry" aria-label="Pixel · Chrome demande l'accès">
          <span className="machine-glyph" aria-hidden="true"><Icon d={PHONE} size={16} /></span>
          <div className="machine-main">
            <div className="machine-top">
              <strong>Pixel · Chrome</strong><span className="pending-what">demande l'accès</span><span className="spacer" />
              <span className="set-tag warn">En attente</span>
            </div>
            <span className="set-hint">Connecté avec @octocat · il y a 1 min</span>
            <div className="set-actions"><Button size="sm" variant="primary" onClick={onCompare}>Comparer le code</Button></div>
          </div>
        </article>
      )}
      {st.devices.map(d => (
        <DeviceEntry key={d.id} d={d} off={off} confirming={confirming === d.id} onAsk={() => { setRevoked(null); setConfirming(d.id); }} onCancel={() => setConfirming(null)}
          onRevoke={() => { setConfirming(null); setRevoked(d.label); set({ devices: st.devices.filter(x => x.id !== d.id) }); }} />
      ))}
      {empty && (
        <div className="devices-empty">
          <span className="machine-glyph" aria-hidden="true"><Icon d={PHONE} size={16} /></span>
          <p><strong>Aucun appareil lié.</strong> Sur votre téléphone, ouvrez <code>server.ledge.paradow.dev</code> et connectez-vous avec le même compte GitHub. Un code s'affichera ici et sur le téléphone.</p>
        </div>
      )}
    </Card>
  );
}

/** « Lier un appareil »: the real Modal (shell/Modal.tsx), its title bar and close button, a code to compare. */
function PairDialog({ st, set }: { st: MobileState; set(p: Partial<MobileState>): void }): JSX.Element | null {
  const popup = st.popup;
  const left = useCountdown(272, popup === 'code' || popup === 'approved', popup === null ? 0 : 1, () => set({ popup: 'expired', pending: false }));
  const body = useId();
  useEffect(() => {
    if (popup !== 'approved') return;
    const t = setTimeout(() => link(), 2000);
    return () => clearTimeout(t);
  }, [popup]);
  if (!popup) return null;
  function link() { set({ popup: 'linked', pending: false, devices: [PIXEL, ...st.devices.filter(d => d.id !== 'pixel')] }); }
  const close = () => set({ popup: null });
  const refuse = () => set({ popup: null, pending: false });

  return (
    <Modal title="Lier un appareil" className="pair-modal" describedBy={body} onClose={close}>
      <div className="pair-content" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
        {(popup === 'code' || popup === 'approved') && <>
          <p id={body}>Un appareil connecté avec votre compte <strong>@octocat</strong> demande l'accès à vos agents.</p>
          <div className="pair-device"><span className="machine-glyph" aria-hidden="true"><Icon d={PHONE} size={16} /></span><strong>Pixel · Chrome</strong></div>
          <div className={popup === 'approved' ? 'pair-code dim' : 'pair-code'}>
            <span className="pair-code-label">Code de liaison</span>
            <output className="mono" aria-label="Code de liaison : 4 8 2, 9 1 3">482<span className="pair-gap" />913</output>
          </div>
        </>}
        {popup === 'code' && <>
          <p>Vérifiez que le téléphone affiche exactement ce code. Approuvez ici, puis confirmez sur le téléphone.</p>
          <p className="pair-warn">Si les codes diffèrent, refusez : quelqu'un d'autre tente de se lier.</p>
          <div className="pair-actions">
            <span className="set-hint pair-expiry">expire dans {mmss(left)}</span>
            <span className="spacer" />
            <Button autoFocus onClick={refuse}>Refuser</Button>
            <Button variant="primary" onClick={() => set({ popup: 'approved' })}>Approuver</Button>
          </div>
        </>}
        {popup === 'approved' && (
          <div className="set-well pair-wait" onClick={link} title="(maquette) cliquer pour simuler la confirmation du téléphone">
            <span className="ledge-spin" aria-hidden="true"><Icon d={ICONS.refresh.d} size={14} /></span>
            <span role="status" aria-live="polite"><strong>Approuvé sur ce PC.</strong> Confirmez maintenant sur le téléphone.</span>
          </div>
        )}
        {popup === 'linked' && <>
          <div role="status" className="set-well ok pair-result" id={body}><Icon d={ICONS.check.d} size={16} /><span><strong>Pixel · Chrome est lié.</strong> Il apparaît dans Réglages › Accès mobile › Appareils.</span></div>
          <div className="pair-actions"><span className="spacer" /><Button variant="primary" autoFocus onClick={close}>Fermer</Button></div>
        </>}
        {popup === 'expired' && <>
          <div role="alert" className="set-well bad pair-result" id={body}><Icon d={ICONS.close.d} size={16} /><span>La demande a expiré. Recommencez depuis le téléphone.</span></div>
          <div className="pair-actions"><span className="spacer" /><Button variant="primary" autoFocus onClick={close}>Fermer</Button></div>
        </>}
      </div>
    </Modal>
  );
}

function MobileAccess({ st, set }: { st: MobileState; set(p: Partial<MobileState>): void }): JSX.Element {
  const toggle = (on: boolean) => set(on ? { on: true, link: st.account === 'signed' ? 'connecting' : 'idle' } : { on: false, link: 'off', popup: null, pending: false });
  return <>
    <Card title="Connexion">
      <SwitchRow label="Accès mobile" hint="Ce PC garde une connexion sortante vers le serveur relais. Aucun port n'est ouvert." checked={st.on} onChange={toggle} />
      <fieldset className="set-fieldset" disabled={!st.on}>
        <Row label="Serveur relais" hint="L'adresse du serveur que vous et votre téléphone utilisez.">
          {describedBy => <input className="set-input mono relay-url" aria-label="Serveur relais" aria-describedby={describedBy} defaultValue="https://server.ledge.paradow.dev" spellCheck={false} />}
        </Row>
        <GitHubAccount st={st} set={set} />
        <RelayStatus st={st} set={set} />
      </fieldset>
    </Card>
    <Devices st={st} set={set} onCompare={() => set({ popup: 'code' })} />
  </>;
}

/* ── The window (TitleBar.tsx, TopBar.tsx's settings crumbs) and the mockup's controls ── */

function MockBar({ scenario, problem, popup, theme, onScenario, onProblem, onPopup, onTheme }: { scenario: Scenario; problem: Problem; popup: Popup | null; theme: 'dark' | 'light'; onScenario(s: Scenario): void; onProblem(p: Problem): void; onPopup(p: Popup): void; onTheme(): void }): JSX.Element {
  return (
    <div className="mock-bar" role="toolbar" aria-label="Contrôles de la maquette">
      <span className="mock-tag">Maquette</span>
      <div className="mock-group" role="radiogroup" aria-label="Scénario">
        {SCENARIOS.map(s => <button key={s.id} type="button" role="radio" aria-checked={scenario === s.id} onClick={() => onScenario(s.id)}>{s.label}</button>)}
      </div>
      {scenario === 'problems' && (
        <div className="mock-group sub" role="radiogroup" aria-label="Problème">
          {PROBLEMS.map(p => <button key={p.id} type="button" role="radio" aria-checked={problem === p.id} onClick={() => onProblem(p.id)}>{p.label}</button>)}
        </div>
      )}
      {scenario === 'pairing' && (
        <div className="mock-group sub" role="radiogroup" aria-label="État de la popup">
          {POPUPS.map(p => <button key={p.id} type="button" role="radio" aria-checked={popup === p.id} onClick={() => onPopup(p.id)}>{p.label}</button>)}
        </div>
      )}
      <span className="spacer" />
      <button type="button" className="mock-theme" onClick={onTheme}>{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</button>
    </div>
  );
}

function Window({ children, dialog }: { children: ReactNode; dialog: ReactNode }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="mock-window">
      <div className="titlebar" role="group" aria-label={t.titlebar.label}>
        <div className="titlebar-left"><span className="titlebar-mark" data-brand>Ledge<span className="brand-dot">.</span></span></div>
        <div className="titlebar-mid" />
        <div className="titlebar-right">
          <div className="titlebar-tools" inert={dialog ? true : undefined}>
            <button className="titlebar-ib" aria-label={t.titlebar.dnd} title={t.titlebar.dnd} aria-pressed={false}><Icon d={SECTION_ICONS.notifications} size={16} /></button>
            <button className="titlebar-ib" aria-label={t.side.chat} title={t.top.chat}><Icon d={SHELL_ICONS.chat} size={16} /></button>
          </div>
          <div className="titlebar-caps">
            <button aria-label={t.titlebar.minimize}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg></button>
            <button aria-label={t.titlebar.maximize}><svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" rx="1" /></svg></button>
            <button className="close" aria-label={t.titlebar.close}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5l9 9M9.5.5l-9 9" /></svg></button>
          </div>
        </div>
      </div>
      <div className="application" inert={dialog ? true : undefined}>
        <section className="workspace">{children}</section>
      </div>
      {dialog}
    </div>
  );
}

function App(): JSX.Element {
  const { t } = useI18n();
  const s = t.settings;
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [section, setSection] = useState<Section>('mobile');
  const [st, setSt] = useState<MobileState>(() => initial('pairing', 'unreachable'));
  const [epoch, setEpoch] = useState(0);
  const titleId = useId();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const set = (p: Partial<MobileState>) => setSt(prev => ({ ...prev, ...p }));
  const go = (scenario: Scenario, problem = st.problem) => { setSt(initial(scenario, problem)); setSection('mobile'); setEpoch(e => e + 1); };
  const title = section === 'mobile' ? MOBILE_TITLE : t.sections[section];
  const hint = section === 'mobile' ? MOBILE_HINT : s.hints[section];

  return <>
    <MockBar scenario={st.scenario} problem={st.problem} popup={st.popup} theme={theme} onScenario={sc => go(sc)} onProblem={p => go('problems', p)}
      onPopup={p => { set({ popup: p, pending: p === 'code' || p === 'approved', devices: p === 'linked' ? [PIXEL] : [] }); setSection('mobile'); }} onTheme={() => setTheme(th => (th === 'dark' ? 'light' : 'dark'))} />
    <Window dialog={st.on ? <PairDialog key={epoch} st={st} set={set} /> : null}>
      <header className="app-header">
        <div className="breadcrumb">
          <Icon d={SHELL_ICONS.gear} size={14} />
          <button className="crumb-link" onClick={() => setSection('general')}>{t.crumb.settings}</button>
          <span className="muted">/</span>
          <strong>{title}</strong>
        </div>
      </header>
      <div className="settings-page">
        <nav className="settings-nav" aria-label={s.nav}>
          <Button variant="ghost" size="sm" className="settings-back"><Icon d={ICONS.chevronLeft.d} size={14} />{s.back}<Kbd>{t.crumb.escape}</Kbd></Button>
          {ORDER.map(id => (
            <button key={id} type="button" className={id === section ? 'settings-tab active' : 'settings-tab'} aria-current={id === section ? 'page' : undefined} onClick={() => setSection(id)}>
              <Icon d={SECTION_ICONS[id]} size={15} /><span>{id === 'mobile' ? MOBILE_TITLE : t.sections[id]}</span>
              {id === 'mobile' && st.on && st.link === 'offline' && <b className="side-alert" role="img" aria-label="L'accès mobile est hors ligne" />}
              {id === 'mobile' && st.pending && st.popup === null && st.on && <b className="side-alert mob-ask" role="img" aria-label="Un appareil demande l'accès" />}
            </button>
          ))}
        </nav>
        <div className="settings-scroll">
          <section className="settings-content" key={section} aria-labelledby={titleId}>
            <header className="settings-head" role="none"><h1 id={titleId}>{title}</h1><p>{hint}</p></header>
            {section === 'mobile'
              ? <MobileAccess key={epoch} st={st} set={set} />
              : <Card><div className="set-row"><span className="set-hint">Cette section n'est pas dessinée dans la maquette. Revenez à <button className="crumb-link inline-link" onClick={() => setSection('mobile')}>{MOBILE_TITLE}</button>.</span></div></Card>}
          </section>
        </div>
      </div>
    </Window>
    <p className="mock-caption">
      {st.scenario === 'pairing'
        ? 'La popup s’ouvre sur n’importe quel écran de Ledge Desktop, et une notification Windows « Un appareil demande l’accès » s’affiche si l’app est en arrière-plan.'
        : 'Maquette · Réglages › Accès mobile. La barre latérale des sessions est masquée pour se concentrer sur la section.'}
    </p>
  </>;
}

void loadMessages('fr').then(() => {
  createRoot(document.getElementById('root')!).render(<LangProvider lang="fr"><App /></LangProvider>);
});
