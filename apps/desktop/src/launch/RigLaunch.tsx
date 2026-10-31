import { useEffect, useState, type JSX } from 'react';
import { useOpenRig, useRigSpecs, type DaemonClient, type MachineState } from '@ledge/fleet';
import type { Project, RigPlan } from '@ledge/protocol';
import { launchability, missingOf, recommendSpec, rigFormDefaults, slugOfGoal, whereOf, withGoal, type RigForm } from '@ledge/ui/launch/rigModel';
import { useI18n } from '../i18n/lang';
import type { Modal as ModalState, NavAction } from '../nav/state';
import { Modal } from '../shell/Modal';
import { RigLaunchForm, specOf, type FormMissing } from './RigLaunchForm';
import { RigPlanView } from './RigPlanView';
import { useRigLaunch } from './useRigLaunch';

/** « Nouveau rig » in three steps (spec §4.6): the form, the plan (optional, imposed on a real repository), then the start, which closes
 *  the window on Rigs › En cours where the rig shows `launching`. A refusal stays in the window, at the step it came, with its reason. */
export function RigLaunch(p: {
  client: DaemonClient; projects: readonly Project[]; machines: readonly MachineState[]; wanted: Extract<ModalState, { kind: 'rig-launch' }>;
  dispatch(a: NavAction): void; onClose(): void;
}): JSX.Element {
  const { t } = useI18n();
  const openrig = useOpenRig(p.client);
  const [form, setForm] = useState<RigForm>(() => {
    const f = rigFormDefaults({ projects: p.projects, machines: p.machines, wanted: p.wanted });
    return f.place.kind === 'off' && f.goal === '' ? { ...f, place: { ...f.place, name: '' } } : f;
  });
  // A spec or a branch the user chose is kept; until then the spec follows Ledge's recommendation and the branch the spec.
  const [touched, setTouched] = useState({ spec: p.wanted.spec !== undefined, branch: false });
  const [tried, setTried] = useState(false);
  const specs = useRigSpecs(p.client, form.machine);
  const flow = useRigLaunch(p.client, () => { p.onClose(); p.dispatch({ type: 'ledge', tab: 'rigs', rigs: 'live' }); });

  const withSpec = (f: RigForm, spec: string, branchTouched = touched.branch): RigForm =>
    ({ ...f, spec, place: f.place.kind === 'project' && !branchTouched ? { ...f.place, branch: `feat/${spec}` } : f.place });
  const rec = recommendSpec(form.goal, specs.specs);
  const recName = specOf(specs.specs, rec?.spec ?? null)?.name;
  useEffect(() => {
    if (!touched.spec && recName && recName !== form.spec) setForm(f => withSpec(f, recName));
  }, [recName, touched.spec, form.spec]);

  const machineOk = (() => { const m = p.machines.find(x => x.id === form.machine); return !!m && launchability(m, openrig.find(s => s.machine === m.id)).ok; })();
  const missing: FormMissing[] = [...missingOf(form), ...(machineOk ? [] : ['machine' as const])];
  const send = (then: 'plan' | 'launch') => {
    setTried(true);
    const where = whereOf(form);
    if (missing.length > 0 || !where || !form.spec) return;
    flow.prepare(form.machine, form.spec, form.goal.trim(), where, { then });
  };

  const s = flow.state;
  const planStep = s.step === 'plan' || ((s.step === 'preparing' || s.step === 'launching') && s.from === 'plan') || (s.step === 'error' && s.back === 'plan');
  const plan: RigPlan | undefined = planStep && 'plan' in s ? s.plan : undefined;
  const busy = s.step === 'preparing' ? 'preparing' as const : s.step === 'launching' ? 'launching' as const : null;
  const refused = s.step === 'error' ? s.reason : null;

  const toggleCopy = (from: RigPlan | undefined) => {
    if (form.place.kind !== 'project') return;
    const next: RigForm = { ...form, place: { ...form.place, copy: !form.place.copy } };
    setForm(next);
    const where = whereOf(next);
    // From the plan, the copy changes the folder: a new plan is made.
    if (from && where && next.spec) flow.prepare(form.machine, next.spec, next.goal.trim(), where);
  };

  return (
    <Modal title={plan ? t.rigLaunch.planTitle(plan.spec) : t.modalTitles.rigLaunch} wide className="rig-launch" onClose={p.onClose}>
      {plan ? (
        <RigPlanView plan={plan} busy={busy} refused={refused} onCopy={() => toggleCopy(plan)} onBack={flow.back} onLaunch={() => flow.launch(plan)} />
      ) : (
        <RigLaunchForm form={form} projects={p.projects} machines={p.machines} openrig={openrig} specs={specs} missing={missing} tried={tried}
          busy={busy} refused={refused}
          onGoal={goal => setForm(f => withGoal(f, goal))}
          onSpec={spec => { setTouched(x => ({ ...x, spec: true })); setForm(f => withSpec(f, spec)); }}
          onProject={id => setForm(f => {
            if (id === null) return f.place.kind === 'off' ? f : { ...f, place: { kind: 'off', name: slugOfGoal(f.goal), nameTouched: false } };
            const project = p.projects.find(x => x.id === id);
            const branch = f.place.kind === 'project' ? f.place.branch : f.spec ? `feat/${f.spec}` : '';
            return { ...f, place: { kind: 'project', projectId: id, repo: project?.repos.find(r => r.machine === f.machine)?.path ?? null, branch, copy: f.place.kind === 'project' ? f.place.copy : true } };
          })}
          onMachine={id => setForm(f => {
            if (f.place.kind !== 'project') return { ...f, machine: id };
            const projectId = f.place.projectId;
            return { ...f, machine: id, place: { ...f.place, repo: p.projects.find(x => x.id === projectId)?.repos.find(r => r.machine === id)?.path ?? null } };
          })}
          onRepo={repo => setForm(f => (f.place.kind === 'project' ? { ...f, place: { ...f.place, repo } } : f))}
          onBranch={branch => { setTouched(x => ({ ...x, branch: true })); setForm(f => (f.place.kind === 'project' ? { ...f, place: { ...f.place, branch } } : f)); }}
          onCopy={() => toggleCopy(undefined)}
          onName={name => setForm(f => (f.place.kind === 'off' ? { ...f, place: { kind: 'off', name, nameTouched: true } } : f))}
          onCancel={p.onClose} onPlan={() => send('plan')} onLaunch={() => send('launch')} />
      )}
    </Modal>
  );
}
