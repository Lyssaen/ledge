import { BotShell, seedHash } from '@ledge/client';
import type { Tool } from '@ledge/protocol';

const EYES = ['#a6d6bf', '#a6c8f0', '#edc479'] as const;
/** The phone is dark only, so the Signal body. */
const FILL = '#34434b';

/** The static mascot: one silhouette per tool, eye colour picked from the bot's name. */
export function MobileBot({ tool, seed, large = false }: { tool: Tool; seed: string; large?: boolean }) {
  const eye = EYES[seedHash(seed) % EYES.length]!;
  return (
    <svg className={`flex-none drop-shadow-[0_3px_5px_#0005] ${large ? 'size-[68px]' : 'size-[34px]'}`} viewBox="0 0 96 96" aria-hidden="true">
      <path d="M49 22V14" stroke="#7d8b91" strokeWidth="2" /><circle cx="49" cy="12" r="3" fill={eye} />
      <g stroke="#73858c" strokeWidth=".8"><BotShell tool={tool} fill={FILL} /></g>
      <rect x="25" y="35" width="47" height="29" rx="13" fill="#172124" />
      <g fill={eye}><rect x="36" y="43" width="6" height="12" rx="3" /><rect x="55" y="43" width="6" height="12" rx="3" /></g>
      <path d="M31 79h9m17 0h9" stroke="#34434b" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
