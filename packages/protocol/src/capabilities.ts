import { z } from 'zod';
import type { Tool } from './session.js';

/**
 * What an adapter knows how to type for a phone, beyond accept, deny and an option number (spec §8). A phone hides an
 * answer its session's tool cannot give.
 */
export const CapabilitiesSchema = z.object({
  /** A question can be answered in free text (`session.reply { other: true }`). */
  freeTextAnswer: z.boolean()
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** An adapter that cannot give any extended answer. */
export const NO_CAPABILITIES: Capabilities = { freeTextAnswer: false };

/** Every tool's capabilities, in the phone's snapshot. */
export const CapabilitiesByToolSchema = z.object({ claude: CapabilitiesSchema, codex: CapabilitiesSchema, cursor: CapabilitiesSchema });
export type CapabilitiesByTool = z.infer<typeof CapabilitiesByToolSchema>;
// A tool added to ToolSchema without its entry here (or the reverse) fails to compile.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const sameTools: Same<keyof CapabilitiesByTool, Tool> = true;
void sameTools;
