import type { JSX } from 'react';
import type { Provider } from '../workspace/sessionTab';

const TITLES: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', omp: 'omp' };

/** The logo of a tool's provider: the mockup's `logo()` (Anthropic's asterisk, OpenAI's rosette, omp's glyph). */
export function ProviderLogo({ provider, size = 14 }: { provider: Provider; size?: number }): JSX.Element {
  return (
    <span className="logo" title={TITLES[provider]}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        {provider === 'anthropic' && <g stroke="#d97757" strokeWidth="2.6" strokeLinecap="round">
          {[0, 30, 60, 90, 120, 150].map(a => <line key={a} x1="12" y1="3" x2="12" y2="21" transform={`rotate(${a} 12 12)`} />)}
        </g>}
        {provider === 'openai' && <g fill="none" stroke="var(--foreground)" strokeWidth="1.6">
          {[0, 60, 120].map(a => <ellipse key={a} cx="12" cy="12" rx="9.5" ry="4.4" transform={`rotate(${a} 12 12)`} />)}
        </g>}
        {provider === 'omp' && <g fill="none" stroke="#a3e635" strokeWidth="2.4" strokeLinecap="round">
          <path d="M4 7.5c2-1.5 4-1.6 6-1.5h10" /><path d="M9 6.5v12" /><path d="M15.5 6.5v9.5c0 1.6.9 2.5 2.5 2.5" />
        </g>}
      </svg>
    </span>
  );
}
