import { useEffect, useRef, useState, type JSX } from 'react';
import { DEVICE_NAME_MAX, RelayUrlSchema, type MobileClientMessage, type MobileState } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { spanOf } from '../list/time';
import { openUrl } from '../tauri/bridge';
import { Card, Row, SwitchRow } from './controls';
import { useEscapeLayer } from './escape';
import { deviceGlyph, PHONE } from './PairingDialog';
import { requestPairingDialog, usePairingDialogOpen } from './pairingRequest';
import { clearDeviceViewRequest, deviceWord, useDeviceViewRequest } from './recovery';
import type { SettingsContext } from './SettingsPage';

export { PHONE };
const COPY = ['M9 9h11v11H9z', 'M5 15H4V4h11v1'];
/** The mockup's key (a passkey recovery) and padlock (recovery blocked), drawn with paths for Icon. */
const KEY = ['M7.5 10a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11', 'm21 2-9.6 9.6', 'M15.5 7.5l3 3L22 7l-3-3'];
const LOCK = ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'];

type Send = (msg: MobileClientMessage) => boolean;

/** The relay as the user reads it: its host (app.kl-ledge.dev). */
const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };

/** Date.now(), refreshed every `every` ms while it is not null. */
function useNow(every: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (every === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

/** The mockup's link problems in the nav: the access is on but cannot reach the relay (offline, signed out, account refused). */
export const mobileDown = (m: MobileState | undefined): boolean =>
  m !== undefined && m.enabled && (m.link.state === 'offline' || m.link.state === 'signed_out' || (m.link.state === 'off' && (m.signinError === 'not_allowed' || m.signinError === 'failed')));
/** A device waits for its code to be compared, and the « Link a device » dialog is not showing it (the mockup's `showPending`). */
export const mobileAsks = (m: MobileState | undefined, dialogOpen = false): boolean => !dialogOpen && m !== undefined && m.enabled && m.pairings.some(p => p.state === 'confirm');

/** Settings › Mobile access (docs/mockups/mobile-access, the validated mockup): the local daemon's relay, its GitHub account and the
 *  link's state, then the approved devices and the pairings waiting for their code. Every change is a command to the daemon
 *  (`sendMobile`); what it shows is the daemon's broadcast. A daemon that never spoke of mobile access gets one card. */
export function Mobile({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.mobile;
  const { mobile: m, mobileError, machines, fleet, notify } = ctx;
  const localUp = machines.find(x => x.id === 'local')?.ready === true;
  if (m === undefined) return <Card><div role="status" className="set-well"><span>{localUp ? c.outdated : t.offline}</span></div></Card>;
  // The refusal of the last command, under the header: the daemon's own words, as the phone's errors are.
  const refusal = mobileError && <div role="alert" className="set-well bad"><Icon d={ICONS.close.d} size={14} /><span>{mobileError.message}</span></div>;
  // The service did not start on this PC: nothing below can work until the daemon restarts.
  if (m.link.state === 'unavailable') return <>{refusal}<Card><div role="status" className="set-well bad"><span>{c.unavailable(m.link.error)}</span></div></Card></>;

  const send: Send = msg => {
    try { fleet.sendMobile(msg); return true; } catch (e) {
      notify((e as Error).name === 'DaemonOutdated' ? c.refused.outdated : c.refused.offline);
      return false;
    }
  };
  return (
    <>
      {refusal}
      <Card title={c.connection}>
        {!localUp && <div role="status" className="set-well"><span>{t.offline}</span></div>}
        <SwitchRow label={c.access} hint={c.accessHint} checked={m.enabled} onChange={on => send({ type: 'mobile.set', enabled: on, relayUrl: m.relayUrl })} />
        {/* A daemon without the phone's terminal says nothing of it: no switch. */}
        {m.terminalInput !== undefined && <SwitchRow label={c.terminalInput} hint={c.terminalInputHint} checked={m.terminalInput} onChange={on => send({ type: 'mobile.terminal', input: on })} />}
        <fieldset className="set-fieldset" disabled={!m.enabled}>
          <RelayField key={m.relayUrl} m={m} send={send} />
          <GitHubAccount m={m} send={send} />
          <RelayStatus m={m} send={send} />
        </fieldset>
      </Card>
      <Devices m={m} send={send} />
    </>
  );
}

/** « Serveur relais »: checked with RelayUrlSchema on blur or Enter; a refused address is said under the field, a new one is sent
 *  as its origin. Remounted (and so reset) whenever the daemon's address changes. */
function RelayField({ m, send }: { m: MobileState; send: Send }): JSX.Element {
  const c = useI18n().t.settings.mobile;
  const [error, setError] = useState<string | null>(null);
  const last = useRef(m.relayUrl);
  const commit = (raw: string) => {
    const v = raw.trim();
    if (v === last.current) return;
    last.current = v;
    const r = RelayUrlSchema.safeParse(v);
    if (!r.success) { setError(c.relayInvalid); return; }
    setError(null);
    if (r.data !== m.relayUrl && !send({ type: 'mobile.set', enabled: m.enabled, relayUrl: r.data })) last.current = m.relayUrl;
  };
  return (
    <Row label={c.relay} hint={c.relayHint} error={error}>
      {describedBy => (
        <input className="set-input relay-url" aria-label={c.relay} aria-describedby={describedBy} aria-invalid={error !== null} defaultValue={m.relayUrl} spellCheck={false}
          onBlur={e => commit(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') commit(e.currentTarget.value); }} />
      )}
    </Row>
  );
}

/** « Compte GitHub »: the device flow while a sign-in runs, a refused account, a PC the relay signed out, the account, or the way in. */
function GitHubAccount({ m, send }: { m: MobileState; send: Send }): JSX.Element {
  const c = useI18n().t.settings.mobile;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  const now = useNow(m.signin ? 15_000 : null);
  const signIn = () => send({ type: 'mobile.signin' });

  if (m.signin) {
    const { userCode, verificationUri, expiresAt } = m.signin;
    const min = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
    const where = verificationUri.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const spelled = userCode.split('-').map(part => [...part].join(' ')).join(', ');
    const copy = () => { void navigator.clipboard?.writeText(userCode).then(() => setCopied(true), () => {}); };
    return (
      <Row label={c.account} hint={c.accountHint} stack>
        <div className="device-flow">
          <span className="device-flow-lead">{c.codeLead}</span>
          <output className="user-code" aria-label={c.codeLabel(spelled)}>{userCode}</output>
          <div className="set-actions">
            <Button size="sm" variant="primary" onClick={() => openUrl(verificationUri)}><Icon d={ICONS.external.d} size={14} />{c.open(where)}</Button>
            <Button size="sm" onClick={copy}><Icon d={copied ? ICONS.check.d : COPY} size={14} />{copied ? c.copied : c.copy}</Button>
          </div>
          <div className="device-flow-wait">
            <span className="ledge-spin" aria-hidden="true"><Icon d={ICONS.refresh.d} size={13} /></span>
            <span role="status" aria-live="polite">{c.waiting(min)}</span>
            <span className="spacer" />
            <Button size="sm" variant="ghost" onClick={() => send({ type: 'mobile.signin.cancel' })}>{c.cancel}</Button>
          </div>
        </div>
      </Row>
    );
  }
  if (m.signinError === 'not_allowed') return (
    <Row label={c.account} hint={c.accountHint} stack>
      <div role="alert" className="set-well bad"><Icon d={ICONS.close.d} size={14} /><span>{c.notAllowed}</span></div>
      <div className="set-actions"><Button size="sm" onClick={signIn}>{c.otherAccount}</Button></div>
    </Row>
  );
  if (m.link.state === 'signed_out') return (
    <Row label={c.account} hint={c.accountHint} stack>
      <div role="alert" className="set-well warn">
        <span>{c.signedOut[m.link.reason]}</span>
        <div className="set-actions"><Button size="sm" variant="primary" onClick={signIn}>{c.reconnect}</Button></div>
      </div>
    </Row>
  );
  if (m.account) return (
    <Row label={c.account} hint={c.accountHint}>
      <span className="gh-account"><span className="gh-avatar" aria-hidden="true">{m.account.login.slice(0, 1)}</span><strong>@{m.account.login}</strong></span>
      <Button size="sm" variant="ghost" onClick={() => send({ type: 'mobile.signout' })}>{c.signout}</Button>
    </Row>
  );
  // A sign-in that ended without a session (not_allowed has its own row above): why, then the way in again.
  const ended = m.signinError === null ? null : c.signinEnded[m.signinError];
  if (ended) return (
    <Row label={c.account} hint={c.accountHint} stack>
      <div role="alert" className="set-well bad"><Icon d={ICONS.close.d} size={14} /><span>{ended}</span></div>
      <div className="set-actions"><Button size="sm" variant="primary" onClick={signIn}>{c.signin}</Button></div>
    </Row>
  );
  return (
    <Row label={c.account} hint={c.accountHint}>
      <Button size="sm" variant="primary" onClick={signIn}>{c.signin}</Button>
    </Row>
  );
}

/** « État »: the link as the daemon reports it; offline, the countdown to its next try, « Réessayer » and the raw error. */
function RelayStatus({ m, send }: { m: MobileState; send: Send }): JSX.Element {
  const c = useI18n().t.settings.mobile;
  const link = m.link;
  const offline = m.enabled && link.state === 'offline';
  const now = useNow(offline ? 1000 : null);
  const status: { cls: string; text: string; detail?: string } =
    !m.enabled ? { cls: '', text: c.states.off }
    : link.state === 'online' ? { cls: 'online', text: c.states.online, detail: hostOf(m.relayUrl) }
    : link.state === 'connecting' ? { cls: 'connecting', text: c.states.connecting }
    : link.state === 'offline' ? { cls: 'offline', text: c.retryIn(Math.max(0, Math.ceil((Date.parse(link.retryAt) - now) / 1000))) }
    : link.state === 'signed_out' ? { cls: 'offline', text: c.states.offline, detail: c.outHint[link.reason] }
    : m.signinError === 'not_allowed' ? { cls: 'offline', text: c.states.offline, detail: c.refusedHint }
    : { cls: '', text: c.states.idle, ...(m.signin ? { detail: c.idleHint } : {}) };
  return (
    <Row label={c.status} hint={status.detail} stack={offline}>
      <div className="relay-status">
        <span className={`set-status ${status.cls}`} role="status"><i aria-hidden="true" />{status.text}</span>
        {offline && <Button size="sm" variant="outline" onClick={() => send({ type: 'mobile.retry' })}><Icon d={ICONS.refresh.d} size={14} />{c.retry}</Button>}
      </div>
      {offline && (
        <div className="set-well bad">
          <Icon d={ICONS.close.d} size={14} />
          <span>{c.unreachable}<code className="raw-error">{link.error}</code></span>
        </div>
      )}
    </Row>
  );
}

/** « Appareils »: the pairings waiting for their code (« Comparer le code » asks for the dialog), then the approved devices, each
 *  revoked after an inline confirmation (Escape cancels it). */
function Devices({ m, send }: { m: MobileState; send: Send }): JSX.Element {
  const { t, lang } = useI18n();
  const c = t.settings.mobile;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<string | null>(null);
  // The device being renamed and its draft (docs/mockups/mobile-multi-device.html, part 4).
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const now = useNow(60_000);
  useEscapeLayer(() => {
    if (renaming !== null) { setRenaming(null); return true; }
    if (confirming === null) return false; setConfirming(null); return true;
  });
  // While the dialog is on screen, its pairing (and the others waiting behind it) leave the list, as in the mockup.
  const dialogOpen = usePairingDialogOpen();
  const asking = m.enabled && !dialogOpen ? m.pairings.filter(p => p.state === 'confirm') : [];
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  // A recovery's moment as the mockup says it: the time alone today, else the day (and its year, when not this one).
  const moment = (iso: string): { today: boolean; time: string; date: string } | null => {
    const at = new Date(iso), today = new Date(now);
    if (Number.isNaN(at.getTime())) return null;
    const sameYear = at.getFullYear() === today.getFullYear();
    const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
    return { today: at.toDateString() === today.toDateString(), time: time.format(at), date: day.format(at) };
  };
  // « Voir » on a recovery toast: the device's row is brought into view, after the page's own scroll back to the top.
  const want = useDeviceViewRequest();
  const rows = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!want) return;
    const row = rows.current.get(want.id);
    if (!row) return;
    const timer = setTimeout(() => { clearDeviceViewRequest(); row.scrollIntoView?.({ block: 'center' }); }, 0);
    return () => clearTimeout(timer);
  }, [want, m.devices]);
  const blocked = m.recovery?.blocked;
  const blockedAt = blocked ? moment(blocked.since) : null;
  const seen = (iso: string | undefined) => {
    if (!iso) return c.offline;
    const span = spanOf(now - (Date.parse(iso) || 0));
    return span === 'now' ? c.seenNow : c.seenAgo(`${span.n} ${t.list.when.units[span.unit]}`);
  };
  const rename = () => {
    if (!renaming) return;
    const name = renaming.draft.trim();
    if (!name || name.length > DEVICE_NAME_MAX) return;
    if (send({ type: 'mobile.device.rename', id: renaming.id, name })) setRenaming(null);
  };
  const revoke = (id: string, label: string) => {
    if (!send({ type: 'mobile.device.revoke', id })) return;
    setConfirming(null);
    setRevoked(label);
  };

  return (
    <Card title={c.devices} hint={c.devicesHint}>
      {!m.enabled && m.devices.length > 0 && <div role="status" className="set-well devices-off"><Icon d={PHONE} size={14} /><span>{c.devicesOff}</span></div>}
      {revoked && <div role="status" className="set-well ok devices-off"><Icon d={ICONS.check.d} size={14} /><span><strong>{revoked}</strong>{c.revoked}</span></div>}
      {blocked && (
        <div role="alert" className="set-well warn recovery-well recovery-blocked">
          <Icon d={LOCK} size={14} />
          <span>{c.recoverBlocked.well(blocked.failures, blockedAt === null ? blocked.since : blockedAt.today ? c.when.since(blockedAt.time) : c.when.sinceOn(blockedAt.date, blockedAt.time))}</span>
          <div className="set-actions"><Button size="sm" variant="outline" onClick={() => send({ type: 'mobile.recovery.unblock' })}>{c.recoverBlocked.unblock}</Button></div>
        </div>
      )}
      {asking.map(p => (
        <article key={p.id} className="machine-entry pending-entry" aria-label={c.asksLabel(p.label)}>
          <span className="machine-glyph" aria-hidden="true"><Icon d={PHONE} size={16} /></span>
          <div className="machine-main">
            <div className="machine-top">
              <strong>{p.label}</strong><span className="pending-what">{c.asks}</span><span className="spacer" />
              <span className="set-tag warn">{c.waitingTag}</span>
            </div>
            {m.account && <span className="set-hint">{c.via(m.account.login)}</span>}
            <div className="set-actions"><Button size="sm" variant="primary" onClick={() => requestPairingDialog(p.id)}>{c.compare}</Button></div>
          </div>
        </article>
      ))}
      {m.devices.map(d => {
        const online = d.online && m.enabled;
        const name = d.name ?? d.label;
        // A name the user gave hides the model: it comes back on the line under it.
        const at = Date.parse(d.approvedAt);
        const on = Number.isNaN(at) ? null : d.name ? c.linkedOnAs(d.label, date.format(at)) : c.linkedOn(date.format(at));
        // The passkey recovery: its trace stays on the line under the name, its well until « C'était bien moi » (P10); a refused
        // attempt keeps its well until « Compris ».
        const word = deviceWord(d)!;
        const back = d.recovered ? moment(d.recovered.at) : null;
        const trace = back && c.recovered.hint(back.today ? c.when.today(back.time) : c.when.on(back.date));
        const pending = d.recovered?.pending === true;
        const tried = d.refused ? moment(d.refused.at) : null;
        const askRevoke = () => { setRevoked(null); setRenaming(null); setConfirming(d.id); };
        return (
          <article key={d.id} className="machine-entry" aria-label={name} ref={el => { if (el) rows.current.set(d.id, el); else rows.current.delete(d.id); }}>
            <span className="machine-glyph" aria-hidden="true"><Icon d={deviceGlyph(d.kind)} size={16} /></span>
            <div className="machine-main">
              <div className="machine-top">
                <strong>{name}</strong>
                {pending && <span className="set-tag info">{c.recovered.tag}</span>}
                {d.refused && <span className="set-tag warn">{c.recoverRefused.tag}</span>}
                <span className="spacer" />
                <span className={online ? 'set-status online' : 'set-status'}><i aria-hidden="true" />{online ? c.online : seen(d.lastSeenAt)}</span>
              </div>
              {on && <span className="set-hint">{on}{trace}</span>}
              {confirming === d.id ? (
                <div role="alert" className="set-well warn">
                  <span>{c.revokeAsk.before}<strong>{name}</strong>{c.revokeAsk.after}</span>
                  <div className="set-actions">
                    <Button size="sm" variant="primary" className="danger-btn" onClick={() => revoke(d.id, name)}>{c.revoke}</Button>
                    <Button size="sm" variant="ghost" autoFocus onClick={() => setConfirming(null)}>{c.cancel}</Button>
                  </div>
                </div>
              ) : renaming?.id === d.id ? (
                <form className="set-actions device-rename" onSubmit={e => { e.preventDefault(); rename(); }}>
                  <input
                    className="set-input" aria-label={c.nameLabel} value={renaming.draft} maxLength={DEVICE_NAME_MAX} autoFocus
                    onChange={e => setRenaming({ id: d.id, draft: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(null); } }}
                  />
                  <Button size="sm" variant="primary" type="submit" disabled={!renaming.draft.trim()}>{c.save}</Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>{c.cancel}</Button>
                </form>
              ) : pending || d.refused ? (
                <>
                  {pending && (
                    <div className="set-well info recovery-well">
                      <Icon d={KEY} size={14} /><span>{c.recovered.well(word)}</span>
                      <div className="set-actions">
                        <Button size="sm" variant="outline" onClick={() => send({ type: 'mobile.device.ack', id: d.id, what: 'recovered' })}>{c.recovered.ack}</Button>
                        <Button size="sm" variant="ghost" onClick={askRevoke}>{c.revoke}</Button>
                      </div>
                    </div>
                  )}
                  {d.refused && (
                    <div className="set-well warn recovery-well">
                      <Icon d={ICONS.warning.d} size={14} />
                      <span>{c.recoverRefused.well(tried === null ? c.when.at(d.refused.at) : tried.today ? c.when.at(tried.time) : c.when.atOn(tried.date, tried.time), word)}</span>
                      <div className="set-actions">
                        <Button size="sm" variant="outline" onClick={() => send({ type: 'mobile.device.ack', id: d.id, what: 'refused' })}>{c.recoverRefused.ack}</Button>
                        <Button size="sm" variant="ghost" onClick={askRevoke}>{c.revoke}</Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="set-actions">
                  <Button size="sm" variant="ghost" aria-label={c.renameLabel(name)} onClick={() => { setConfirming(null); setRenaming({ id: d.id, draft: name }); }}>{c.rename}</Button>
                  <Button size="sm" variant="ghost" onClick={askRevoke}>{c.revoke}</Button>
                </div>
              )}
            </div>
          </article>
        );
      })}
      {m.devices.length === 0 && asking.length === 0 && (
        <div className="devices-empty">
          <span className="machine-glyph" aria-hidden="true"><Icon d={PHONE} size={16} /></span>
          <p><strong>{c.emptyTitle}</strong>{c.emptyBefore}<code>{hostOf(m.relayUrl)}</code>{c.emptyAfter}</p>
        </div>
      )}
    </Card>
  );
}
