import { useEffect } from 'react';

/** A name hovered or focused in the chat lights its agent where it is shown (the mockup's `chatHover`): `chat-hover` on the
 *  `[data-agent="{id}"]` of `.overview-scroll` (the Atelier's seats, « Sans projet », the List's rows), taken off when the name
 *  changes or the chat closes. An agent that is not on screen lights nothing. */
export function useAgentHighlight(id: string | null): void {
  useEffect(() => {
    if (id === null) return;
    const lit = [...document.querySelectorAll<HTMLElement>('.overview-scroll [data-agent]')].filter(el => el.dataset.agent === id);
    for (const el of lit) el.classList.add('chat-hover');
    return () => { for (const el of lit) el.classList.remove('chat-hover'); };
  }, [id]);
}
