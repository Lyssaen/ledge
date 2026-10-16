import { z } from 'zod';
import { SshAliasSchema } from './ssh.js';

/** A configured machine, as both fronts list it: the local daemon first, then SSH aliases (spec 2026-10-14 §5). */
export const MachineSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  label: z.string().trim().min(1).max(80),
  ssh: SshAliasSchema.optional()
});
export type Machine = z.infer<typeof MachineSchema>;

export const MachinesSchema = z.array(MachineSchema).min(1).max(20).superRefine((list, ctx) => {
  if (list[0]?.id !== 'local' || list[0].ssh !== undefined) ctx.addIssue({ code: 'custom', message: 'the first machine is local, without ssh', path: [0] });
  const ids = new Set<string>(), aliases = new Set<string>();
  list.forEach((m, i) => {
    if (i > 0 && !m.ssh) ctx.addIssue({ code: 'custom', message: 'a remote machine needs an ssh alias', path: [i, 'ssh'] });
    if (ids.has(m.id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${m.id}`, path: [i, 'id'] });
    ids.add(m.id);
    if (m.ssh) {
      if (aliases.has(m.ssh)) ctx.addIssue({ code: 'custom', message: `duplicate ssh alias ${m.ssh}`, path: [i, 'ssh'] });
      aliases.add(m.ssh);
    }
  });
});
export type Machines = z.infer<typeof MachinesSchema>;
