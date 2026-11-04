import { z } from 'zod';

/** The agents Ledge installs on native Windows (spec 2026-11-03 §4.2.6), each from its publisher's own installer. */
export const InstallableToolSchema = z.enum(['claude', 'codex']);
export type InstallableTool = z.infer<typeof InstallableToolSchema>;

/** The Codex release Ledge installs (OpenAI's Windows deployment guide recommends a pinned release); a Ledge release moves it. */
export const CODEX_RELEASE = '0.166.0';

/** What the user runs by hand when Ledge's install fails: the publisher's own command. */
export function manualInstall(tool: InstallableTool): string {
  return tool === 'claude' ? 'irm https://claude.ai/install.ps1 | iex'
    : `Invoke-WebRequest -UseBasicParsing https://chatgpt.com/codex/install.ps1 -OutFile codex-install.ps1; powershell -ExecutionPolicy Bypass -File .\\codex-install.ps1 -Release ${CODEX_RELEASE}`;
}

/** Whether an agent's binary is found on the agents' PATH, where, and the version it prints. */
export const AgentStatusSchema = z.object({ tool: InstallableToolSchema, found: z.boolean(), path: z.string().optional(), version: z.string().max(200).optional() });
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentsStatusSchema = z.object({ type: z.literal('agents.status'), requestId: z.string().min(1).max(100) });
export const AgentsInstallSchema = z.object({ type: z.literal('agents.install'), requestId: z.string().min(1).max(100), tool: InstallableToolSchema });

export const AgentsListingSchema = z.object({ type: z.literal('agents.listing'), requestId: z.string(), agents: z.array(AgentStatusSchema) });
/** An install's end: `ok`, or its exit code and the tail of its output; `busy` while another install runs, `not_offered`
 *  off native Windows. */
export const AgentsInstalledSchema = z.object({
  type: z.literal('agents.installed'), requestId: z.string(), tool: InstallableToolSchema, ok: z.boolean(),
  code: z.number().int().nullable().optional(), output: z.string().max(8000).optional(), error: z.enum(['busy', 'not_offered', 'failed']).optional()
});
export type AgentsListing = z.infer<typeof AgentsListingSchema>;
export type AgentsInstalled = z.infer<typeof AgentsInstalledSchema>;
