import { useRef, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { copy } from '../copy';
import { guessDeviceName, isIosBrowserTab, openPairSocket, PairFailure, pairDevice, savePairing } from '../connection/pair';

const t = copy.pairing;

function Bix() {
  return (
    <svg className="size-[68px] drop-shadow-[0_3px_5px_#0005]" viewBox="0 0 96 96" aria-hidden="true">
      <path d="M49 22V14" stroke="#7d8b91" strokeWidth="2" /><circle cx="49" cy="12" r="3" fill="#a6d6bf" />
      <g fill="#34434b" stroke="#73858c" strokeWidth=".8"><rect x="15" y="22" width="66" height="56" rx="20" /></g>
      <rect x="25" y="35" width="47" height="29" rx="13" fill="#172124" />
      <g fill="#a6d6bf"><rect x="36" y="43" width="6" height="12" rx="3" /><rect x="55" y="43" width="6" height="12" rx="3" /></g>
      <path d="M31 79h9m17 0h9" stroke="#34434b" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

const notice = 'my-3.5 w-full rounded-control border border-line bg-surface p-3.5 text-xs leading-[1.65]';
const btn = 'mt-2 inline-flex min-h-12 items-center justify-center rounded-control border border-line px-4 py-2.5 text-[13px] font-medium';

export interface PairingProps {
  /** Called when the person leaves the last step; the app then connects with the stored token. */
  onContinue(): void;
  /** Test seam. */
  pair?: typeof pairDevice;
  iosTab?: boolean;
}

export function Pairing({ onContinue, pair = pairDevice, iosTab = isIosBrowserTab() }: PairingProps) {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<PairFailure['reason'] | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const s = t.steps[step]!;

  const submit = async () => {
    if (code.length !== 6 || inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(null);
    const deviceName = guessDeviceName(navigator.userAgent);
    try {
      const r = await pair(code, { open: () => openPairSocket(), startRegistration, deviceName });
      savePairing(r, deviceName);
      setStep(3);
    } catch (e) {
      setFailure(e instanceof PairFailure ? e.reason : 'network');
    } finally { inFlight.current = false; setBusy(false); }
  };

  const showNext = step !== 1 || !iosTab;
  const next = () => { if (step === 2) void submit(); else if (step === 3) onContinue(); else setStep(step + 1); };

  return (
    <main className="app" aria-labelledby="pair-title">
      <header className="flex-none px-side pt-2 pb-3">
        <div className="flex items-center justify-between">
          {step === 1 || step === 2
            ? <button type="button" className="-ml-2 inline-flex size-11 items-center justify-center rounded-control" aria-label={t.back} onClick={() => setStep(step - 1)}>
                <svg className="size-5 fill-none stroke-fg [stroke-width:2]" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            : <span className="size-11" />}
          <span className="text-xs text-muted">{t.stepOf(step + 1)}</span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-side pb-[22px]">
        <div className="my-5 flex gap-1.5" aria-hidden="true">
          {t.steps.map((_, i) => <span key={i} className={`h-[3px] flex-1 rounded-sm ${i <= step ? 'bg-ok' : 'bg-raised'}`} />)}
        </div>
        <div className="my-5">
          <Bix />
          <h1 id="pair-title" className="mt-[18px] mb-3 text-[27px] leading-[1.15] font-semibold tracking-[-1px]">{s.title}</h1>
          <p className="text-[13px] text-muted">{s.subtitle}</p>
        </div>

        {step === 0 && (
          <ol className="my-5 list-none space-y-[18px] p-0">
            {t.checklist.map((c, i) => (
              <li key={c.title} className="flex gap-3 text-[13px]">
                <span className="grid size-[26px] flex-none place-items-center rounded-lg bg-raised text-xs text-muted" aria-hidden="true">{i + 1}</span>
                <div>{c.title}<small className="mt-1 block text-muted">{c.hint}</small></div>
              </li>
            ))}
          </ol>
        )}
        {step === 1 && (
          <>
            <div className={notice}><strong className="mb-[5px] block text-[13px]">{t.install.title}</strong><p>{t.install.body}</p></div>
            <p className="mt-4 text-xs text-muted">{t.install.note}</p>
          </>
        )}
        {step === 2 && (
          <>
            <label htmlFor="pair-code" className="mt-3 mb-2 block text-xs text-muted">{t.codeLabel}</label>
            <input
              id="pair-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000"
              value={code} disabled={busy}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full rounded-control border border-line bg-surface p-4 text-center font-mono text-[26px] tracking-[12px] text-fg"
            />
            <p className="mt-2.5 text-xs text-muted">{t.codeHint}</p>
            <div role="alert" className="min-h-0">
              {failure && <p className="my-2.5 rounded-control bg-danger-bg px-3 py-2 text-xs text-danger-fg">{t.errors[failure]}</p>}
            </div>
            <div className={notice}><strong className="mb-[5px] block text-[13px]">{t.privacy.title}</strong><p>{t.privacy.body}</p></div>
          </>
        )}
        {step === 3 && (
          <div className={`${notice} border-ok/25 bg-ok/5`}><strong className="mb-[5px] block text-[13px] text-ok">{t.done.title}</strong><p>{t.done.body}</p></div>
        )}
      </div>
      {showNext && (
        <footer className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg px-side pt-3 pb-4">
          <button type="button" id="pair-next" className={`${btn} bg-fg text-[#121415] disabled:opacity-50`} disabled={step === 2 && (code.length !== 6 || busy)} onClick={next}>
            {busy ? t.pending : s.button}
          </button>
        </footer>
      )}
    </main>
  );
}
