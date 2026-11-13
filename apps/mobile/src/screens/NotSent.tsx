import type { ReactNode } from 'react';
import { copy } from '../copy';
import { href } from '../router';
import { TabPage, hostName, useShell } from '../shell/Shell';
import { Icon } from '../ui/icons';
import { Box, EmptyState } from '../ui/kit/Box';
import { kitButtonClass } from '../ui/kit/Controls';
import { useWide } from '../ui/layout';
import { Mascot } from '../ui/MobileBot';
import { PaneHead } from './Chat';

/*
 * The tabs whose data the PC does not send to the phone yet (docs/mockups/ledge-mobile-refonte/m0-socle.html, §2 and §3,
 * answer A of question Q3): they stay, and say so. B4 and B5 bring Desktop's own empty states.
 */

const seeAtoi = (label: string) => <a href={href({ name: 'atoi' })} className={kitButtonClass({ size: 'sm' })}>{label}</a>;

/** The empty state in its frame on a phone (§3); in the list's column on a wide screen, unframed, lower (§2). */
function Frame({ label, children }: { label: string; children: ReactNode }) {
  const wide = useWide();
  return wide ? <section aria-label={label} className="pt-[34px]">{children}</section> : <Box label={label}>{children}</Box>;
}

/** « MR et PR » before B5. */
export function Prs() {
  const { pc } = useShell();
  return (
    <TabPage title={copy.prs.title} subtitle={copy.prs.subtitle}>
      <Frame label={copy.prs.title}>
        <EmptyState glyph={<Icon name="pr" className="size-[22px]" />} title={copy.prs.notSent(hostName(pc))} body={copy.prs.notSentBody} />
      </Frame>
      <p className="text-small text-muted">{copy.prs.tracked}</p>
    </TabPage>
  );
}

/** « Rigs » before B4. */
export function Rigs() {
  const { pc } = useShell();
  return (
    <TabPage title={copy.rigs.title} subtitle={copy.rigs.subtitle}>
      <Frame label={copy.rigs.title}>
        <EmptyState glyph={<Icon name="rigs" className="size-[22px]" />} title={copy.rigs.notSent(hostName(pc))} body={copy.rigs.notSentBody} action={seeAtoi(copy.rigs.seeAtoi)} />
      </Frame>
    </TabPage>
  );
}

/** The Ledge tab of a PC that does not offer the chat: the same pattern, the mascot still in place of the glyph, no composer. */
export function ChatUnavailable({ onClose }: { onClose?: () => void } = {}) {
  const { pc } = useShell();
  // In the tablet's Ledge pane (m3-chat.html §7): the pane's head, then the same empty state.
  if (onClose) return (
    <>
      <PaneHead frozen onClose={onClose} />
      <section aria-label={copy.chat.title} className="pt-[34px]">
        <EmptyState framed={false} glyph={<Mascot size={64} frozen />} title={copy.chat.unavailable.title(hostName(pc))} body={copy.chat.unavailable.body} action={seeAtoi(copy.chat.unavailable.seeAtoi)} />
      </section>
    </>
  );
  return (
    <TabPage title={copy.chat.title}>
      <Frame label={copy.chat.title}>
        <EmptyState framed={false} glyph={<Mascot size={64} frozen />} title={copy.chat.unavailable.title(hostName(pc))} body={copy.chat.unavailable.body} action={seeAtoi(copy.chat.unavailable.seeAtoi)} />
      </Frame>
    </TabPage>
  );
}

/** The right pane of a tab on a wide screen, before anything opens there (§2): its glyph, « Rien à afficher », what will open. */
export function EmptyPane({ icon, title, body }: { icon: 'pr' | 'rigs'; title: string; body: string }) {
  return (
    <div data-split-empty="" className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-muted">
      <Icon name={icon} className="size-[18px]" />
      <h2 className="mt-2.5 text-[17px] font-semibold text-fg">{title}</h2>
      <p className="max-w-[320px] text-small">{body}</p>
    </div>
  );
}
