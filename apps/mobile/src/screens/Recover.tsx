// The app without a key: the choice between its passkey and a code, then the passkey's way back and each way it can stop
// (docs/mockups/ledge-mobile-passkey/passkey-reinstall.html, sections 1 to 3).
import type { ReactNode } from 'react';
import { copy, locale, type Model } from '../copy';
import { deviceLabel } from '../link/label';
import type { Reach } from '../link/link';
import type { RecoveryState } from '../link/recover';
import { href } from '../router';
import { Board, Fill, H1, OUTLINE, PRIMARY, Spinner } from '../ui/Board';
import { Icon, type IconName } from '../ui/icons';
import { Mascot } from '../ui/MobileBot';
import { Account } from './Compare';
import { isApple } from './device';

const R = copy.recover;
const N = copy.recover.no;

/** An iPhone or an iPad, as the screens name this device; anything else is « cet appareil ». */
export function modelOf(): Model {
  const label = deviceLabel(globalThis.navigator?.userAgent ?? '', globalThis.navigator?.maxTouchPoints ?? 0);
  return label === 'iPhone' || label === 'iPad' ? label : null;
}

const NOTE_ICONS: readonly IconName[] = ['key', 'shield', 'laptop'];

/** Screen 1 a: « Se reconnecter avec ma passkey » first, « Appairer avec un code » after; the code alone, without the notes, on a device that cannot verify its user (P4). */
export function Choose({ login, platform, onPasskey, onCode }: { login: string | null; platform: boolean; onPasskey: () => void; onCode: () => void }) {
  const model = modelOf();
  return (
    <Board>
      <Account login={login} />
      <div className="flex flex-col items-center gap-3 text-center">
        <Mascot size={72} />
        <h1 className={H1}>{R.title(model)}</h1>
        <p className="max-w-[320px] text-muted">{R.lead}</p>
      </div>
      {platform && (
        <ul className="flex flex-col gap-3 text-body leading-5 text-fg/85">
          {R.notes(modelOf()).map((n, i) => <li key={i} className="flex items-start gap-3"><Icon name={NOTE_ICONS[i]!} className="size-5 text-muted" />{n}</li>)}
        </ul>
      )}
      <Fill />
      <div className="flex flex-col gap-3">
        {platform && <button type="button" onClick={onPasskey} className={PRIMARY}><Icon name="face" />{R.go}</button>}
        <button type="button" onClick={onCode} className={platform ? OUTLINE : PRIMARY}>{R.code}</button>
      </div>
    </Board>
  );
}

const TONES = { warn: 'bg-attention/12 text-attention', bad: 'bg-danger-bg text-danger-fg' } as const;
function Glyph({ icon, tone }: { icon: IconName; tone: keyof typeof TONES }) {
  return <span aria-hidden="true" className={`inline-flex size-12 flex-none items-center justify-center rounded-full ${TONES[tone]}`}><Icon name={icon} className="size-6" /></span>;
}

/** A failure's board: its glyph, title and sentence, what to know, and its actions at the bottom. Announced (role alert). */
function Failed({ login, icon, tone, title, body, centred = false, children, actions }: {
  login: string | null; icon: IconName; tone: keyof typeof TONES; title: string; body: string; centred?: boolean; children?: ReactNode; actions: ReactNode;
}) {
  return (
    <Board>
      <Account login={login} />
      <div role="alert" className={`flex flex-col gap-3 ${centred ? 'items-center text-center' : 'items-start'}`}>
        <Glyph icon={icon} tone={tone} />
        <h1 className={H1}>{title}</h1>
        <p className="text-muted">{body}</p>
      </div>
      {children && <div className="flex flex-col gap-2.5 text-body leading-[1.5] text-muted">{children}</div>}
      <Fill />
      <div className="flex flex-col gap-3">{actions}</div>
    </Board>
  );
}

/** A paragraph of the boards' « why »: its lead in the text's colour, the rest muted. */
const Why = ({ lead, children }: { lead?: string; children: ReactNode }) => <p>{lead && <strong className="font-semibold text-fg">{lead}</strong>}{lead && ' '}{children}</p>;

