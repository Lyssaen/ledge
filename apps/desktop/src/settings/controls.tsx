import { useId, type JSX, type ReactNode } from 'react';

/* The Settings page's building blocks (docs/mockups/desktop-observatory/settings.tsx, Controls): a card of rows, a row
   (its label and hint left, its control right, or stacked), a switch row and a segmented choice. */

function RowFrame({ label, hint, hintId, labelId, stack, children }: { label: string; hint?: ReactNode; hintId?: string; labelId?: string; stack?: boolean; children?: ReactNode }): JSX.Element {
  return (
    <div className={stack ? 'set-row stack' : 'set-row'}>
      <div className="set-copy">
        <span id={labelId} className="set-label">{label}</span>
        {hint && <span className="set-hint" id={hintId}>{hint}</span>}
      </div>
      {children && <div className="set-control">{children}</div>}
    </div>
  );
}

/** A row: the setting's name and its hint, then its control (beside, or under them with `stack`). */
export function Row({ label, hint, stack, children }: { label: string; hint?: ReactNode; stack?: boolean; children: ReactNode }): JSX.Element {
  return <RowFrame label={label} hint={hint} stack={stack}>{children}</RowFrame>;
}

/** A switch row: the row's label names the switch (role="switch", aria-checked), its hint describes it. */
export function SwitchRow({ label, hint, checked, disabled, onChange }: { label: string; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange(on: boolean): void }): JSX.Element {
  const id = useId();
  return (
    <RowFrame label={label} hint={hint} labelId={`${id}l`} hintId={`${id}h`}>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}l`} aria-describedby={hint ? `${id}h` : undefined} disabled={disabled}
        className="set-switch" onClick={() => onChange(!checked)}><i /></button>
    </RowFrame>
  );
}

/** A segmented choice: native radios in a radiogroup, so the arrows and Tab behave as usual. `wide`: the option takes more room. */
export function Segmented<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: readonly { value: T; label: ReactNode; wide?: boolean }[]; disabled?: boolean; onChange(v: T): void }): JSX.Element {
  const name = useId();
  return (
    <div className="set-seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map(o => (
        <label key={o.value} className={[o.value === value && 'on', o.wide && 'wide'].filter(Boolean).join(' ') || undefined}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} disabled={disabled} onChange={() => onChange(o.value)} />{o.label}
        </label>
      ))}
    </div>
  );
}

/** A card of rows, with an optional title (which names it) and a note under the title. */
export function Card({ title, hint, children }: { title?: string; hint?: ReactNode; children: ReactNode }): JSX.Element {
  const id = useId();
  return (
    <section className="set-card" aria-labelledby={title ? id : undefined}>
      {title && <h2 id={id}>{title}</h2>}
      {hint && <p className="set-card-note">{hint}</p>}
      <div className="set-rows">{children}</div>
    </section>
  );
}
