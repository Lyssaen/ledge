import type { DaemonClient } from '@ledge/fleet';
import type { ChatTurn } from '@ledge/protocol';
import { Thumbs } from '@ledge/ui/images';
import { useI18n } from '../i18n/lang';

/** The images a question to Ledge carried, over its bubble, from the machine that holds them. Display only: the island has no actions on them. */
export function TurnThumbs({ client, turn }: { client: DaemonClient; turn: ChatTurn }) {
  const { t } = useI18n();
  if (!turn.attachments?.length) return null;
  const d = new Date(turn.askedAt);
  const at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return <Thumbs client={client} refs={turn.attachments} route={turn.machineId ? { machine: turn.machineId } : {}} max={{ w: 200, h: 130 }} who={t.thread.you} at={at} align="end" lang={t.time.locale.startsWith('fr') ? 'fr' : 'en'} copy={t.thread.image} />;
}
