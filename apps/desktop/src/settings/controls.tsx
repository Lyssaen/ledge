/** A settings switch: the whole row is the label, the checkbox carries `role="switch"` (mockup settings.js `toggle`). */
export function Toggle({ label, hint, checked, onChange, disabled, error }: { label: string; hint: string; checked: boolean; onChange(on: boolean): void; disabled?: boolean; error?: string }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong><small>{hint}</small>{error && <small className="setting-error" role="alert">{error}</small>}</span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="setting-switch" aria-hidden="true" />
    </label>
  );
}

/** A settings choice (mockup settings.js `select`); option values are strings, the caller maps them back. */
export function SelectRow<V extends string>({ label, hint, value, options, onChange, disabled }: { label: string; hint: string; value: V; options: readonly (readonly [V, string])[]; onChange(v: V): void; disabled?: boolean }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong><small>{hint}</small></span>
      <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value as V)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}
