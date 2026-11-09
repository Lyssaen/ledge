import type { JSX } from 'react';

/** The mockup's `ic.pr`: a branch merging into another. */
export function PrIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="19" r="2.2" />
      <path d="M6 7.2v9.6M18 16.8V10a3 3 0 0 0-3-3h-4" /><path d="M13 4.5 10.5 7 13 9.5" />
    </svg>
  );
}
