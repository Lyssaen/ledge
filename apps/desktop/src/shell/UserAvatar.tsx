import type { JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useAvatar } from './avatar';
import { SHELL_ICONS } from './icons';

/** Your disc: the profile photo (Settings › Appearance, #50), round and cropped, or the user icon without one. Decorative:
 *  « You » or the setting's label already names it. */
export function UserAvatar({ size, className = 'av' }: { size: number; className?: string }): JSX.Element {
  const photo = useAvatar();
  return (
    <span className={className} aria-hidden="true">
      {photo ? <img src={photo} alt="" draggable={false} /> : <Icon d={SHELL_ICONS.user} size={size} />}
    </span>
  );
}
