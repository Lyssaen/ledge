import { createContext } from 'react';

/** Opens a web address (the overlay and Desktop put their openUrl here); by default, nothing. Apart from the reader, so a
 *  shell can provide it without loading react-markdown. */
export const MarkdownLinks = createContext<(url: string) => void>(() => {});
