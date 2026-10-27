import type { Tone } from '../model/agents';

/** A tone's colour, as the desktop's badges: coloured text on a tint of the same colour. */
const TONE: Record<Tone, string> = {
  approval: 'text-approval bg-approval/10', attention: 'text-attention bg-attention/10', info: 'text-info bg-info/10',
  ok: 'text-ok bg-ok/10', muted: 'text-muted bg-fg/[0.05]', danger: 'text-danger-fg bg-danger-fg/10'
};

/** A state said in words; the colour only backs it up. Every badge of the phone is one. */
export function Tag({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`inline-flex h-[22px] flex-none items-center rounded-md px-2 text-meta leading-none font-medium whitespace-nowrap ${TONE[tone]}`}>{label}</span>;
}
