/** An on/off switch as the phone draws them (Réglages): a button with `role="switch"`, green when on. */
export function Switch({ on, label, disabled, onChange, describedBy }: { on: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void; describedBy?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} aria-describedby={describedBy}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 flex-none rounded-full border border-line transition-colors disabled:opacity-45 ${on ? 'border-transparent bg-ok' : 'bg-raised'}`}
    >
      <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} aria-hidden="true" />
    </button>
  );
}
