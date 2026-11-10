/**
 * One choice among a few, side by side: radios drawn as segments, so the phone reads them as a group and the arrows
 * move between them.
 */
export function Segmented<T extends string>({ name, legend, options, value, onChange, fit = false }: {
  name: string; legend: string; options: readonly { value: T; label: string; lang?: string }[]; value: T; onChange: (v: T) => void;
  /** At its natural width, on the left, rather than across the line (m0-langue.html, §1). */
  fit?: boolean;
}) {
  return (
    <fieldset className={`m-0 min-w-0 border-0 p-0${fit ? ' self-start' : ''}`} data-fit={fit || undefined}>
      <legend className="sr-only">{legend}</legend>
      <div className={`${fit ? 'inline-flex' : 'grid auto-cols-fr grid-flow-col'} gap-1 rounded-control bg-raised p-1`}>
        {options.map(o => (
          <label key={o.value} lang={o.lang} className={`flex min-h-10 cursor-pointer items-center justify-center rounded-[9px] ${fit ? 'px-3.5' : 'px-2'} text-body font-medium text-muted transition-colors duration-100 has-[:checked]:bg-fg has-[:checked]:text-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
