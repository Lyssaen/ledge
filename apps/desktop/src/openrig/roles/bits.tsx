import { useEffect, useState, type ReactNode } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { readRoleFile } from '@ledge/fleet/openrig';
import type { Origin, OpenRigRoleFileContent } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { useI18n } from '../../i18n/lang';
import { cls } from '../../shell/cls';
import { provOf, tilde, type Prov } from './model';

/** The four provenance glyphs: written here, inherited, not declared, unknown. */
const GLYPH: Record<Prov, string> = { here: '●', inh: '↳', abs: '○', unk: '?' };

/** Where an inherited value comes from (`import shared`, `membre dev.front`), or why it is unknown. */
export function useProvLabel(): (o: Origin) => string | undefined {
  const { t } = useI18n();
  const r = t.openrig.roles;
  return o => {
    // A launch names its source in `ref` (runtime_default, saved_choice…): the value says it, the badge says « lancement ».
    if (o.kind === 'inherited') return [r.from[o.from] ?? o.from, o.from === 'launch' ? undefined : o.ref].filter(Boolean).join(' ');
    if (o.kind === 'unknown') return r.why[o.why] ?? o.why;
    return undefined;
  };
}

/** A provenance badge: « ● ici », « ↳ hérité · import shared », « ○ non déclaré », « ? inconnu · résolu au lancement ». */
export function Pv({ origin, kind, source }: { origin?: Origin; kind?: Prov; source?: string }) {
  const { t } = useI18n();
  const label = useProvLabel();
  const k = kind ?? (origin ? provOf(origin) : 'here');
  const src = source ?? (origin ? label(origin) : undefined);
  return <span className={`orr-pv orr-${k}`}>{GLYPH[k]} {t.openrig.roles.pv[k]}{src && <> · <span className="mono">{src}</span></>}</span>;
}

/** The legend, at the head of the Parameters tab. */
export function Legend() {
  const { t } = useI18n();
  const r = t.openrig.roles;
  return <div className="orr-legend">{(['here', 'inh', 'abs', 'unk'] as const).map(k => <span key={k}><Pv kind={k} source="" />{r.legend[k]}</span>)}</div>;
}

/** A parameter's row: its rail, its label and YAML key, its value, its badge. */
export function Row({ prov, label, yamlKey, children, badge, dim }: { prov: Prov; label: ReactNode; yamlKey?: string; children: ReactNode; badge?: ReactNode; dim?: boolean }) {
  return (
    <div className={cls('orr-row', `orr-${prov}`, dim && 'orr-dim')}>
      <span className="orr-lb">{label}{yamlKey && <span className="mono">{yamlKey}</span>}</span>
      <span className="orr-val">{children}</span>
      {badge ?? <span />}
    </div>
  );
}

export const Section = ({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children: ReactNode }) => (
  <section className="orr-psec">
    <h3>{title}{sub && <small>{sub}</small>}</h3>
    <div className="orr-rows">{children}</div>
  </section>
);

/** A two- or three-way switch (`aria-pressed`, as the mockup's segments). */
export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: ReactNode }>; onChange: (v: T) => void }) {
  return (
    <div className="orr-seg" role="group" aria-label={label}>
      {options.map(o => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/** Copies a text; says « Copié » a moment. The only action besides reading. */
export function CopyButton({ text, label, icon = false }: { text: string; label?: string; icon?: boolean }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const id = setTimeout(() => setDone(false), 1500); return () => clearTimeout(id); }, [done]);
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => setDone(true), () => {}); };
  const name = label ?? r.copy;
  return (
    <button type="button" className={cls('orr-btn', 'orr-ghost', icon && 'orr-icon')} aria-label={name} title={done ? r.copied : name} onClick={copy}>
      {icon ? (done ? '✓' : <CopyIcon />) : done ? r.copied : name}
    </button>
  );
}

export const CopyIcon = () => (
  <svg className="orr-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7" /></svg>
);
/** « tapé dans le terminal »: Geist has no ⌨, so a small keyboard. */
export const KeyboardIcon = () => (
  <svg className="orr-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" /><path d="M4.5 6.5l2 1.5-2 1.5M8 10h3.5" /></svg>
);

// ── Files: read once per machine, role and path; « Actualiser » reads them again. ──

type FileAnswer = OpenRigRoleFileContent;
const files = new Map<string, Promise<FileAnswer>>();
let generation = 0;
/** Forgets every file read, so the next look reads them again (« Actualiser »). */
export const forgetRoleFiles = () => { files.clear(); generation++; };

export type FileState = { status: 'loading' } | { status: 'ready'; content: string; truncated: boolean; size?: number } | { status: 'error'; error: string };

/** A role's file (one its detail lists), read through the fleet. */
export function useRoleFile(client: DaemonClient, machine: string, roleId: string, path: string | undefined): FileState {
  const [state, setState] = useState<{ key: string; value: FileState } | null>(null);
  const key = path ? `${generation}\u0000${machine}\u0000${roleId}\u0000${path}` : null;
  useEffect(() => {
    if (!path || !key) return;
    let live = true;
    let p = files.get(key);
    if (!p) { p = readRoleFile(client, machine, roleId, path); files.set(key, p); }
    void p.then(m => {
      if (m.error || m.content === undefined) files.delete(key);
      if (!live) return;
      setState({ key, value: m.error || m.content === undefined ? { status: 'error', error: m.error ?? 'missing' } : { status: 'ready', content: m.content, truncated: !!m.truncated, ...(m.size !== undefined ? { size: m.size } : {}) } });
    });
    return () => { live = false; };
  }, [client, machine, roleId, path, key]);
  if (!path) return { status: 'error', error: 'missing' };
  return state?.key === key ? state.value : { status: 'loading' };
}

/** A file's text: rendered Markdown or raw, with what to say when it cannot be read. */
export function FileText({ state, raw, path, markdown = true }: { state: FileState; raw: boolean; path?: string; markdown?: boolean }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  if (state.status === 'loading') return <p className="orr-muted" role="status">{r.reading}</p>;
  if (state.status === 'error') return (
    <div className="orr-err-box">{state.error === 'missing' || state.error === 'not_a_file' ? r.fileMissing : r.fileUnreadable}{path && <code>{tilde(path)}</code>}</div>
  );
  return <>
    {state.truncated && <p className="orr-muted">{r.fileTruncated('512 ko')}</p>}
    {raw || !markdown ? <div className="orr-raw">{state.content}</div> : <div className="orr-md"><ThreadMarkdown text={state.content} /></div>}
  </>;
}

/** YAML as the mockup colours it: keys, values, comments; `hl` marks a line (1-based), the faulty one of an invalid spec. */
export function Yaml({ text, hl }: { text: string; hl?: number }) {
  return (
    <div className="orr-code">
      {text.split('\n').map((l, i) => {
        const m = /^(\s*-?\s*)([A-Za-z_][\w.-]*)(:)(\s*)(.*)$/.exec(l);
        const body = /^\s*#/.test(l) ? <span className="orr-cm">{l}</span>
          : m ? <>{m[1]}<span className="orr-k">{m[2]}</span>{m[3]}{m[4]}{commented(m[5]!)}</>
          : commented(l);
        return <span key={i} className={cls('orr-line', hl === i + 1 && 'orr-hl')}>{body}{'\n'}</span>;
      })}
    </div>
  );
}
function commented(v: string): ReactNode {
  const at = v.search(/\s#/);
  const value = at >= 0 ? v.slice(0, at) : v, comment = at >= 0 ? v.slice(at) : '';
  return <>{value && <span className="orr-v">{value}</span>}{comment && <span className="orr-cm">{comment}</span>}</>;
}
