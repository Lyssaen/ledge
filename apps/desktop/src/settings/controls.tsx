import { useId, type JSX, type ReactNode } from 'react';

/* The Settings page's building blocks (docs/mockups/desktop-observatory/settings.tsx, Controls): a card of rows, a row
   (its label and hint left, its control right, or stacked), a switch row and a segmented choice. */

function RowFrame({ label, hint, id, error, stack, children }: { label: string; hint?: ReactNode; id: string; error?: string | null; stack?: boolean; children?: ReactNode }): JSX.Element {
  return (
    <div className={stack ? 'set-row stack' : 'set-row'}>
      <div className="set-copy">
        <span id={`${id}l`} className="set-label">{label}</span>
        {hint && <span className="set-hint" id={`${id}h`}>{hint}</span>}
        {error && <span className="set-error" id={`${id}e`} role="alert">{error}</span>}
      </div>
      {children && <div className="set-control">{children}</div>}
    </div>
  );
}

/** What describes a row's control: its hint, then its error while there is one. */
const describedBy = (id: string, hint: ReactNode, error?: string | null): string | undefined =>
  [hint ? `${id}h` : null, error ? `${id}e` : null].filter(Boolean).join(' ') || undefined;

/** A row: the setting's name and its hint, then its control (beside, or under them with `stack`); `error` says why a change did not take.
 *  As a function, `children` receives the ids that describe the control (the hint, the error), for its `aria-describedby`. */
export function Row({ label, hint, error, stack, children }: { label: string; hint?: ReactNode; error?: string | null; stack?: boolean; children: ReactNode | ((describedBy: string | undefined) => ReactNode) }): JSX.Element {
  const id = useId();
  return <RowFrame label={label} hint={hint} id={id} error={error} stack={stack}>{typeof children === 'function' ? children(describedBy(id, hint, error)) : children}</RowFrame>;
}

/** A switch row: the row's label names the switch (role="switch", aria-checked), its hint and its error describe it; `error` as in Row. */
export function SwitchRow({ label, hint, error, checked, disabled, onChange }: { label: string; hint?: ReactNode; error?: string | null; checked: boolean; disabled?: boolean; onChange(on: boolean): void }): JSX.Element {
  const id = useId();
  return (
    <RowFrame label={label} hint={hint} id={id} error={error}>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}l`} aria-describedby={describedBy(id, hint, error)} disabled={disabled}
        className="set-switch" onClick={() => onChange(!checked)}><i /></button>
    </RowFrame>
  );
}

/** A segmented choice: native radios in a radiogroup, so the arrows and Tab behave as usual. `wide`: the option takes more room;
 *  `lang`: the option's own language (a language named in itself). `describedBy`: what describes the group (Row's hint and error). */
export function Segmented<T extends string>({ label, value, options, disabled, describedBy, onChange }: { label: string; value: T; options: readonly { value: T; label: ReactNode; wide?: boolean; lang?: string }[]; disabled?: boolean; describedBy?: string; onChange(v: T): void }): JSX.Element {
  const name = useId();
  return (
    <div className="set-seg" role="radiogroup" aria-label={label} aria-describedby={describedBy} aria-disabled={disabled || undefined}>
      {options.map(o => (
        <label key={o.value} lang={o.lang} className={[o.value === value && 'on', o.wide && 'wide'].filter(Boolean).join(' ') || undefined}>
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
