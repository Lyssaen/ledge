import type { JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { SHELL_ICONS } from '../../shell/icons';
import '../../styles/atoi.css';

/** The page's tab (mockup v27 tabLabel `atoi`): the inbox icon, « À toi », then the requests waiting as a plain grey number. */
export function AtoiTabLabel({ title, waiting }: { title: string; waiting: number }): JSX.Element {
  return (
    <span className="atoi-tab">
      <Icon d={SHELL_ICONS.inbox} size={13} /><span className="tab-name">{title}</span>
      {waiting > 0 && <span className="atoi-tab-n mono" aria-hidden="true">{waiting}</span>}
    </span>
  );
}
