import { useId, type JSX } from 'react';
import { PROVIDER_MARKS } from '@ledge/ui/logos/providers';
import type { Provider } from '../workspace/sessionTab';

/** A provider's name, as its logo's title and under an agent tile (the launch modal). */
export const PROVIDER_TITLES: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', cursor: 'Cursor', omp: 'omp' };

const OMP = 'M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z';

/** The logo of a tool's provider: Claude's spark in its orange (as the mockup's `logo()`), OpenAI's and Cursor's marks in
 *  the text colour (they follow the theme), omp's π in its gradient. The gradient's id is this instance's own: two logos
 *  on screen sharing one would point at whichever came first, and lose it when that one goes. */
export function ProviderLogo({ provider, size = 14 }: { provider: Provider; size?: number }): JSX.Element {
  // React 19's ids are « «r0» »-like, older ones « :r0: »: the colons are dropped so the id reads cleanly in url(#…).
  const grad = `omp-pi-${useId().replace(/:/g, '')}`;
  return (
    <span className="logo" title={PROVIDER_TITLES[provider]}>
      {provider === 'omp' ? (
        <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="oklch(0.7 0.24 340)" /><stop offset=".5" stopColor="oklch(0.62 0.21 295)" /><stop offset="1" stopColor="oklch(0.81 0.14 200)" />
            </linearGradient>
          </defs>
          <path fill={`url(#${grad})`} d={OMP} />
        </svg>
      ) : provider === 'anthropic' ? (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill={PROVIDER_MARKS.anthropic.fill} fillRule={PROVIDER_MARKS.anthropic.rule} d={PROVIDER_MARKS.anthropic.d} /></svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule={PROVIDER_MARKS[provider].rule} aria-hidden="true"><path d={PROVIDER_MARKS[provider].d} /></svg>
      )}
    </span>
  );
}
