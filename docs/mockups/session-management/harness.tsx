import React from 'react';
import type { BotProps } from '../../../packages/ui/src/bots/Bot';
import { LogoBot } from '../../../packages/ui/src/preview/LogoBot';

export type PreviewTool = BotProps['tool'];
export const HARNESSES: { id: PreviewTool; label: string; hint: string }[] = [
  { id: 'claude', label: 'Claude Code', hint: 'Le harness d’Anthropic' },
  { id: 'codex', label: 'Codex', hint: 'Le harness d’OpenAI' },
  { id: 'cursor', label: 'Cursor', hint: 'Le harness de Cursor' },
  { id: 'omp', label: 'omp', hint: 'Contrôle natif · plusieurs fournisseurs' },
];
export const HARNESS_LABELS: Record<PreviewTool, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', omp: 'omp' };

/** The approved logo shapes, honoring the existing prototype's pause/motion controls. */
export function HarnessBot({ paused, reducedMotion, ...props }: BotProps) {
  return <LogoBot {...props} reducedMotion={reducedMotion || paused} />;
}
