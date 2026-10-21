/** The names live in the protocol package (the overlay offers one before launching); the daemon keeps this import path. */
import { NAMES } from '@ledge/protocol';
export { NAMES, pickName } from '@ledge/protocol';

/** Whether Ledge could have named a session `n`: `own`, a NAMES entry, or one suffixed `-<digits>` as pickName does. */
const ledgeShaped = (n: string, own: string): boolean => n === own || NAMES.includes(n.replace(/-\d+$/, ''));

/** A title by Ledge's shape: '' for a bare Ledge-shaped name (or « name - » with nothing after), the rest of
 *  « name - rest », undefined for any other title. Recognises a conversation continued under another Ledge name. */
export function ledgeTitleRest(title: string, own: string): string | undefined {
  if (ledgeShaped(title, own)) return '';
  const i = title.startsWith(`${own} - `) ? own.length : title.indexOf(' - ');
  return i > 0 && ledgeShaped(title.slice(0, i), own) ? title.slice(i + 3).trim() : undefined;
}