/** « 3 nov. », the day the device was revoked; null when it cannot be read. */
const dayOf = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
};

export interface RecoverProps {
  state: RecoveryState;
  login: string | null;
  /** Where the PC is: a relay out of reach says so on screen 2 d. */
  reach: Reach;
  /** « Réessayer »: the same offer when it still lives (screen 2 a), else a new recovery. */
  onRetry: () => void;
  onCode: () => void;
  onCancel: () => void;
  onSignOut: () => void;
  /** « Voir ce qui attend », once back. */
  onDone: () => void;
  /** What leads out of screen 1 d: the notifications step when it is worth showing. */
  actions?: ReactNode;
}

/** Screens 1 c, 1 d and 2 a to 2 i: the recovery as it goes, back, or stopped. */
export function Recover({ state, login, reach, onRetry, onCode, onCancel, onSignOut, onDone, actions }: RecoverProps) {
  const model = modelOf();
  const code = (primary = true) => <button key="code" type="button" onClick={onCode} className={primary ? PRIMARY : OUTLINE}>{R.code}</button>;
  const retry = (primary = false) => <button key="retry" type="button" onClick={onRetry} className={primary ? PRIMARY : OUTLINE}>{R.retry}</button>;

  if (state.step === 'reaching' || state.step === 'faceid' || state.step === 'checking') {
    const pc = (state.step === 'reaching' ? null : state.pcName) ?? copy.yourPc;
    const steps: Array<[string, 'done' | 'on' | 'next']> = [
      [state.step === 'reaching' ? R.checking.reaching(pc) : R.checking.reached(pc), state.step === 'reaching' ? 'on' : 'done'],
      [isApple() ? R.checking.faceId : R.checking.check, state.step === 'faceid' ? 'on' : state.step === 'checking' ? 'done' : 'next'],
      [R.checking.verifying(pc), state.step === 'checking' ? 'on' : 'next']
    ];
    return (
      <Board top="pt-40">
        <Account login={login} />
        <div role="status" className="flex flex-col items-center gap-3 text-center">
          <Spinner />
          <h1 className={H1}>{R.checking.title}</h1>
          <p className="max-w-[320px] text-muted">{R.checking.body(pc)}</p>
        </div>
        <ol className="flex flex-col gap-2.5 rounded-[10px] border border-line px-4 py-3.5 text-body">
          {steps.map(([text, st]) => (
            <li key={text} className={`flex items-center gap-2.5 ${st === 'on' ? 'font-medium text-fg' : 'text-muted'}`}>
              {st === 'done' ? <Icon name="check" className="size-[18px] text-ok" /> : st === 'on' ? <Spinner size="size-[18px]" /> : <span className="size-[18px]" aria-hidden="true" />}
              {text}
            </li>
          ))}
        </ol>
        <Fill />
        <button type="button" onClick={onCancel} className={OUTLINE}>{R.cancel}</button>
      </Board>
    );
  }

  if (state.step === 'done') {
    const pc = state.pc.name ?? copy.yourPc;
    return (
      <Board top="pt-14">
        <div className="flex flex-col items-center gap-3 text-center">
          <Mascot size={88} />
          <h1 className={H1}>{R.done.title(model, pc)}</h1>
          <p className="max-w-[320px] text-muted">{R.done.body(pc)}</p>
        </div>
        <p role="status" className="flex items-center gap-2 self-center text-small text-ok"><Icon name="check" className="size-4" />{R.done.told(pc)}</p>
        <Fill />
        {actions ?? <a href={href({ name: 'atoi' })} onClick={onDone} className={PRIMARY}>{copy.compare.seePending}</a>}
      </Board>
    );
  }

  if (state.step === 'cancelled') return null;

  const pc = state.pcName ?? copy.yourPc;
  switch (state.why) {
    case 'none':
      return (
        <Failed login={login} icon="key" tone="warn" title={N.none.title} body={N.none.body(pc)} actions={[retry(true), code(false)]}>
          <Why lead={N.none.hintTitle}>{N.none.hint}</Why>
        </Failed>
      );
    case 'revoked':
      return (
        <Failed login={login} icon="unlink" tone="bad" title={N.revoked.title(model)} body={N.revoked.body(pc, dayOf(state.revokedAt))} actions={[code()]}>
          <p>{N.revoked.hint}</p>
        </Failed>
      );
    case 'old':
      return (
        <Failed login={login} icon="key" tone="warn" title={N.old.title} body={N.old.body} actions={[code()]}>
          <Why lead={N.old.hintTitle}>{N.old.hint(model)}</Why>
        </Failed>
      );
    case 'offline': {
      // A relay out of reach is Compare's words too (`relayTitle`).
      const [title, body] = reach === 'relay_unreachable' ? [copy.compare.relayTitle, copy.compare.relayBody] : [N.offline.title(pc), N.offline.body(pc)];
      return <Failed login={login} icon="wifioff" tone="warn" centred title={title} body={body} actions={[retry(true), <button key="cancel" type="button" onClick={onCancel} className={OUTLINE}>{R.cancel}</button>]} />;
    }
    case 'otherPc': {
      const [mine, theirs] = state.tags ?? ['', ''];
      return (
        <Failed login={login} icon="shield" tone="bad" title={N.otherPc.title(pc)} body={N.otherPc.body}
          actions={[code(), <button key="out" type="button" onClick={onSignOut} className={OUTLINE}>{N.otherPc.signOut}</button>]}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 rounded-control border border-line bg-surface p-4 text-body text-fg">
            <dt className="text-muted">{N.otherPc.inPasskey}</dt>
            <dd className="font-mono">{mine} · {N.otherPc.expected}</dd>
            <dt className="text-muted">{N.otherPc.received}</dt>
            <dd className="font-mono text-danger-fg">{theirs} · {N.otherPc.unknown}</dd>
          </dl>
          <Why lead={N.otherPc.reinstalledTitle}>{N.otherPc.reinstalledBody}</Why>
          <Why lead={N.otherPc.otherwise}>{N.otherPc.warning}</Why>
        </Failed>
      );
    }
    case 'connected':
      return (
        <Failed login={login} icon={state.device === 'iPhone' ? 'phone' : 'tablet'} tone="warn" title={N.connected.title(state.device)} body={N.connected.body(pc)} actions={[code(), retry()]}>
          <Why lead={N.connected.otherTitle(state.device)}>{N.connected.other}</Why>
          <Why lead={N.connected.reinstalledTitle(state.device)}>{N.connected.reinstalled(state.device)}</Why>
        </Failed>
      );
    case 'rate': {
      const min = state.retryInMs !== undefined ? Math.max(1, Math.ceil(state.retryInMs / 60_000)) : null;
      return (
        <Failed login={login} icon="clock" tone="warn" title={N.rate.title} body={N.rate.body(pc, min)}
          actions={[code(), ...(min !== null ? [<button key="wait" type="button" disabled className={OUTLINE}>{N.rate.retryIn(min)}</button>] : [])]} />
      );
    }
    case 'blocked':
      return (
        <Failed login={login} icon="lock" tone="bad" title={N.blocked.title(pc)} body={N.blocked.body(pc)} actions={[code()]}>
          <p>{N.blocked.hintBefore(pc)}<strong className="font-semibold text-fg">{N.blocked.unblock}</strong>{N.blocked.hintAfter}</p>
        </Failed>
      );
    case 'timeout':
      return <Failed login={login} icon="clock" tone="warn" centred title={N.timeout.title(pc)} body={N.timeout.body} actions={[retry(true), code(false)]} />;
    case 'unsaved':
      return <Failed login={login} icon={model === 'iPad' ? 'tablet' : 'phone'} tone="warn" centred title={N.unsaved.title} body={N.unsaved.body(pc, model)} actions={[retry(true), code(false)]} />;
  }
}
