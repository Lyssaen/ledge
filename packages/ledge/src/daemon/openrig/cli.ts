/** Runs the `rig` binary (always through agentEnv()); injected so tests can use fakeRigCli. */
export type RigExec = (args: string[], opts?: { timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
