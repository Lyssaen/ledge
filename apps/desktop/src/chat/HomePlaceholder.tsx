import type { JSX } from 'react';

/** A tab of the Ledge screen whose content comes with a later lot (Mandat until lot 7): its name and what will be there. */
export function HomePlaceholder({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="home-placeholder" role="tabpanel" aria-label={title}>
      <p>{body}</p>
    </div>
  );
}
