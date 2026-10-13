import { z } from 'zod';

/** Read-only inventory for the common chat. Identifiers are local to each machine. */
export const MachineInventorySchema = z.object({
  id: z.string().min(1).max(80), label: z.string().min(1).max(120), online: z.boolean(), local: z.boolean(),
  sessions: z.array(z.object({ id: z.string(), name: z.string(), project: z.string(), cwd: z.string(), topic: z.string().optional(), state: z.string(), readOnly: z.boolean() })).max(500),
  folders: z.array(z.object({ project: z.string(), cwd: z.string() })).max(100)
});
export const RoutingContextSchema = z.object({
  machines: z.array(MachineInventorySchema).min(1).max(20),
  history: z.array(z.object({ question: z.string().max(20000), answer: z.string().max(20000).optional(), machineId: z.string().optional() })).max(50)
});
export type RoutingContext = z.infer<typeof RoutingContextSchema>;
export const RouteResultSchema = z.object({
  /** Null means an answer or a clarification, never an implicit local destination. */
  machineId: z.string().nullable(), text: z.string().min(1).max(20000),
  choices: z.array(z.string()).max(20).optional()
});
export type RouteResult = z.infer<typeof RouteResultSchema>;
