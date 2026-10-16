import type { MachineConfig, MachineState } from '@ledge/fleet';

/** An SSH alias as the form accepts it (decision 11; the protocol allows 128, the form 64 as the mockup). */
export const ALIAS = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
/** `MachinesSchema` allows 20 machines, the local one included. */
export const MAX_MACHINES = 20;
export interface MachineDraft { label: string; ssh: string }
export type DraftProblem = 'invalid' | 'duplicate' | 'full';

/** Why a draft cannot be saved, or null. `editingId`: the machine being edited, whose own alias is not a duplicate. */
export function checkDraft(list: readonly MachineConfig[], draft: MachineDraft, editingId: string | null): DraftProblem | null {
  const label = draft.label.trim(); const ssh = draft.ssh.trim();
  if (label.length < 1 || label.length > 80 || !ALIAS.test(ssh)) return 'invalid';
  if (list.some(m => m.id !== editingId && m.ssh === ssh)) return 'duplicate';
  if (editingId === null && list.length >= MAX_MACHINES) return 'full';
  return null;
}

/** A fresh id the protocol accepts (`^[a-zA-Z0-9_-]{1,64}$`), without `crypto.randomUUID` (absent from older WebView2). */
export function newMachineId(list: readonly MachineConfig[], random: () => number = Math.random): string {
  const base = `remote-${Math.floor(random() * 2 ** 32).toString(36)}`;
  let id = base; let n = 2;
  while (list.some(m => m.id === id)) id = `${base}-${n++}`;
  return id;
}

/** The configured list behind the fleet's machine states (what `machines.set` carries). */
export const configsOf = (machines: readonly MachineState[]): MachineConfig[] =>
  machines.map(m => ({ id: m.id, label: m.label, ...(m.ssh ? { ssh: m.ssh } : {}) }));

/** The list with the draft added, or replacing the machine being edited (in place). */
export function withDraft(list: readonly MachineConfig[], draft: MachineDraft, editingId: string | null, random?: () => number): MachineConfig[] {
  const label = draft.label.trim(); const ssh = draft.ssh.trim();
  if (editingId) return list.map(m => (m.id === editingId ? { id: m.id, label, ssh } : m));
  return [...list, { id: newMachineId(list, random), label, ssh }];
}

/** The list without one machine; the local one is never removed (spec §6). */
export const without = (list: readonly MachineConfig[], id: string): MachineConfig[] => (id === 'local' ? [...list] : list.filter(m => m.id !== id));

/** Same machines, same order, same names and aliases: the daemon's broadcast has reached the fleet. */
export const sameMachines = (a: readonly MachineConfig[], b: readonly MachineConfig[]): boolean =>
  a.length === b.length && a.every((m, i) => m.id === b[i]!.id && m.label === b[i]!.label && (m.ssh ?? null) === (b[i]!.ssh ?? null));
