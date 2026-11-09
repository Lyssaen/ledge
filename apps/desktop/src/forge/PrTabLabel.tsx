import type { JSX } from 'react';
import type { FleetPullRequest } from '@ledge/fleet';
import { PipeDot } from './PipeGraph';
import { PrIcon } from './PrIcon';
import '../styles/forge.css';

/** A request's tab (mockup tabLabel `pr`): the icon, its ref, its pipeline's dot. The dot is aria-hidden: the tab's name is its title. */
export function PrTabLabel({ pr, title }: { pr: FleetPullRequest | undefined; title: string }): JSX.Element {
  return <span className="fg-chip"><PrIcon size={13} /><span className="tab-name">{title}</span>{pr && <PipeDot status={pr.pipeline} />}</span>;
}
