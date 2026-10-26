import { useState, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { AttachmentRef, ChatTurn } from '@ledge/protocol';
import { Thumbs as SharedThumbs, type ThumbAction } from '@ledge/ui/images';
import { useI18n } from '../i18n/lang';
import { clock } from '../session/exchanges';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as const;
const ACTION: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 14px', borderRadius: 16, border: 'none', cursor: 'pointer', color: '#fff', background: 'rgba(255,255,255,0.15)', fontSize: 13, textDecoration: 'none' };

/** The image as a PNG on the clipboard (what Paint and most editors paste), whatever its stored type. */
async function copyPng(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

function Actions({ url, image, fileName }: ThumbAction): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => { void copyPng(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined); };
  return (
    <>
      <button type="button" style={ACTION} onClick={copy}>{copied ? t.images.copied : t.images.copy}</button>
      {/* No dialog plugin in the app: the blob URL downloads through the webview. */}
      <a href={url} download={`${fileName}.${EXT[image.mime]}`} style={ACTION}>{t.images.save}</a>
    </>
  );
}

/** A message's images with Desktop's words and the lightbox's Copy / Save… actions. Sizes: the thread's thumbnails 420 × 260, the chat's 200 × 130. */
export function Thumbs({ client, refs, route, max, who, at, align, className }: { client: DaemonClient; refs: AttachmentRef[]; route: { id?: string; machine?: string }; max: { w: number; h: number }; who: string; at: string; align?: 'start' | 'end'; className?: string }): JSX.Element | null {
  const { t } = useI18n();
  const i = t.images;
  return <SharedThumbs client={client} refs={refs} route={route} max={max} who={who} at={at} align={align} className={className} lang={t.time.locale.startsWith('fr') ? 'fr' : 'en'}
    copy={{ capture: i.capture, unavailable: i.unavailable, close: i.close, prev: i.prev, next: i.next }} actions={a => <Actions {...a} />} />;
}

/** The images a question to Ledge carried, over its bubble: from the machine that holds them (`machineId`; the local one when absent). */
export function TurnThumbs({ client, turn }: { client: DaemonClient; turn: ChatTurn }): JSX.Element | null {
  const { t } = useI18n();
  if (!turn.attachments?.length) return null;
  return <Thumbs client={client} refs={turn.attachments} route={turn.machineId ? { machine: turn.machineId } : {}} max={{ w: 200, h: 130 }} who={t.session.thread.you} at={clock(turn.askedAt)} align="end" />;
}
