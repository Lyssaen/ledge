import type { ReactNode } from 'react';
import { Dot, type DotState } from './marks';

/*
 * The redesign's containers (docs/mockups/ledge-mobile-refonte/m0-socle.html, §6): a section title, a framed section with its
 * head, a list row of 52 to 56 px, a card. Radii: 10 px a section, 8 px a card.
 */

/** A section's title over a list: 12 px, muted. */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return <h2 id={id} className="mt-1 -mb-1 flex items-center gap-2 text-small font-medium text-muted">{children}</h2>;
}

/**
 * A framed section. With a `title`, a head: its dot, the title, a count, a subtitle. `tone="rigs"`: OpenRig's section, its
 * border violet. `none`: what the section says when it holds nothing.
 */
export function Box({ title, dot, count, sub, tone, none, label, children }: {
  title?: string; dot?: DotState; count?: number; sub?: string; tone?: 'rigs'; none?: string;
  /** The section's name for a screen reader, when it has no head. */
  label?: string;
  children?: ReactNode;
}) {
  return (
    <section aria-label={title ?? label} className={`flex-none overflow-hidden rounded-[10px] border bg-surface dark:bg-transparent ${tone === 'rigs' ? 'border-task/45' : 'border-line'}`}>
      {title && (
        <div className="flex min-h-11 items-center gap-2 border-b border-line px-3">
          {dot && <Dot state={dot} />}
          <b className="text-body font-semibold whitespace-nowrap">{title}</b>
          {count !== undefined && <span className="text-[12.5px] text-muted">{count}</span>}
          {sub && <span className="min-w-0 flex-1 truncate text-small text-muted">{sub}</span>}
        </div>
      )}
      {none !== undefined ? <p className="p-3 text-[13px] text-muted">{none}</p> : <div className="flex flex-col">{children}</div>}
    </section>
  );
}

/**
 * A list row: its dot, runtime tag, two lines and a meta on the right. `selected`: the one opened beside the list. `stale`:
 * the last known state, dimmed (offline). A row with `href` is a link.
 */
export function Line({ lead, title, sub, subTone, meta, metaWarn = false, selected = false, stale = false, href, children }: {
  lead?: ReactNode; title: ReactNode; sub?: ReactNode; subTone?: 'perm'; meta?: ReactNode; metaWarn?: boolean;
  selected?: boolean; stale?: boolean; href?: string; children?: ReactNode;
}) {
  const className = `flex min-h-[52px] items-center gap-2 border-b border-line px-3 py-1.5 text-[13.5px] last:border-b-0 ${stale ? 'opacity-60' : ''} ${selected ? 'bg-secondary shadow-[inset_2px_0_0_var(--color-primary)]' : ''}`;
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {sub !== undefined && <span className={`truncate text-small leading-4 ${subTone === 'perm' ? 'text-approval' : 'text-muted'}`}>{sub}</span>}
      </span>
      {meta !== undefined && <span className={`font-mono text-small whitespace-nowrap ${metaWarn ? 'text-attention' : 'text-muted'}`}>{meta}</span>}
      {children}
    </>
  );
  return href
    ? <a href={href} aria-current={selected ? 'page' : undefined} className={className}>{body}</a>
    : <div className={className}>{body}</div>;
}

/** A card's tone: a permission's border red, a question's amber, an OpenRig request's red as well. */
export type CardTone = 'plain' | 'perm' | 'ask' | 'rig';

const CARD: Record<CardTone, string> = { plain: 'border-line', perm: 'border-destructive/45', ask: 'border-attention/45', rig: 'border-destructive/40' };

export function Card({ tone = 'plain', selected = false, label, children }: { tone?: CardTone; selected?: boolean; label?: string; children: ReactNode }) {
  return (
    <article aria-label={label} data-card={tone} className={`flex flex-col gap-2.5 rounded-lg border bg-surface p-3 ${CARD[tone]} ${selected ? 'shadow-[0_0_0_2px_var(--color-ring)]' : ''}`}>
      {children}
    </article>
  );
}

/**
 * A screen or a pane with nothing to show: a glyph (or the mascot) in a frame, a title, a line, and maybe a way out.
 * `framed`: the 48 px frame of an empty tab (§3); without it, the plain glyph of an empty right pane (§2).
 */
export function EmptyState({ glyph, title, body, action, framed = true }: { glyph: ReactNode; title: string; body: string; action?: ReactNode; framed?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 pt-[26px] pb-[22px] text-center">
      {framed ? <div aria-hidden="true" className="grid size-12 place-items-center rounded-[10px] border border-line text-muted">{glyph}</div> : <div aria-hidden="true" className="text-muted">{glyph}</div>}
      <h2 className="mt-1.5 text-[17px] leading-6 font-semibold">{title}</h2>
      <p className="max-w-[300px] text-[13.5px] text-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
