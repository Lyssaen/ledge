import type { Tone } from '../model/agents';

const TONE: Record<Tone, string> = {
  attention: 'text-attention bg-attention/[0.07]', info: 'text-info bg-info/[0.07]', ok: 'text-ok bg-ok/[0.07]',
  muted: 'text-muted bg-white/[0.03]', danger: 'text-danger-fg bg-danger-fg/[0.07]'
};

/** A state said in words; the colour only backs it up. */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`inline-flex items-center rounded-md px-[7px] py-[3px] text-[10px] font-medium whitespace-nowrap ${TONE[tone]}`}>{label}</span>;
}
