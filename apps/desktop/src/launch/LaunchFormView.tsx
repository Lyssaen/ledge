import { useEffect, useRef, useState } from 'react';
import type { MachineState } from '@ledge/fleet';
import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';
import { TOOL_NAMES } from '../shell/Person';
import { FolderBrowser } from './FolderBrowser';
import {
  availability, checkForm, CUSTOM, CWD_MAX, editDraft, PROMPT_MAX, recentsOf, resolveForm, TOOLS,
  type LaunchDraft, type LaunchProblem, type LaunchRequest
} from './form';
import type { LaunchFleet } from './useLaunch';

export interface LaunchFormViewProps {
  draft: LaunchDraft;
  onDraft(fn: (d: LaunchDraft) => LaunchDraft): void;
  machines: MachineState[];
  fleet: LaunchFleet;
  onLaunch(request: LaunchRequest): void;
}

const FIELD: Record<LaunchProblem, string> = { machine: 'launch-machine', cwd: 'launch-folder', prompt: 'launch-prompt' };

/** The mockup's form (launch.js): machine, project, folder (with the browser), agent, first instruction. */
export function LaunchFormView({ draft, onDraft, machines, fleet, onLaunch }: LaunchFormViewProps) {
  const { t } = useI18n(); const l = t.launch; const theme = useTheme();
  const form = resolveForm(draft, machines);
  const [problem, setProblem] = useState<LaunchProblem | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [custom, setCustom] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const target = machines.find(m => m.id === form.machine);
  const recents = recentsOf(target);
  const project = !custom && recents.some(r => r.cwd === form.cwd) ? form.cwd : CUSTOM;
  const name = (m: MachineState) => l.machineName(m.label, !!m.ssh);
  const down = machines.filter(m => !m.ready);

  const edit = (patch: Partial<LaunchDraft>) => { setProblem(null); onDraft(() => editDraft(form, patch)); };
  // The mockup focuses the first select when the form opens.
  useEffect(() => { formRef.current?.querySelector<HTMLElement>('select')?.focus({ preventScroll: true }); }, []);
  // The browser lists one machine: another machine (chosen, or a fallback after a drop) closes it.
  useEffect(() => { setBrowsing(false); }, [form.machine]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkForm(form, machines);
    if (!checked.ok) {
      setProblem(checked.problem);
      document.getElementById(FIELD[checked.problem])?.focus({ preventScroll: true });
      return;
    }
    onLaunch(checked.request);
  };

  return (
    <form id="launch-form" ref={formRef} className="launch-form" aria-label={l.form} noValidate onSubmit={submit}>
      <div className="launch-fields">
        <div className="launch-field">
          <label htmlFor="launch-machine">{l.machine}</label>
          <select id="launch-machine" name="machine" value={form.machine ?? ''} aria-invalid={problem === 'machine' || undefined}
            onChange={e => { setCustom(false); edit({ machine: e.target.value, cwd: null }); }}>
            {!form.machine && <option value="" disabled>—</option>}
            {machines.map(m => <option key={m.id} value={m.id} disabled={!m.ready}>{name(m) + l.availability[availability(m)]}</option>)}
          </select>
        </div>
        <div className="launch-field">
          <label htmlFor="launch-project">{l.project}</label>
          <select id="launch-project" name="project" value={project}
            onChange={e => {
              if (e.target.value === CUSTOM) { setCustom(true); edit({ cwd: '' }); folderRef.current?.focus({ preventScroll: true }); }
              else { setCustom(false); edit({ cwd: e.target.value }); }
            }}>
            {recents.map(r => <option key={r.cwd} value={r.cwd} title={r.cwd}>{r.project}</option>)}
            <option value={CUSTOM}>{l.custom}</option>
          </select>
        </div>
      </div>
      {target && down.length > 0 && <p className="launch-note">{l.someDown(down.map(name), name(target))}</p>}
      {!target && <p className="launch-note">{l.noneReady}</p>}
      <div className="launch-field">
        <label htmlFor="launch-folder">{l.folder}</label>
        <div className="launch-folder-row">
          <input id="launch-folder" ref={folderRef} name="folder" value={form.cwd} maxLength={CWD_MAX} placeholder={l.folderPlaceholder}
            spellCheck={false} autoComplete="off" aria-describedby="launch-folder-hint" aria-invalid={problem === 'cwd' || undefined}
            onChange={e => { setCustom(true); edit({ cwd: e.target.value }); }} />
          <button type="button" ref={browseRef} className="settings-button" aria-expanded={browsing} disabled={!target}
            onClick={() => setBrowsing(b => !b)}>{l.browse.button}</button>
        </div>
        <small id="launch-folder-hint">{l.folderHint}</small>
      </div>
      {browsing && target && (
        <FolderBrowser key={target.id} fleet={fleet} machine={target.id} label={name(target)} ready={target.ready} start={form.cwd}
          onChoose={path => { setBrowsing(false); setCustom(false); edit({ cwd: path }); folderRef.current?.focus({ preventScroll: true }); }}
          onClose={() => { setBrowsing(false); browseRef.current?.focus({ preventScroll: true }); }} />
      )}
      <fieldset className="launch-agents">
        <legend>{l.agent}</legend>
        {TOOLS.map(tool => (
          <label key={tool}>
            <input type="radio" name="tool" value={tool} checked={form.tool === tool} onChange={() => edit({ tool })} />
            <span>
              <span aria-hidden="true"><Bot tool={tool} state="idle" pose={poseFor(`launch-${tool}`, 'idle')} size={28} theme={theme} seed={`launch-${tool}`} /></span>
              {TOOL_NAMES[tool]}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="launch-field">
        <label htmlFor="launch-prompt">{l.prompt}</label>
        <textarea id="launch-prompt" name="prompt" rows={5} maxLength={PROMPT_MAX} placeholder={l.promptPlaceholder} value={form.prompt}
          aria-invalid={problem === 'prompt' || undefined} onChange={e => edit({ prompt: e.target.value })} />
      </div>
      {problem && <p className="launch-error" role="alert">{l.invalid[problem]}</p>}
      <div className="launch-actions">
        <small>{l.footnote}</small>
        <button type="submit" className="primary">{l.submit}</button>
      </div>
    </form>
  );
}
