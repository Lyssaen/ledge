import { type ComponentProps } from 'react';
import { MarkdownDocument as SharedMarkdownDocument, MarkdownLinks, ThreadMarkdown as SharedThreadMarkdown } from '@ledge/ui/documents/markdown';
import { openUrl } from '../tauri/bridge';

export * from '@ledge/ui/documents/markdown';

/** The shared reader, with web links opened through the overlay's bridge. */
export function MarkdownDocument(props: ComponentProps<typeof SharedMarkdownDocument>) {
  return <MarkdownLinks.Provider value={openUrl}><SharedMarkdownDocument {...props} /></MarkdownLinks.Provider>;
}
export function ThreadMarkdown(props: ComponentProps<typeof SharedThreadMarkdown>) {
  return <MarkdownLinks.Provider value={openUrl}><SharedThreadMarkdown {...props} /></MarkdownLinks.Provider>;
}
