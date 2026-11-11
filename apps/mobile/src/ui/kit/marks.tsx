import type { Tool } from '@ledge/protocol';

/*
 * The small marks of the redesign (docs/mockups/ledge-mobile-refonte/m0-socle.html, §6): a status dot, a runtime tag, a pill.
 * Each is its Ledge Desktop counterpart, coloured by the tokens of @ledge/ui only.
 */

/** What a dot says: a session at work, waiting on a permission or a question, free, ended, unknown or offline, OpenRig's; `plain`: a skipped pipeline (M5). */
export type DotState = 'work' | 'perm' | 'ask' | 'idle' | 'done' | 'off' | 'rig' | 'plain';

const DOT: Record<DotState, string> = {
  work: 'bg-info', perm: 'bg-approval', ask: 'bg-attention', idle: 'bg-ok', done: 'bg-muted opacity-50',
  off: 'bg-transparent shadow-[inset_0_0_0_1.5px_var(--color-muted)]', rig: 'bg-task', plain: 'bg-muted'
};

/** An 8 px status dot. `pulse`: a session at work, while the state shown is live (a stale one never pulses). */
export function Dot({ state, pulse = false, label }: { state: DotState; pulse?: boolean; label?: string }) {
  return (
    <span
      data-dot={state}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={`inline-block size-2 flex-none rounded-full ${DOT[state]} ${pulse ? 'animate-[ledge-pulse_1.6s_ease-in-out_infinite]' : ''}`}
    />
  );
}

/** A runtime's two letters, as the desktop's: CC, CX, CU, OM (question Q11). */
export const RUNTIME: Record<Tool, string> = { claude: 'CC', codex: 'CX', cursor: 'CU', omp: 'OM' };

export function RuntimeTag({ tool }: { tool: Tool }) {
  return <span data-runtime={tool} className="flex-none rounded-[5px] bg-secondary px-[5px] py-px font-mono text-[11px] leading-4 font-medium">{RUNTIME[tool]}</span>;
}

/** A pill's tone: a permission or anything urgent in red, a question in amber, a run in blue, a success in green, OpenRig in violet, a high risk filled. */
export type PillTone = 'plain' | 'perm' | 'ask' | 'urgent' | 'work' | 'ok' | 'rig' | 'risk';

const PILL: Record<PillTone, string> = {
  plain: 'border-input text-muted',
  perm: 'border-approval/50 text-approval',
  urgent: 'border-approval/50 text-approval',
  ask: 'border-attention/50 text-attention',
  work: 'border-info/45 text-info',
  ok: 'border-ok/45 text-ok',
  rig: 'border-task/50 text-task',
  risk: 'border-transparent bg-destructive text-primary-fg font-semibold'
};

/** A state in words, outlined (Desktop's .atoi-pill). */
export function Pill({ tone = 'plain', children }: { tone?: PillTone; children: string }) {
  return <span data-pill={tone} className={`inline-flex h-5 flex-none items-center rounded-lg border px-[7px] text-[11.5px] whitespace-nowrap ${PILL[tone]}`}>{children}</span>;
}
